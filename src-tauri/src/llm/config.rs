use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Unique identifier for a built-in or custom provider.
pub type ProviderId = String;

/// A single LLM provider configuration.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct LlmProvider {
    /// Human-readable name shown in the UI.
    pub name: String,
    /// OpenAI-compatible API base URL.
    pub base_url: String,
    /// Default model ID. Users can override per request.
    pub model: String,
    /// API key. Stored locally in the TOML file.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub api_key: Option<String>,
    /// Whether this is a built-in preset. Built-ins cannot be deleted,
    /// but their API key and model can be edited.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub builtin: bool,
    /// Optional referral URL shown when this provider is selected.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub referral_url: Option<String>,
}

impl Default for LlmProvider {
    fn default() -> Self {
        Self {
            name: "Custom".to_string(),
            base_url: String::new(),
            model: String::new(),
            api_key: None,
            builtin: false,
            referral_url: None,
        }
    }
}

impl LlmProvider {
    pub fn with_referral(name: &str, base_url: &str, model: &str, referral_url: &str) -> Self {
        Self {
            name: name.to_string(),
            base_url: base_url.to_string(),
            model: model.to_string(),
            api_key: None,
            builtin: true,
            referral_url: Some(referral_url.to_string()),
        }
    }

    pub fn builtin(name: &str, base_url: &str, model: &str) -> Self {
        Self {
            name: name.to_string(),
            base_url: base_url.to_string(),
            model: model.to_string(),
            api_key: None,
            builtin: true,
            referral_url: None,
        }
    }
}

/// The full LLM configuration persisted to disk.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct LlmConfig {
    /// Currently selected provider ID.
    pub active_provider_id: Option<ProviderId>,
    /// All configured providers, keyed by ID.
    pub providers: HashMap<ProviderId, LlmProvider>,
}

impl Default for LlmConfig {
    fn default() -> Self {
        let mut providers = HashMap::new();
        providers.insert(
            "orcarouter".to_string(),
            LlmProvider::with_referral(
                "OrcaRouter",
                "https://api.orcarouter.ai/v1",
                "orcarouter/auto",
                "https://www.orcarouter.ai/ref/ref_2bd137bce0d730edcd93",
            ),
        );
        providers.insert(
            "openai".to_string(),
            LlmProvider::builtin("OpenAI", "https://api.openai.com/v1", "gpt-4o-mini"),
        );
        providers.insert(
            "groq".to_string(),
            LlmProvider::builtin(
                "Groq",
                "https://api.groq.com/openai/v1",
                "llama-3.1-70b-versatile",
            ),
        );
        providers.insert(
            "openrouter".to_string(),
            LlmProvider::builtin(
                "OpenRouter",
                "https://openrouter.ai/api/v1",
                "openai/gpt-4o-mini",
            ),
        );
        providers.insert(
            "custom".to_string(),
            LlmProvider {
                name: "Custom".to_string(),
                ..Default::default()
            },
        );

        Self {
            active_provider_id: Some("orcarouter".to_string()),
            providers,
        }
    }
}

impl LlmConfig {
    /// Get the currently active provider, if any.
    pub fn active_provider(&self) -> Option<(&ProviderId, &LlmProvider)> {
        self.active_provider_id
            .as_ref()
            .and_then(|id| self.providers.get(id).map(|p| (id, p)))
    }
}
