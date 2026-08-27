use crate::db;
use crate::models::WidgetAccessAuditEntry;
use rusqlite::Connection;

pub fn emit(
    conn: &Connection,
    widget_id: &str,
    scope: &str,
    request_type: &str,
    decision: &str,
    resource_hint: Option<&str>,
    payload_class: Option<&str>,
) -> Result<(), String> {
    let now = chrono::Local::now().format("%Y-%m-%dT%H:%M:%S").to_string();
    let entry = WidgetAccessAuditEntry {
        id: None,
        widget_id: widget_id.to_string(),
        scope: scope.to_string(),
        request_type: request_type.to_string(),
        decision: decision.to_string(),
        resource_hint: resource_hint.unwrap_or("").to_string(),
        payload_class: payload_class.unwrap_or("").to_string(),
        occurred_at: now,
    };
    db::insert_widget_access_audit(conn, &entry).map_err(|e| e.to_string())
}
