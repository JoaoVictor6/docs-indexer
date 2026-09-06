use anyhow::Context;

#[derive(Debug, Clone)]
pub struct Config {
    pub database_url: String,
    pub openrouter_api_key: String,
    pub openrouter_base_url: String,
    pub embedding_model: String,
    pub embedding_dimension: i32,
}

fn default_openrouter_base_url() -> String {
    "https://openrouter.ai/api/v1".to_string()
}

fn default_embedding_model() -> String {
    "openai/text-embedding-3-small".to_string()
}

fn default_embedding_dimension() -> i32 {
    1536
}

impl Config {
    pub fn from_env() -> anyhow::Result<Self> {
        let database_url = match std::env::var("DATABASE_URL") {
            Ok(val) => val,
            Err(_) => anyhow::bail!("DATABASE_URL is not set"),
        };
        let openrouter_api_key = match std::env::var("OPENROUTER_API_KEY") {
            Ok(val) => val,
            Err(_) => anyhow::bail!("OPENROUTER_API_KEY is not set"),
        };
        let openrouter_base_url =
            std::env::var("OPENROUTER_BASE_URL").unwrap_or_else(|_| default_openrouter_base_url());
        let embedding_model =
            std::env::var("EMBEDDING_MODEL").unwrap_or_else(|_| default_embedding_model());
        let embedding_dimension = std::env::var("EMBEDDING_DIMENSION")
            .unwrap_or_else(|_| default_embedding_dimension().to_string())
            .parse()
            .context("EMBEDDING_DIMENSION must be an integer")?;

        Ok(Config {
            database_url,
            openrouter_api_key,
            openrouter_base_url,
            embedding_model,
            embedding_dimension,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Mutex, MutexGuard};

    static ENV_LOCK: Mutex<()> = Mutex::new(());

    const ENV_KEYS: [&str; 5] = [
        "DATABASE_URL",
        "OPENROUTER_API_KEY",
        "OPENROUTER_BASE_URL",
        "EMBEDDING_MODEL",
        "EMBEDDING_DIMENSION",
    ];

    struct EnvGuard {
        _lock: MutexGuard<'static, ()>,
        saved: Vec<(String, Option<String>)>,
    }

    impl EnvGuard {
        fn clear() -> Self {
            let lock = ENV_LOCK.lock().unwrap();
            let saved = ENV_KEYS
                .iter()
                .map(|key| {
                    let value = std::env::var(key).ok();
                    std::env::remove_var(key);
                    (key.to_string(), value)
                })
                .collect();
            Self {
                _lock: lock,
                saved,
            }
        }
    }

    impl Drop for EnvGuard {
        fn drop(&mut self) {
            for (key, value) in &self.saved {
                match value {
                    Some(val) => std::env::set_var(key, val),
                    None => std::env::remove_var(key),
                }
            }
        }
    }

    #[test]
    fn test_required_vars_present_with_defaults() {
        let _guard = EnvGuard::clear();
        std::env::set_var("DATABASE_URL", "postgres://localhost/test");
        std::env::set_var("OPENROUTER_API_KEY", "sk-test-123");

        let config = Config::from_env().unwrap();
        assert_eq!(config.database_url, "postgres://localhost/test");
        assert_eq!(config.openrouter_api_key, "sk-test-123");
        assert_eq!(config.openrouter_base_url, "https://openrouter.ai/api/v1");
        assert_eq!(config.embedding_model, "openai/text-embedding-3-small");
        assert_eq!(config.embedding_dimension, 1536);
    }

    #[test]
    fn test_missing_database_url() {
        let _guard = EnvGuard::clear();
        std::env::set_var("OPENROUTER_API_KEY", "sk-test-123");

        let err = Config::from_env().unwrap_err();
        assert!(err.to_string().contains("DATABASE_URL"));
    }

    #[test]
    fn test_missing_openrouter_api_key() {
        let _guard = EnvGuard::clear();
        std::env::set_var("DATABASE_URL", "postgres://localhost/test");

        let err = Config::from_env().unwrap_err();
        assert!(err.to_string().contains("OPENROUTER_API_KEY"));
    }

    #[test]
    fn test_optional_vars_omitted_use_defaults() {
        let _guard = EnvGuard::clear();
        std::env::set_var("DATABASE_URL", "postgres://localhost/test");
        std::env::set_var("OPENROUTER_API_KEY", "sk-test-123");

        let config = Config::from_env().unwrap();
        assert_eq!(config.openrouter_base_url, "https://openrouter.ai/api/v1");
        assert_eq!(config.embedding_model, "openai/text-embedding-3-small");
        assert_eq!(config.embedding_dimension, 1536);
    }

    #[test]
    fn test_embedding_dimension_override() {
        let _guard = EnvGuard::clear();
        std::env::set_var("DATABASE_URL", "postgres://localhost/test");
        std::env::set_var("OPENROUTER_API_KEY", "sk-test-123");
        std::env::set_var("EMBEDDING_DIMENSION", "3072");

        let config = Config::from_env().unwrap();
        assert_eq!(config.embedding_dimension, 3072);
    }

    #[test]
    fn test_embedding_dimension_non_integer() {
        let _guard = EnvGuard::clear();
        std::env::set_var("DATABASE_URL", "postgres://localhost/test");
        std::env::set_var("OPENROUTER_API_KEY", "sk-test-123");
        std::env::set_var("EMBEDDING_DIMENSION", "not-a-number");

        let err = Config::from_env().unwrap_err();
        assert!(err.to_string().contains("EMBEDDING_DIMENSION"));
    }
}
