/// High-risk domain categories blocked by default for widget network access.
const DEFAULT_BLOCKED_CATEGORIES: &[&str] = &[
    "auth",
    "payment",
    "file-hosting",
    "sensitive-upload",
];

/// Check whether a network/media request target is allowed by baseline policy.
///
/// For Phase B this is a placeholder: it only rejects obviously unsafe patterns
/// (localhost loopback with credentials, empty hosts). Domain category matching
/// and user-configurable blocklists will be expanded in Phase D.
pub fn is_target_allowed(resource_hint: &str) -> Result<(), String> {
    if resource_hint.is_empty() {
        return Err("empty resource target".to_string());
    }

    let lower = resource_hint.to_lowercase();

    // Block URLs that try to smuggle credentials or loopback paths.
    if lower.contains("@127.")
        || lower.contains("@localhost")
        || lower.contains("@0.")
    {
        return Err("resource target with embedded loopback credentials is blocked".to_string());
    }

    Ok(())
}

/// Returns the default blocked domain categories for review/Settings display.
pub fn default_blocked_categories() -> &'static [&'static str] {
    DEFAULT_BLOCKED_CATEGORIES
}
