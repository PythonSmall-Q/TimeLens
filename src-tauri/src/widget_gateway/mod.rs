pub mod audit_emitter;
pub mod capability_resolver;
pub mod consent_service;
pub mod policy_firewall;
pub mod usage_data_broker;

use serde_json::Value;

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

/// The Widget Gateway is the single trust boundary for all privileged widget
/// requests. It authenticates the widget instance, resolves capabilities, checks
/// consent, enforces policy, dispatches to providers, and emits audit events.
#[derive(Clone)]
pub struct WidgetGateway {
    db: DbState,
    call_rate_limiter: WidgetCallRateLimiter,
}

impl WidgetGateway {
    pub fn new(db: DbState, call_rate_limiter: WidgetCallRateLimiter) -> Self {
        Self {
            db,
            call_rate_limiter,
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
                        message: format!("permission denied: {} required for {}", scope, capability_resolver::namespace_display(&request.scope)),
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
                self.error_response(
                    &request,
                    WidgetGatewayStatus::Error,
                    "provider_error",
                    e,
                )
            }
        }
    }

    fn dispatch(&self, request: &WidgetGatewayRequest) -> Result<Value, String> {
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
            WidgetGatewayRequestType::LocalApiCall => {
                // Phase D: route through LocalApiBroker with scoped tokens.
                Err("local_api_call not yet implemented in gateway".to_string())
            }
            WidgetGatewayRequestType::NetworkFetch | WidgetGatewayRequestType::MediaLoad => {
                let hint = request.resource_hint.as_deref().unwrap_or("");
                policy_firewall::is_target_allowed(hint)?;
                Err("network/media proxy not yet implemented in gateway".to_string())
            }
            WidgetGatewayRequestType::FocusModeWrite => {
                let active = request
                    .payload
                    .as_ref()
                    .and_then(|p| p.get("active"))
                    .and_then(|v| v.as_bool())
                    .ok_or_else(|| "focus_mode_write requires active".to_string())?;
                db::set_bool_setting(&conn, "focus_mode_active", active).map_err(|e| e.to_string())?;
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
                        let id = db::insert_todo(&conn, content, max_order + 1).map_err(|e| e.to_string())?;
                        let todos = db::get_all_todos(&conn).map_err(|e| e.to_string())?;
                        let item = todos.into_iter().find(|t| t.id == Some(id))
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
                            let id = id_value.as_i64()
                                .ok_or_else(|| "todo_write reorder ids must be integers".to_string())?;
                            db::reorder_todo(&conn, id, index as i64).map_err(|e| e.to_string())?;
                        }
                        Ok(Value::Null)
                    }
                    _ => Err(format!("unknown todo_write action: {}", action)),
                }
            }
            WidgetGatewayRequestType::NotificationSend => {
                // Phase D: gate through native notification service.
                Err("notification_send not yet implemented in gateway".to_string())
            }
            WidgetGatewayRequestType::RuntimeInfo => {
                // Low-risk runtime info; return empty for now.
                Ok(Value::Object(serde_json::Map::new()))
            }
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


