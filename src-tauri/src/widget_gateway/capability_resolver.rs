use crate::models::{WidgetGatewayRequest, WidgetGatewayRequestType};

/// Resolve a gateway request to the permission/capability scope that must be granted.
///
/// Returns `None` when the request does not require any explicit grant
/// (e.g. widget-scoped state or runtime info).
pub fn required_scope(request: &WidgetGatewayRequest) -> Option<&'static str> {
    match request.request_type {
        WidgetGatewayRequestType::Query => match request.scope.as_str() {
            "metrics" | "sessions" | "categories" | "projects" | "tags" | "goals" | "rules"
            | "focus" | "interruptions" | "hourly" => Some("screen-time:read"),
            "todos" => Some("todo:read"),
            "browser" => Some("browser:read"),
            _ => None,
        },
        WidgetGatewayRequestType::Subscribe | WidgetGatewayRequestType::Unsubscribe => None,
        WidgetGatewayRequestType::StateRead
        | WidgetGatewayRequestType::StateWrite
        | WidgetGatewayRequestType::StateDelete => None,
        WidgetGatewayRequestType::LocalApiCall => Some("local-api:call"),
        WidgetGatewayRequestType::FocusModeWrite => Some("settings:write"),
        WidgetGatewayRequestType::TodoWrite => Some("todo:write"),
        WidgetGatewayRequestType::FocusSessionWrite => Some("settings:write"),
        WidgetGatewayRequestType::NotificationSend => Some("notification:send"),
        WidgetGatewayRequestType::NetworkFetch => match resource_scheme(request) {
            "http" => Some("network.general.http"),
            _ => Some("network.general.https"),
        },
        WidgetGatewayRequestType::MediaLoad => Some("media.image.remote.read"),
        WidgetGatewayRequestType::RuntimeInfo => None,
    }
}

/// Scheme of the request resource hint, defaulting to https.
fn resource_scheme(request: &WidgetGatewayRequest) -> &str {
    request
        .resource_hint
        .as_deref()
        .and_then(|hint| hint.split_once(':'))
        .map(|(scheme, _)| scheme)
        .filter(|scheme| !scheme.is_empty())
        .unwrap_or("https")
}

/// Human-readable display name for a query namespace.
pub fn namespace_display(namespace: &str) -> String {
    match namespace {
        "metrics" => "usage metrics".to_string(),
        "sessions" => "focus sessions".to_string(),
        "categories" => "app categories".to_string(),
        "projects" => "project usage".to_string(),
        "tags" => "usage tags".to_string(),
        "goals" => "usage goals".to_string(),
        "rules" => "focus rules".to_string(),
        "focus" => "focus state".to_string(),
        "todos" => "todo list".to_string(),
        "browser" => "browser activity".to_string(),
        "interruptions" => "interruption periods".to_string(),
        "hourly" => "hourly usage".to_string(),
        "health" => "widget health".to_string(),
        _ => namespace.to_string(),
    }
}
