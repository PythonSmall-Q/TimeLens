use crate::models::WidgetNetworkDomainRule;

/// High-risk domain categories blocked by default for widget network access.
const DEFAULT_BLOCKED_CATEGORIES: &[&str] =
    &["auth", "payment", "file-hosting", "sensitive-upload"];

/// Built-in high-risk domains blocked for widget network access. Each entry
/// maps a host suffix to the blocked category used in denial messages.
const DEFAULT_BLOCKED_DOMAINS: &[(&str, &str)] = &[
    ("accounts.google.com", "auth"),
    ("auth0.com", "auth"),
    ("login.microsoftonline.com", "auth"),
    ("paypal.com", "payment"),
    ("stripe.com", "payment"),
    ("checkout.stripe.com", "payment"),
    ("drive.google.com", "file-hosting"),
    ("dropbox.com", "file-hosting"),
    ("mega.nz", "file-hosting"),
    ("wetransfer.com", "file-hosting"),
    ("pastebin.com", "sensitive-upload"),
    ("transfer.sh", "sensitive-upload"),
];

fn is_forbidden_ip(ip: std::net::IpAddr) -> bool {
    match ip {
        std::net::IpAddr::V4(ip) => {
            ip.is_private()
                || ip.is_loopback()
                || ip.is_link_local()
                || ip.is_unspecified()
                || ip.is_broadcast()
                || ip.is_documentation()
                || ip.octets()[0] == 0
                || (ip.octets()[0] == 100 && (64..=127).contains(&ip.octets()[1]))
                || ip.octets()[0] >= 224
        }
        std::net::IpAddr::V6(ip) => {
            ip.is_loopback()
                || ip.is_unspecified()
                || ip.is_unique_local()
                || ip.is_unicast_link_local()
                || ip.is_multicast()
                || (ip.segments()[0] == 0x2001 && ip.segments()[1] == 0x0db8)
        }
    }
}

pub fn validate_resolved_host(host: &str, port: u16) -> Result<(), String> {
    use std::net::ToSocketAddrs;
    let addresses = (host, port)
        .to_socket_addrs()
        .map_err(|_| "policy_denied: resource host could not be resolved".to_string())?;
    let mut found = false;
    for address in addresses {
        found = true;
        if is_forbidden_ip(address.ip()) {
            return Err("policy_denied: resolved resource target is private or reserved".to_string());
        }
    }
    if !found {
        return Err("policy_denied: resource host has no addresses".to_string());
    }
    Ok(())
}

/// Check whether a network/media request target is allowed by baseline policy.
pub fn is_target_allowed(resource_hint: &str) -> Result<(), String> {
    if resource_hint.is_empty() {
        return Err("policy_denied: empty resource target".to_string());
    }

    let url = reqwest::Url::parse(resource_hint)
        .map_err(|_| "policy_denied: invalid resource URL".to_string())?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err("policy_denied: only http and https URLs are allowed".to_string());
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("policy_denied: resource URL credentials are blocked".to_string());
    }
    let host = url
        .host_str()
        .ok_or_else(|| "policy_denied: resource URL has no host".to_string())?
        .to_lowercase();

    let private_ip = host.parse::<std::net::IpAddr>().is_ok_and(is_forbidden_ip);
    if host == "localhost" || host == "localhost.localdomain" || private_ip {
        return Err("policy_denied: private or loopback resource targets are blocked".to_string());
    }

    Ok(())
}

/// Returns the default blocked domain categories for review/Settings display.
pub fn default_blocked_categories() -> &'static [&'static str] {
    DEFAULT_BLOCKED_CATEGORIES
}

fn host_matches_suffix(host: &str, suffix: &str) -> bool {
    host.strip_suffix(suffix)
        .is_some_and(|rest| rest.is_empty() || rest.ends_with('.'))
}

/// Return the blocked category when the host is on the built-in high-risk
/// blocklist. Matches the exact host or any of its subdomains.
pub fn blocked_category_for_host(host: &str) -> Option<&'static str> {
    let host = host.trim_end_matches('.').to_lowercase();
    DEFAULT_BLOCKED_DOMAINS
        .iter()
        .find(|(suffix, _)| host_matches_suffix(&host, suffix))
        .map(|(_, category)| *category)
}

/// Evaluate per-widget domain rules for a host.
///
/// Returns `Some(true)` when an allow rule matches, `Some(false)` when a deny
/// rule matches, and `None` when no rule matches. Deny rules take precedence
/// over allow rules; a rule matches the exact host or its subdomains.
pub fn domain_rule_allows(rules: &[WidgetNetworkDomainRule], host: &str) -> Option<bool> {
    let host = host.trim_end_matches('.').to_lowercase();
    let matches = |pattern: &str| {
        let pattern = pattern.trim_end_matches('.').to_lowercase();
        host_matches_suffix(&host, &pattern)
    };
    if rules
        .iter()
        .any(|rule| rule.decision == "deny" && matches(&rule.domain_pattern))
    {
        return Some(false);
    }
    if rules
        .iter()
        .any(|rule| rule.decision == "allow" && matches(&rule.domain_pattern))
    {
        return Some(true);
    }
    None
}

#[cfg(test)]
mod tests {
    use super::{blocked_category_for_host, domain_rule_allows, is_target_allowed};
    use crate::models::WidgetNetworkDomainRule;

    #[test]
    fn allows_public_http_and_https_targets() {
        assert!(is_target_allowed("https://example.com/image.png").is_ok());
        assert!(is_target_allowed("http://example.com/api").is_ok());
    }

    #[test]
    fn blocks_non_http_private_and_credentialed_targets() {
        for target in [
            "file:///tmp/image.png",
            "http://127.0.0.1:49152/api/status",
            "http://user:password@example.com/file",
            "not a url",
        ] {
            assert!(
                is_target_allowed(target).is_err(),
                "target should be blocked: {target}"
            );
        }
    }

    #[test]
    fn blocked_category_matches_builtin_high_risk_hosts() {
        assert_eq!(blocked_category_for_host("paypal.com"), Some("payment"));
        assert_eq!(blocked_category_for_host("www.paypal.com"), Some("payment"));
        assert_eq!(
            blocked_category_for_host("checkout.stripe.com"),
            Some("payment")
        );
        assert_eq!(
            blocked_category_for_host("accounts.google.com"),
            Some("auth")
        );
        assert_eq!(
            blocked_category_for_host("login.microsoftonline.com"),
            Some("auth")
        );
        assert_eq!(
            blocked_category_for_host("drive.google.com"),
            Some("file-hosting")
        );
        assert_eq!(blocked_category_for_host("mega.nz"), Some("file-hosting"));
        assert_eq!(
            blocked_category_for_host("pastebin.com"),
            Some("sensitive-upload")
        );
        assert_eq!(
            blocked_category_for_host("transfer.sh"),
            Some("sensitive-upload")
        );
    }

    #[test]
    fn blocked_category_is_case_insensitive_and_suffix_safe() {
        assert_eq!(blocked_category_for_host("PAYPAL.COM."), Some("payment"));
        assert_eq!(blocked_category_for_host("Api.Auth0.com"), Some("auth"));
        assert_eq!(blocked_category_for_host("notpaypal.com"), None);
        assert_eq!(blocked_category_for_host("paypal.com.evil.com"), None);
        assert_eq!(blocked_category_for_host("example.com"), None);
    }

    fn rule(pattern: &str, decision: &str) -> WidgetNetworkDomainRule {
        WidgetNetworkDomainRule {
            id: None,
            widget_id: "w1".to_string(),
            domain_pattern: pattern.to_string(),
            decision: decision.to_string(),
            policy_source: "test".to_string(),
            created_at: String::new(),
        }
    }

    #[test]
    fn domain_rules_match_exact_hosts_and_subdomains() {
        let rules = vec![rule("cdn.example.com", "allow")];
        assert_eq!(domain_rule_allows(&rules, "cdn.example.com"), Some(true));
        assert_eq!(
            domain_rule_allows(&rules, "assets.cdn.example.com"),
            Some(true)
        );
        assert_eq!(domain_rule_allows(&rules, "example.com"), None);
        assert_eq!(domain_rule_allows(&rules, "otherexample.com"), None);
        assert_eq!(domain_rule_allows(&[], "cdn.example.com"), None);
    }

    #[test]
    fn domain_rule_deny_wins_over_allow() {
        let rules = vec![
            rule("cdn.example.com", "allow"),
            rule("example.com", "deny"),
        ];
        assert_eq!(domain_rule_allows(&rules, "cdn.example.com"), Some(false));
        assert_eq!(domain_rule_allows(&rules, "example.com"), Some(false));
        assert_eq!(
            domain_rule_allows(&rules, "unrelated.com"),
            None
        );
    }
}
