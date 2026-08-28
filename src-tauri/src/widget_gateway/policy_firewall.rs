/// High-risk domain categories blocked by default for widget network access.
const DEFAULT_BLOCKED_CATEGORIES: &[&str] =
    &["auth", "payment", "file-hosting", "sensitive-upload"];

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

    let private_ip = host.parse::<std::net::IpAddr>().is_ok_and(|ip| match ip {
        std::net::IpAddr::V4(ip) => {
            ip.is_private() || ip.is_loopback() || ip.is_link_local() || ip.is_unspecified()
        }
        std::net::IpAddr::V6(ip) => {
            ip.is_loopback()
                || ip.is_unspecified()
                || ip.is_unique_local()
                || ip.is_unicast_link_local()
        }
    });
    if host == "localhost" || host == "localhost.localdomain" || private_ip {
        return Err("policy_denied: private or loopback resource targets are blocked".to_string());
    }

    Ok(())
}

/// Returns the default blocked domain categories for review/Settings display.
pub fn default_blocked_categories() -> &'static [&'static str] {
    DEFAULT_BLOCKED_CATEGORIES
}

#[cfg(test)]
mod tests {
    use super::is_target_allowed;

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
}
