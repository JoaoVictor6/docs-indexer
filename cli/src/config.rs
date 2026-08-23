use anyhow::Context;
use serde::Deserialize;
use std::path::Path;

#[derive(Debug, Clone, Deserialize)]
pub struct Config {
    pub database_url: String,
    pub openrouter_api_key: String,
    #[serde(default = "default_openrouter_base_url")]
    pub openrouter_base_url: String,
    #[serde(default = "default_embedding_model")]
    pub embedding_model: String,
    #[serde(default = "default_embedding_dimension")]
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
    pub fn from_file(path: &Path) -> anyhow::Result<Self> {
        let contents = std::fs::read_to_string(path)
            .with_context(|| format!("failed to read config file: {}", path.display()))?;

        let mut config: Self = serde_yaml::from_str(&contents)
            .with_context(|| format!("failed to parse config file: {}", path.display()))?;

        if let Ok(val) = std::env::var("DATABASE_URL") {
            config.database_url = val;
        }
        if let Ok(val) = std::env::var("OPENROUTER_API_KEY") {
            config.openrouter_api_key = val;
        }
        if let Ok(val) = std::env::var("OPENROUTER_BASE_URL") {
            config.openrouter_base_url = val;
        }
        if let Ok(val) = std::env::var("EMBEDDING_MODEL") {
            config.embedding_model = val;
        }
        if let Ok(val) = std::env::var("EMBEDDING_DIMENSION") {
            config.embedding_dimension = val.parse().context("EMBEDDING_DIMENSION must be an integer")?;
        }

        Ok(config)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::NamedTempFile;

    fn clear_config_env() {
        std::env::remove_var("DATABASE_URL");
        std::env::remove_var("OPENROUTER_API_KEY");
        std::env::remove_var("OPENROUTER_BASE_URL");
        std::env::remove_var("EMBEDDING_MODEL");
        std::env::remove_var("EMBEDDING_DIMENSION");
    }

    #[test]
    fn test_from_file_basic() {
        clear_config_env();

        let yaml = r#"
database_url: "postgres://localhost/test"
openrouter_api_key: "sk-test-123"
"#;
        let mut file = NamedTempFile::new().unwrap();
        file.write_all(yaml.as_bytes()).unwrap();

        let config = Config::from_file(file.path()).unwrap();
        assert_eq!(config.database_url, "postgres://localhost/test");
        assert_eq!(config.openrouter_api_key, "sk-test-123");
        assert_eq!(config.openrouter_base_url, "https://openrouter.ai/api/v1");
        assert_eq!(config.embedding_model, "openai/text-embedding-3-small");
        assert_eq!(config.embedding_dimension, 1536);
    }

    #[test]
    fn test_from_file_with_custom_fields() {
        clear_config_env();

        let yaml = r#"
database_url: "postgres://localhost/test"
openrouter_api_key: "sk-test"
openrouter_base_url: "https://custom.api/v1"
embedding_model: "custom-model"
embedding_dimension: 768
"#;
        let mut file = NamedTempFile::new().unwrap();
        file.write_all(yaml.as_bytes()).unwrap();

        let config = Config::from_file(file.path()).unwrap();
        assert_eq!(config.openrouter_base_url, "https://custom.api/v1");
        assert_eq!(config.embedding_model, "custom-model");
        assert_eq!(config.embedding_dimension, 768);
    }

    #[test]
    fn test_env_var_overrides_file() {
        clear_config_env();

        let yaml = r#"
database_url: "postgres://localhost/test"
openrouter_api_key: "sk-file-key"
"#;
        let mut file = NamedTempFile::new().unwrap();
        file.write_all(yaml.as_bytes()).unwrap();

        std::env::set_var("OPENROUTER_API_KEY", "sk-env-key");
        std::env::set_var("EMBEDDING_DIMENSION", "3072");

        let config = Config::from_file(file.path()).unwrap();
        assert_eq!(config.openrouter_api_key, "sk-env-key");
        assert_eq!(config.embedding_dimension, 3072);
    }

    #[test]
    fn test_missing_file_is_error() {
        let result = Config::from_file(Path::new("/nonexistent/config.yaml"));
        assert!(result.is_err());
    }

    #[test]
    fn test_invalid_yaml_is_error() {
        let mut file = NamedTempFile::new().unwrap();
        file.write_all(b"not: valid: yaml: [").unwrap();
        let result = Config::from_file(file.path());
        assert!(result.is_err());
    }
}