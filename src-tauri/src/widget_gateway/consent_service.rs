use crate::db;
use rusqlite::Connection;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConsentState {
    Granted,
    Denied,
    Missing,
}

/// Evaluate whether a widget has consent for the requested scope.
///
/// First checks the explicit runtime consent decisions table, then falls back
/// to legacy install-time widget permissions so existing widgets keep working
/// during the migration window.
pub fn check_consent(
    conn: &Connection,
    widget_id: &str,
    scope: &str,
) -> Result<ConsentState, String> {
    // 1. Runtime consent decisions take precedence.
    let decisions = db::get_widget_consent_decisions(conn, widget_id).map_err(|e| e.to_string())?;
    if let Some(decision) = decisions.iter().find(|d| d.scope == scope) {
        if decision.revoked_at.is_some() {
            return Ok(ConsentState::Denied);
        }
        return match decision.decision.as_str() {
            "granted" => Ok(ConsentState::Granted),
            _ => Ok(ConsentState::Denied),
        };
    }

    // 2. Legacy permission matrix (v1/v2 widgets).
    let permissions = db::get_widget_permissions(conn, widget_id).map_err(|e| e.to_string())?;
    if permissions.iter().any(|p| p == scope) {
        return Ok(ConsentState::Granted);
    }

    Ok(ConsentState::Missing)
}

/// Record a runtime grant/deny decision for a scope.
pub fn record_decision(
    conn: &Connection,
    widget_id: &str,
    scope: &str,
    granted: bool,
    remembered: bool,
    risk_level: &str,
    source: &str,
) -> Result<(), String> {
    let decision = if granted { "granted" } else { "denied" };
    db::set_widget_consent_decision(conn, widget_id, scope, decision, remembered, risk_level, source)
        .map_err(|e| e.to_string())
}

/// Revoke a previously granted scope.
pub fn revoke_scope(conn: &Connection, widget_id: &str, scope: &str) -> Result<(), String> {
    db::revoke_widget_consent_decision(conn, widget_id, scope).map_err(|e| e.to_string())
}
