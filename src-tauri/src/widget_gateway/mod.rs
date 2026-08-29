pub mod audit_emitter;
pub mod capability_resolver;
pub mod consent_service;
pub mod policy_firewall;
pub mod usage_data_broker;

use base64::Engine;
use serde_json::Value;
use std::io::Read;
use std::sync::{Arc, Mutex};
use tauri::AppHandle;

use crate::commands::storage_cmd::DbState;
use crate::commands::widget_runtime_cmd::WidgetCallRateLimiter;
use crate::db;
use crate::models::{
    WidgetGatewayError, WidgetGatewayRequest, WidgetGatewayRequestType, WidgetGatewayResponse,
    WidgetGatewayStatus, WidgetRuntimeCrash,
};

use consent_service::{check_consent, ConsentState};

const MAX_WIDGET_STATE_ENTRIES: i64 = 100;
const MAX_WIDGET_STATE_VALUE_BYTES: usize = 64 * 1024;
const MAX_CHANNEL_CALLS_PER_MIN: u32 = 60;
const MAX_PROXY_RESPONSE_BYTES: usize = 2 * 1024 * 1024;
const PROXY_TIMEOUT_SECS: u64 = 5;
const MAX_NOTIFICATION_TEXT_BYTES: usize = 4 * 1024;
const LOCAL_API_SCOPES: &[&str] = &[
    "screen-time:read",
    "browser:read",
    "browser:write",
    "vscode:read",
    "vscode:write",
    "active-window:subscribe",
];

/// The Widget Gateway is the single trust boundary for all privileged widget
/// requests. It authenticates the widget instance, resolves capabilities, checks
/// consent, enforces policy, dispatches to providers, and emits audit events.
#[derive(Clone)]
pub struct WidgetGateway {
    db: DbState,
    call_rate_limiter: WidgetCallRateLimiter,
    app: Arc<Mutex<Option<AppHandle>>>,
}

impl WidgetGateway {
    pub fn new(db: DbState, call_rate_limiter: WidgetCallRateLimiter) -> Self {
        Self {
            db,
            call_rate_limiter,
            app: Arc::new(Mutex::new(None)),
        }
    }

    pub fn set_app_handle(&self, app: AppHandle) {
        if let Ok(mut slot) = self.app.lock() {
            *slot = Some(app);
        }
    }

    pub fn handle_request(&self, request: WidgetGatewayRequest) -> WidgetGatewayResponse {
        let request_type_str = format!("{:?}", request.request_type).to_lowercase();

        // 1. Rate limit
        if !self
            .call_rate_limiter
            .check(&request.widget_id, MAX_CHANNEL_CALLS_PER_MIN)
        {
            let _ = self.audit(
                &request,
                &request_type_str,
                "throttled",
                request.resource_hint.as_deref(),
            );
            return self.error_response(
                &request,
                WidgetGatewayStatus::Throttled,
                "rate_limited",
                "widget request rate limit exceeded",
            );
        }

        // 2. Suspension check
        let suspended = {
            let conn = match self.db.lock() {
                Ok(c) => c,
                Err(_) => {
                    return self.error_response(
                        &request,
                        WidgetGatewayStatus::Error,
                        "db_lock",
                        "failed to acquire database lock",
                    );
                }
            };
            db::is_widget_suspended(&conn, &request.widget_id).unwrap_or(false)
        };
        if suspended {
            let _ = self.audit(
                &request,
                &request_type_str,
                "denied",
                request.resource_hint.as_deref(),
            );
            return self.error_response(
                &request,
                WidgetGatewayStatus::Denied,
                "suspended",
                "widget is suspended due to repeated failures",
            );
        }

        // 3. Capability and consent check
        let required = capability_resolver::required_scope(&request);
        if let Some(scope) = required {
            let consent = {
                let conn = match self.db.lock() {
                    Ok(c) => c,
                    Err(_) => {
                        return self.error_response(
                            &request,
                            WidgetGatewayStatus::Error,
                            "db_lock",
                            "failed to acquire database lock",
                        );
                    }
                };
                match check_consent(&conn, &request.widget_id, scope) {
                    Ok(c) => c,
                    Err(e) => {
                        return self.error_response(
                            &request,
                            WidgetGatewayStatus::Error,
                            "consent_error",
                            &e,
                        );
                    }
                }
            };

            if consent == ConsentState::Missing {
                let _ = self.audit(
                    &request,
                    &request_type_str,
                    "missing_consent",
                    request.resource_hint.as_deref(),
                );
                return WidgetGatewayResponse {
                    request_id: request.request_id.clone(),
                    status: WidgetGatewayStatus::Denied,
                    payload: None,
                    error: Some(WidgetGatewayError {
                        code: "permission_denied".to_string(),
                        message: format!(
                            "permission denied: {} required for {}",
                            scope,
                            capability_resolver::namespace_display(&request.scope)
                        ),
                        scope: Some(scope.to_string()),
                        recoverable: true,
                    }),
                };
            }

            if consent == ConsentState::Denied {
                let _ = self.audit(
                    &request,
                    &request_type_str,
                    "denied",
                    request.resource_hint.as_deref(),
                );
                return self.error_response(
                    &request,
                    WidgetGatewayStatus::Denied,
                    "permission_denied",
                    &format!("permission denied: {} required", scope),
                );
            }

            // Record access timestamp on legacy permissions.
            if let Ok(conn) = self.db.lock() {
                let _ = db::touch_widget_permission_access(&conn, &request.widget_id, scope);
            }
        }

        // 4. Dispatch
        let result = self.dispatch(&request);

        // 5. Audit and respond
        match &result {
            Ok(payload) => {
                let _ = self.audit(
                    &request,
                    &request_type_str,
                    "success",
                    request.resource_hint.as_deref(),
                );
                // Reset consecutive failures on success.
                if let Ok(conn) = self.db.lock() {
                    let _ = db::reset_widget_consecutive_failures(&conn, &request.widget_id);
                }
                WidgetGatewayResponse {
                    request_id: request.request_id.clone(),
                    status: WidgetGatewayStatus::Success,
                    payload: Some(payload.clone()),
                    error: None,
                }
            }
            Err(e) => {
                let _ = self.record_failure(&request, e);
                let _ = self.audit(
                    &request,
                    &request_type_str,
                    "error",
                    request.resource_hint.as_deref(),
                );
                self.error_response(&request, WidgetGatewayStatus::Error, "provider_error", e)
            }
        }
    }

    fn dispatch(&self, request: &WidgetGatewayRequest) -> Result<Value, String> {
        match request.request_type {
            WidgetGatewayRequestType::LocalApiCall => return self.dispatch_local_api_call(request),
            WidgetGatewayRequestType::NetworkFetch => {
                return self.dispatch_network_fetch(request, false)
            }
            WidgetGatewayRequestType::MediaLoad => {
                return self.dispatch_network_fetch(request, true)
            }
            WidgetGatewayRequestType::NotificationSend => {
                return self.dispatch_notification(request)
            }
            _ => {}
        }
        let conn = self.db.lock().map_err(|e| e.to_string())?;

        match request.request_type {
            WidgetGatewayRequestType::Query => {
                let namespace = &request.scope;
                usage_data_broker::handle_query(&conn, namespace, &request.payload)
            }
            WidgetGatewayRequestType::StateRead => {
                let key = request
                    .payload
                    .as_ref()
                    .and_then(|p| p.get("key"))
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| "state_read requires key".to_string())?;
                let value = db::get_widget_state(&conn, &request.widget_id, key)
                    .map_err(|e| e.to_string())?;
                Ok(serde_json::to_value(value).unwrap_or(Value::Null))
            }
            WidgetGatewayRequestType::StateWrite => {
                let key = request
                    .payload
                    .as_ref()
                    .and_then(|p| p.get("key"))
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| "state_write requires key".to_string())?;
                let value = request
                    .payload
                    .as_ref()
                    .and_then(|p| p.get("value"))
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| "state_write requires value".to_string())?;
                if value.len() > MAX_WIDGET_STATE_VALUE_BYTES {
                    return Err(format!(
                        "widget state value exceeds {} byte limit",
                        MAX_WIDGET_STATE_VALUE_BYTES
                    ));
                }
                let count = db::count_widget_state_entries(&conn, &request.widget_id)
                    .map_err(|e| e.to_string())?;
                if count >= MAX_WIDGET_STATE_ENTRIES {
                    return Err(format!(
                        "widget state exceeds {} entry limit",
                        MAX_WIDGET_STATE_ENTRIES
                    ));
                }
                db::set_widget_state(&conn, &request.widget_id, key, value)
                    .map_err(|e| e.to_string())?;
                Ok(Value::Null)
            }
            WidgetGatewayRequestType::StateDelete => {
                let key = request
                    .payload
                    .as_ref()
                    .and_then(|p| p.get("key"))
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| "state_delete requires key".to_string())?;
                db::delete_widget_state(&conn, &request.widget_id, key)
                    .map_err(|e| e.to_string())?;
                Ok(Value::Null)
            }
            WidgetGatewayRequestType::Subscribe => {
                let events = request
                    .payload
                    .as_ref()
                    .and_then(|p| p.as_array())
                    .cloned()
                    .unwrap_or_default()
                    .into_iter()
                    .filter_map(|v| v.as_str().map(String::from))
                    .filter(|e| is_known_widget_event(e))
                    .collect::<Vec<String>>();
                db::set_widget_subscriptions(&conn, &request.widget_id, &events)
                    .map_err(|e| e.to_string())?;
                Ok(Value::Null)
            }
            WidgetGatewayRequestType::Unsubscribe => {
                db::clear_widget_subscriptions(&conn, &request.widget_id)
                    .map_err(|e| e.to_string())?;
                Ok(Value::Null)
            }
            WidgetGatewayRequestType::FocusModeWrite => {
                let active = request
                    .payload
                    .as_ref()
                    .and_then(|p| p.get("active"))
                    .and_then(|v| v.as_bool())
                    .ok_or_else(|| "focus_mode_write requires active".to_string())?;
                db::set_bool_setting(&conn, "focus_mode_active", active)
                    .map_err(|e| e.to_string())?;
                Ok(Value::Null)
            }
            WidgetGatewayRequestType::TodoWrite => {
                let action = request
                    .payload
                    .as_ref()
                    .and_then(|p| p.get("action"))
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| "todo_write requires action".to_string())?;
                match action {
                    "add" => {
                        let content = request
                            .payload
                            .as_ref()
                            .and_then(|p| p.get("content"))
                            .and_then(|v| v.as_str())
                            .ok_or_else(|| "todo_write add requires content".to_string())?;
                        let max_order = db::get_all_todos(&conn)
                            .map_err(|e| e.to_string())?
                            .into_iter()
                            .map(|t| t.order_index)
                            .max()
                            .unwrap_or(0);
                        let id = db::insert_todo(&conn, content, max_order + 1)
                            .map_err(|e| e.to_string())?;
                        let todos = db::get_all_todos(&conn).map_err(|e| e.to_string())?;
                        let item = todos
                            .into_iter()
                            .find(|t| t.id == Some(id))
                            .ok_or_else(|| "failed to retrieve created todo".to_string())?;
                        Ok(serde_json::to_value(item).unwrap_or(Value::Null))
                    }
                    "toggle" => {
                        let id = request
                            .payload
                            .as_ref()
                            .and_then(|p| p.get("id"))
                            .and_then(|v| v.as_i64())
                            .ok_or_else(|| "todo_write toggle requires id".to_string())?;
                        db::toggle_todo(&conn, id).map_err(|e| e.to_string())?;
                        Ok(Value::Null)
                    }
                    "delete" => {
                        let id = request
                            .payload
                            .as_ref()
                            .and_then(|p| p.get("id"))
                            .and_then(|v| v.as_i64())
                            .ok_or_else(|| "todo_write delete requires id".to_string())?;
                        db::delete_todo(&conn, id).map_err(|e| e.to_string())?;
                        Ok(Value::Null)
                    }
                    "reorder" => {
                        let ids = request
                            .payload
                            .as_ref()
                            .and_then(|p| p.get("ids"))
                            .and_then(|v| v.as_array())
                            .ok_or_else(|| "todo_write reorder requires ids".to_string())?;
                        for (index, id_value) in ids.iter().enumerate() {
                            let id = id_value.as_i64().ok_or_else(|| {
                                "todo_write reorder ids must be integers".to_string()
                            })?;
                            db::reorder_todo(&conn, id, index as i64).map_err(|e| e.to_string())?;
                        }
                        Ok(Value::Null)
                    }
                    _ => Err(format!("unknown todo_write action: {}", action)),
                }
            }
            WidgetGatewayRequestType::RuntimeInfo => {
                // Low-risk runtime info; return empty for now.
                Ok(Value::Object(serde_json::Map::new()))
            }
            WidgetGatewayRequestType::LocalApiCall
            | WidgetGatewayRequestType::NetworkFetch
            | WidgetGatewayRequestType::MediaLoad
            | WidgetGatewayRequestType::NotificationSend => {
                unreachable!("privileged provider requests are dispatched before database requests")
            }
        }
    }

    fn dispatch_local_api_call(&self, request: &WidgetGatewayRequest) -> Result<Value, String> {
        let payload = request
            .payload
            .as_ref()
            .ok_or_else(|| "invalid_request: local_api_call requires payload".to_string())?;
        let method = payload
            .get("method")
            .and_then(Value::as_str)
            .unwrap_or("GET")
            .to_uppercase();
        if !matches!(method.as_str(), "GET" | "POST" | "PUT" | "PATCH" | "DELETE") {
            return Err("invalid_request: unsupported local API method".to_string());
        }
        let path = payload
            .get("path")
            .and_then(Value::as_str)
            .ok_or_else(|| "invalid_request: local_api_call requires path".to_string())?;
        if !path.starts_with("/api/")
            || path.contains("..")
            || path.contains('\n')
            || path.contains('\r')
        {
            return Err("policy_denied: local API path is not allowed".to_string());
        }
        let scopes = payload
            .get("scopes")
            .and_then(Value::as_array)
            .map(|items| {
                items
                    .iter()
                    .filter_map(Value::as_str)
                    .map(str::to_string)
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        if scopes
            .iter()
            .any(|scope| !LOCAL_API_SCOPES.contains(&scope.as_str()))
        {
            return Err("policy_denied: local API scope is not supported".to_string());
        }
        let route_scopes = local_api_route_scopes(path, method.as_str())
            .ok_or_else(|| "policy_denied: local API route is not allowed for widgets".to_string())?;
        let conn = self.db.lock().map_err(|e| e.to_string())?;
        let permissions = db::get_widget_permissions(&conn, &request.widget_id)
            .map_err(|e| format!("provider_error: {e}"))?;
        if !permissions
            .iter()
            .any(|p| p == "local-api:call" || p == "api:call")
        {
            return Err("permission_denied: local-api:call permission is required".to_string());
        }
        if scopes.iter().any(|scope| !route_scopes.contains(&scope.as_str())) {
            return Err("policy_denied: requested scope is not allowed for this route".to_string());
        }
        let granted_scopes = route_scopes
            .iter()
            .copied()
            .filter(|scope| permissions.iter().any(|permission| permission == scope))
            .map(str::to_string)
            .collect::<Vec<_>>();
        if scopes.iter().any(|scope| !granted_scopes.iter().any(|granted| granted == scope)) {
            return Err("permission_denied: requested local API scope is not granted".to_string());
        }
        let token = crate::commands::extension_bridge_cmd::issue_api_token_impl(
            &conn,
            format!("Widget: {}", request.widget_id),
            granted_scopes,
            vec![],
            None,
        )?;
        drop(conn);

        let url = format!("{}{}", crate::api_server::local_api_base_url(), path);
        let client = reqwest::blocking::Client::builder()
            .timeout(std::time::Duration::from_secs(PROXY_TIMEOUT_SECS))
            .build()
            .map_err(|e| format!("provider_error: {e}"))?;
        let request_method = reqwest::Method::from_bytes(method.as_bytes())
            .map_err(|_| "invalid_request: invalid method".to_string())?;
        let mut builder = client
            .request(request_method, url)
            .header("X-Client-Id", format!("widget-{}", request.widget_id))
            .header("X-Api-Token", token.token);
        if let Some(body) = payload.get("body") {
            builder = builder.json(body);
        }
        let response = builder.send().map_err(|e| {
            if e.is_timeout() {
                "timed_out: local API request timed out".to_string()
            } else {
                format!("provider_error: {e}")
            }
        })?;
        self.response_value(response)
    }

    fn dispatch_network_fetch(
        &self,
        request: &WidgetGatewayRequest,
        media_only: bool,
    ) -> Result<Value, String> {
        let target = request
            .resource_hint
            .as_deref()
            .ok_or_else(|| "invalid_request: resource URL is required".to_string())?;
        policy_firewall::is_target_allowed(target)?;
        let parsed_target = reqwest::Url::parse(target)
            .map_err(|_| "policy_denied: invalid resource URL".to_string())?;
        policy_firewall::validate_resolved_host(
            parsed_target
                .host_str()
                .ok_or_else(|| "policy_denied: resource URL has no host".to_string())?,
            parsed_target.port_or_known_default().unwrap_or(443),
        )?;
        let client = reqwest::blocking::Client::builder()
            .timeout(std::time::Duration::from_secs(PROXY_TIMEOUT_SECS))
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|e| format!("provider_error: {e}"))?;
        let response = client.get(target).send().map_err(|e| {
            if e.is_timeout() {
                "timed_out: network request timed out".to_string()
            } else {
                format!("provider_error: {e}")
            }
        })?;
        if media_only {
            let content_type = response
                .headers()
                .get(reqwest::header::CONTENT_TYPE)
                .and_then(|v| v.to_str().ok())
                .unwrap_or("")
                .to_lowercase();
            if !content_type.starts_with("image/")
                && !content_type.starts_with("audio/")
                && !content_type.starts_with("video/")
            {
                return Err("policy_denied: media response content type is not allowed".to_string());
            }
            let response = self.response_value(response)?;
            let mime = response
                .get("content_type")
                .and_then(Value::as_str)
                .unwrap_or("application/octet-stream");
            let bytes = response
                .get("body_base64")
                .and_then(Value::as_str)
                .unwrap_or("");
            return Ok(serde_json::json!({
                "kind": "data_url", "content_type": mime,
                "url": format!("data:{};base64,{}", mime, bytes)
            }));
        }
        self.response_value(response)
    }

    fn response_value(&self, response: reqwest::blocking::Response) -> Result<Value, String> {
        let status = response.status().as_u16();
        let content_type = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("application/octet-stream")
            .to_string();
        let mut body = Vec::new();
        response
            .take((MAX_PROXY_RESPONSE_BYTES + 1) as u64)
            .read_to_end(&mut body)
            .map_err(|e| format!("provider_error: {e}"))?;
        if body.len() > MAX_PROXY_RESPONSE_BYTES {
            return Err(format!(
                "size_limit: response exceeds {} bytes",
                MAX_PROXY_RESPONSE_BYTES
            ));
        }
        Ok(serde_json::json!({
            "status": status, "content_type": content_type,
            "body_base64": base64::engine::general_purpose::STANDARD.encode(body)
        }))
    }

    fn dispatch_notification(&self, request: &WidgetGatewayRequest) -> Result<Value, String> {
        let payload = request
            .payload
            .as_ref()
            .ok_or_else(|| "invalid_request: notification_send requires payload".to_string())?;
        let title = payload
            .get("title")
            .and_then(Value::as_str)
            .unwrap_or("TimeLens");
        let body = payload
            .get("body")
            .and_then(Value::as_str)
            .ok_or_else(|| "invalid_request: notification body is required".to_string())?;
        if title.len() > MAX_NOTIFICATION_TEXT_BYTES || body.len() > MAX_NOTIFICATION_TEXT_BYTES {
            return Err("size_limit: notification text exceeds 4096 bytes".to_string());
        }
        #[cfg(target_os = "windows")]
        {
            let app = self.app.lock().map_err(|_| "provider_error: notification provider unavailable".to_string())?
                .clone()
                .ok_or_else(|| "provider_error: notification provider unavailable".to_string())?;
            crate::commands::app_cmd::send_native_notification(
                app,
                title.to_string(),
                body.to_string(),
                payload.get("alarm").and_then(Value::as_bool),
            )
            .map_err(|e| format!("provider_error: {e}"))?;
            Ok(Value::Null)
        }
        #[cfg(not(target_os = "windows"))]
        {
            let app = self.app.lock().map_err(|_| "provider_error: notification provider unavailable".to_string())?
                .clone()
                .ok_or_else(|| "provider_error: notification provider unavailable".to_string())?;
            crate::commands::app_cmd::send_native_notification(
                app,
                title.to_string(),
                body.to_string(),
                payload.get("alarm").and_then(Value::as_bool),
            ).map_err(|e| format!("provider_error: {e}"))?;
            Ok(Value::Null)
        }
    }

    fn audit(
        &self,
        request: &WidgetGatewayRequest,
        request_type: &str,
        decision: &str,
        resource_hint: Option<&str>,
    ) -> Result<(), String> {
        let conn = self.db.lock().map_err(|e| e.to_string())?;
        audit_emitter::emit(
            &conn,
            &request.widget_id,
            &request.scope,
            request_type,
            decision,
            resource_hint,
            None,
        )
    }

    fn record_failure(&self, request: &WidgetGatewayRequest, error: &str) -> Result<(), String> {
        let conn = self.db.lock().map_err(|e| e.to_string())?;
        let count = db::increment_widget_consecutive_failures(&conn, &request.widget_id)
            .map_err(|e| e.to_string())?;
        if count >= 5 {
            let until = (chrono::Local::now() + chrono::Duration::minutes(60))
                .format("%Y-%m-%dT%H:%M:%S")
                .to_string();
            let _ = db::suspend_widget_until(&conn, &request.widget_id, &until);
        }
        let now = chrono::Local::now().format("%Y-%m-%dT%H:%M:%S").to_string();
        let _ = db::insert_widget_error_log(
            &conn,
            &request.widget_id,
            error,
            "Check permission and arguments.",
        );
        let crash = WidgetRuntimeCrash {
            id: None,
            widget_id: request.widget_id.clone(),
            host_id: None,
            error: error.to_string(),
            stack_hint: String::new(),
            occurred_at: now,
        };
        db::insert_widget_runtime_crash(&conn, &crash).map_err(|e| e.to_string())
    }

    fn error_response(
        &self,
        request: &WidgetGatewayRequest,
        status: WidgetGatewayStatus,
        code: &str,
        message: &str,
    ) -> WidgetGatewayResponse {
        let recoverable = status != WidgetGatewayStatus::Denied;
        WidgetGatewayResponse {
            request_id: request.request_id.clone(),
            status,
            payload: None,
            error: Some(WidgetGatewayError {
                code: code.to_string(),
                message: message.to_string(),
                scope: capability_resolver::required_scope(request).map(String::from),
                recoverable,
            }),
        }
    }

    /// Record a runtime consent decision for a widget scope.
    pub fn record_consent(
        &self,
        widget_id: &str,
        scope: &str,
        granted: bool,
        remembered: bool,
        risk_level: &str,
        source: &str,
    ) -> Result<(), String> {
        let conn = self.db.lock().map_err(|e| e.to_string())?;
        consent_service::record_decision(
            &conn, widget_id, scope, granted, remembered, risk_level, source,
        )
    }

    /// Revoke a previously granted scope.
    pub fn revoke_consent(&self, widget_id: &str, scope: &str) -> Result<(), String> {
        let conn = self.db.lock().map_err(|e| e.to_string())?;
        consent_service::revoke_scope(&conn, widget_id, scope)
    }
}

fn local_api_route_scopes(path: &str, method: &str) -> Option<&'static [&'static str]> {
    match (method, path) {
        ("GET", "/api/status")
        | ("GET", "/api/screen-time/today")
        | ("GET", "/api/screen-time/range")
        | ("GET", "/api/categories") => Some(&["screen-time:read"]),
        ("GET", "/api/browser/link") => Some(&["browser:read"]),
        ("POST", "/api/browser/session") => Some(&["browser:write"]),
        ("GET", "/api/vscode/stats/today")
        | ("GET", "/api/vscode/stats/range")
        | ("GET", "/api/vscode/languages/range")
        | ("GET", "/api/vscode/projects/range")
        | ("GET", "/api/vscode/enabled") => Some(&["vscode:read"]),
        ("POST", "/api/vscode/sessions") | ("POST", "/api/vscode/enabled") => {
            Some(&["vscode:write"])
        }
        _ => None,
    }
}

fn is_known_widget_event(event: &str) -> bool {
    matches!(
        event,
        "focus-session-changed"
            | "goal-tick"
            | "idle-return"
            | "rule-triggered"
            | "interruption-signal"
    )
}
