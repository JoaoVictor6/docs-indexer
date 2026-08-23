use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct Project {
    pub id: i32,
    pub name: String,
    pub repository_url: Option<String>,
    pub default_branch: String,
    pub provider: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct Document {
    pub id: i32,
    pub project_id: i32,
    pub path: String,
    pub commit_sha: Option<String>,
    pub title: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone)]
pub struct ChunkInsert {
    pub chunk_index: i32,
    pub text: String,
    pub embedding: pgvector::Vector,
    pub heading: Option<String>,
    pub metadata: serde_json::Value,
}