pub mod instance_manager;

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use crate::commands::storage_cmd::DbState;
use crate::commands::widget_runtime_cmd::WidgetCallRateLimiter;
use crate::db;
use crate::models::{
    WidgetGatewayRequest, WidgetGatewayRequestType, WidgetGatewayResponse, WidgetRuntimeHealth,
};
use crate::widget_gateway::WidgetGateway;

/// Per-widget runtime instance tracked by the kernel.
#[derive(Debug, Clone)]
pub struct WidgetInstance {
    pub widget_id: String,
    pub widget_type: String,
    pub runtime_language: String,
    pub status: String,
}

/// The Widget Kernel is the trusted local coordinator for widget identity,
/// lifecycle, quotas, and request routing. It is the only caller into the
/// Widget Gateway.
#[derive(Clone)]
pub struct WidgetKernel {
    db: DbState,
    gateway: WidgetGateway,
    instances: Arc<Mutex<HashMap<String, WidgetInstance>>>,
}

impl WidgetKernel {
    pub fn new(db: DbState, call_rate_limiter: WidgetCallRateLimiter) -> Self {
        let gateway = WidgetGateway::new(db.clone(), call_rate_limiter);
        Self {
            db,
            gateway,
            instances: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Register a widget instance with the kernel.
    pub fn register_instance(
        &self,
        widget_id: String,
        widget_type: String,
        runtime_language: String,
    ) {
        let mut instances = self.instances.lock().unwrap();
        instances.insert(
            widget_id.clone(),
            WidgetInstance {
                widget_id,
                widget_type,
                runtime_language,
                status: "active".to_string(),
            },
        );
    }

    /// Remove a widget instance from the kernel.
    pub fn unregister_instance(&self, widget_id: &str) {
        let mut instances = self.instances.lock().unwrap();
        instances.remove(widget_id);
    }

    /// Route a normalized request through the gateway.
    pub fn handle_request(&self, request: WidgetGatewayRequest) -> WidgetGatewayResponse {
        self.gateway.handle_request(request)
    }

    pub fn set_app_handle(&self, app: tauri::AppHandle) {
        self.gateway.set_app_handle(app);
    }

    /// Convenience helper for legacy query requests.
    pub fn query(
        &self,
        widget_id: &str,
        namespace: &str,
        payload: Option<serde_json::Value>,
    ) -> WidgetGatewayResponse {
        let request = WidgetGatewayRequest {
            widget_id: widget_id.to_string(),
            request_id: uuid::Uuid::new_v4().to_string(),
            scope: namespace.to_string(),
            request_type: WidgetGatewayRequestType::Query,
            payload,
            resource_hint: None,
            occurred_at: None,
        };
        self.gateway.handle_request(request)
    }

    /// Record a widget error and update health/crash state.
    pub fn record_error(
        &self,
        widget_id: &str,
        error: &str,
        recovery_hint: Option<&str>,
    ) -> Result<(), String> {
        let conn = self.db.lock().map_err(|e| e.to_string())?;
        let count = db::increment_widget_consecutive_failures(&conn, widget_id)
            .map_err(|e| e.to_string())?;
        if count >= 5 {
            let until = (chrono::Local::now() + chrono::Duration::minutes(60))
                .format("%Y-%m-%dT%H:%M:%S")
                .to_string();
            let _ = db::suspend_widget_until(&conn, widget_id, &until);
        }
        let _ = db::insert_widget_error_log(
            &conn,
            widget_id,
            error,
            recovery_hint.unwrap_or(""),
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Process a lifecycle event.
    pub fn lifecycle_event(&self, widget_id: &str, event: &str) -> Result<(), String> {
        let known = ["mount", "foreground", "background", "suspend", "resume", "uninstall"];
        if !known.contains(&event) {
            return Err(format!("unknown lifecycle event: {}", event));
        }
        let conn = self.db.lock().map_err(|e| e.to_string())?;
        if event == "uninstall" {
            db::clear_widget_runtime_data(&conn, widget_id).map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    /// Reset widget permissions and runtime state.
    pub fn reset_permissions_and_state(
        &self,
        widget_id: &str,
        actor: Option<&str>,
    ) -> Result<(), String> {
        let conn = self.db.lock().map_err(|e| e.to_string())?;
        db::revoke_all_widget_permissions(&conn, widget_id, actor).map_err(|e| e.to_string())?;
        db::clear_widget_runtime_data(&conn, widget_id).map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Set the paused state of a widget.
    pub fn set_paused(&self, widget_id: &str, paused: bool) -> Result<(), String> {
        let conn = self.db.lock().map_err(|e| e.to_string())?;
        db::set_widget_paused(&conn, widget_id, paused).map_err(|e| e.to_string())
    }

    /// Record a heartbeat and update runtime health.
    pub fn heartbeat(
        &self,
        widget_id: &str,
        memory_used_mb: i64,
        cpu_used_ms: i64,
    ) -> Result<(), String> {
        let now = chrono::Local::now().format("%Y-%m-%dT%H:%M:%S").to_string();
        let conn = self.db.lock().map_err(|e| e.to_string())?;
        let host_id: Option<String> = {
            let instances = self.instances.lock().unwrap();
            instances.get(widget_id).map(|_| widget_id.to_string())
        };
        let health = WidgetRuntimeHealth {
            widget_id: widget_id.to_string(),
            host_id,
            memory_used_mb,
            cpu_used_ms,
            last_heartbeat_at: Some(now.clone()),
            status: "active".to_string(),
        };
        conn.execute(
            "INSERT INTO widget_runtime_health
             (widget_id, host_id, memory_used_mb, cpu_used_ms, last_heartbeat_at, status)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(widget_id) DO UPDATE SET
                host_id = excluded.host_id,
                memory_used_mb = excluded.memory_used_mb,
                cpu_used_ms = excluded.cpu_used_ms,
                last_heartbeat_at = excluded.last_heartbeat_at,
                status = excluded.status",
            rusqlite::params![
                &health.widget_id,
                &health.host_id,
                health.memory_used_mb,
                health.cpu_used_ms,
                &health.last_heartbeat_at,
                &health.status,
            ],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Return the underlying gateway for direct consent operations.
    pub fn gateway(&self) -> &WidgetGateway {
        &self.gateway
    }
}
