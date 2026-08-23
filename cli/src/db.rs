use anyhow::Context;
use sqlx::postgres::PgPoolOptions;
use sqlx::PgPool;

use crate::config::Config;
use crate::models::{ChunkInsert, Document, Project};

pub fn create_pool(config: &Config) -> anyhow::Result<PgPool> {
    PgPoolOptions::new()
        .max_connections(10)
        .connect_lazy(&config.database_url)
        .context("failed to create database connection pool")
}

pub async fn run_migrations(pool: &PgPool) -> anyhow::Result<()> {
    let migrations = [
        ("001", include_str!("../../infra/migrations/001_create_projects.sql")),
        ("002", include_str!("../../infra/migrations/002_create_documents.sql")),
        ("003", include_str!("../../infra/migrations/003_create_chunks.sql")),
    ];

    for (name, sql) in &migrations {
        for statement in sql.split(';').map(|s| s.trim()).filter(|s| !s.is_empty()) {
            sqlx::query(statement)
                .execute(pool)
                .await
                .with_context(|| format!("failed to run migration {name}: {statement:.80}..."))?;
        }
    }

    Ok(())
}

pub async fn upsert_project(
    pool: &PgPool,
    name: &str,
    git_url: Option<&str>,
    branch: &str,
    provider: Option<&str>,
) -> anyhow::Result<Project> {
    sqlx::query_as::<_, Project>(
        r#"
        INSERT INTO projects (name, repository_url, default_branch, provider)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (name)
        DO UPDATE SET
            repository_url = COALESCE(EXCLUDED.repository_url, projects.repository_url),
            default_branch = EXCLUDED.default_branch,
            provider = COALESCE(EXCLUDED.provider, projects.provider),
            updated_at = NOW()
        RETURNING *
        "#,
    )
    .bind(name)
    .bind(git_url)
    .bind(branch)
    .bind(provider)
    .fetch_one(pool)
    .await
    .context("failed to upsert project")
}

pub async fn upsert_document(
    pool: &PgPool,
    project_id: i32,
    path: &str,
    commit_sha: Option<&str>,
    title: Option<&str>,
) -> anyhow::Result<Document> {
    sqlx::query_as::<_, Document>(
        r#"
        INSERT INTO documents (project_id, path, commit_sha, title)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (project_id, path)
        DO UPDATE SET
            commit_sha = COALESCE(EXCLUDED.commit_sha, documents.commit_sha),
            title = COALESCE(EXCLUDED.title, documents.title),
            updated_at = NOW()
        RETURNING *
        "#,
    )
    .bind(project_id)
    .bind(path)
    .bind(commit_sha)
    .bind(title)
    .fetch_one(pool)
    .await
    .context("failed to upsert document")
}

pub async fn delete_document(
    pool: &PgPool,
    project_id: i32,
    path: &str,
) -> anyhow::Result<()> {
    sqlx::query("DELETE FROM documents WHERE project_id = $1 AND path = $2")
        .bind(project_id)
        .bind(path)
        .execute(pool)
        .await
        .context("failed to delete document")?;

    Ok(())
}

pub async fn delete_all_project_documents(
    pool: &PgPool,
    project_id: i32,
) -> anyhow::Result<()> {
    sqlx::query("DELETE FROM documents WHERE project_id = $1")
        .bind(project_id)
        .execute(pool)
        .await
        .context("failed to delete all project documents")?;

    Ok(())
}

pub async fn insert_chunks(
    pool: &PgPool,
    document_id: i32,
    chunks: &[ChunkInsert],
) -> anyhow::Result<()> {
    for chunk in chunks {
        sqlx::query(
            r#"
            INSERT INTO chunks (document_id, chunk_index, text, embedding, heading, metadata)
            VALUES ($1, $2, $3, $4, $5, $6)
            "#,
        )
        .bind(document_id)
        .bind(chunk.chunk_index)
        .bind(&chunk.text)
        .bind(&chunk.embedding)
        .bind(&chunk.heading)
        .bind(&chunk.metadata)
        .execute(pool)
        .await
        .context("failed to insert chunk")?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_create_pool_with_invalid_url_still_returns_ok() {
        let config = Config {
            database_url: "postgres://invalid:5432/doesnotexist".to_string(),
            openrouter_api_key: "sk-test".to_string(),
            openrouter_base_url: "https://example.com".to_string(),
            embedding_model: "test".to_string(),
            embedding_dimension: 1536,
        };

        let pool = create_pool(&config);
        assert!(pool.is_ok(), "connect_lazy should not fail on invalid URL");
    }
}