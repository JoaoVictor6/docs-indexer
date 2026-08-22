use async_trait::async_trait;

#[derive(Debug, Clone)]
pub struct EmbeddingBatch {
    pub embeddings: Vec<Vec<f32>>,
    pub model: String,
    pub dimension: i32,
}

#[async_trait]
pub trait EmbeddingProvider: Send + Sync {
    async fn embed(&self, texts: &[String]) -> anyhow::Result<EmbeddingBatch>;
}