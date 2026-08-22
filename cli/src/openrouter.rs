use anyhow::Context;
use async_trait::async_trait;
use reqwest::Client;
use serde::{Deserialize, Serialize};

use crate::config::Config;
use crate::embedding::{EmbeddingBatch, EmbeddingProvider};

pub struct OpenRouterProvider {
    client: Client,
    api_key: String,
    base_url: String,
    model: String,
}

impl OpenRouterProvider {
    pub fn new(config: &Config) -> Self {
        Self {
            client: Client::new(),
            api_key: config.openrouter_api_key.clone(),
            base_url: config.openrouter_base_url.clone(),
            model: config.embedding_model.clone(),
        }
    }
}

#[derive(Serialize)]
struct EmbeddingRequest {
    model: String,
    input: Vec<String>,
}

#[derive(Deserialize)]
struct EmbeddingData {
    embedding: Vec<f32>,
}

#[derive(Deserialize)]
struct EmbeddingResponse {
    data: Vec<EmbeddingData>,
}

#[async_trait]
impl EmbeddingProvider for OpenRouterProvider {
    async fn embed(&self, texts: &[String]) -> anyhow::Result<EmbeddingBatch> {
        let url = format!("{}/embeddings", self.base_url);

        let request = EmbeddingRequest {
            model: self.model.clone(),
            input: texts.to_vec(),
        };

        let response = self
            .client
            .post(&url)
            .header("Authorization", format!("Bearer {}", self.api_key))
            .header("Content-Type", "application/json")
            .json(&request)
            .send()
            .await
            .context("failed to send embedding request to OpenRouter")?;

        let status = response.status();
        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            anyhow::bail!("OpenRouter returned {}: {}", status, body);
        }

        let result: EmbeddingResponse = response
            .json()
            .await
            .context("failed to parse OpenRouter response")?;

        let embeddings: Vec<Vec<f32>> = result.data.into_iter().map(|d| d.embedding).collect();
        let dimension = embeddings.first().map(|e| e.len() as i32).unwrap_or(0);

        Ok(EmbeddingBatch {
            embeddings,
            model: self.model.clone(),
            dimension,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_embedding_request_serialization() {
        let request = EmbeddingRequest {
            model: "test-model".to_string(),
            input: vec!["hello world".to_string()],
        };
        let json = serde_json::to_string(&request).unwrap();
        assert!(json.contains("test-model"));
        assert!(json.contains("hello world"));
    }

    #[test]
    fn test_embedding_response_deserialization() {
        let json = r#"{
            "data": [
                {"embedding": [0.1, 0.2, 0.3]},
                {"embedding": [0.4, 0.5, 0.6]}
            ]
        }"#;
        let response: EmbeddingResponse = serde_json::from_str(json).unwrap();
        assert_eq!(response.data.len(), 2);
        assert_eq!(response.data[0].embedding, vec![0.1, 0.2, 0.3]);
        assert_eq!(response.data[1].embedding, vec![0.4, 0.5, 0.6]);
    }
}