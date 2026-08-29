use docs_indexer::chunker::chunk_document;
use docs_indexer::commands::index;
use docs_indexer::config::Config;
use docs_indexer::db;
use docs_indexer::openrouter::OpenRouterProvider;
use docs_indexer::scanner;
use sqlx::Row;
use std::fs;
use tempfile::TempDir;

fn setup_docs_fixture(dir: &TempDir) {
    let docs = dir.path().join("docs");
    fs::create_dir_all(&docs).unwrap();

    fs::write(
        docs.join("architecture.md"),
        "\
## Overview
This document describes the system architecture.

## Components
The system has three main components: API server, database, and worker.

## Authentication
All requests must include a valid JWT token in the Authorization header.
",
    )
    .unwrap();

    fs::write(
        docs.join("setup.md"),
        "\
## Prerequisites
You need Rust 1.80 or later and PostgreSQL 16.

## Installation
Run `cargo install docs-indexer` to install.

## Configuration
Copy `.env.example` to `.env` and fill in your credentials.
",
    )
    .unwrap();
}

fn load_config() -> Option<Config> {
    let _ = dotenvy::dotenv().ok();

    let database_url = std::env::var("DATABASE_URL").ok()?;
    let openrouter_key = std::env::var("OPENROUTER_API_KEY").ok()?;

    Some(Config {
        database_url,
        openrouter_api_key: openrouter_key,
        openrouter_base_url: std::env::var("OPENROUTER_BASE_URL")
            .unwrap_or_else(|_| "https://openrouter.ai/api/v1".to_string()),
        embedding_model: std::env::var("EMBEDDING_MODEL")
            .unwrap_or_else(|_| "openai/text-embedding-3-small".to_string()),
        embedding_dimension: std::env::var("EMBEDDING_DIMENSION")
            .unwrap_or_else(|_| "1536".to_string())
            .parse()
            .expect("EMBEDDING_DIMENSION must be an integer"),
    })
}

#[tokio::test]
async fn test_chunker_on_fixture_documents() {
    let dir = TempDir::new().unwrap();
    setup_docs_fixture(&dir);

    let files = scanner::scan_repository(dir.path(), &["md"]).unwrap();
    assert_eq!(files.len(), 2, "should find 2 markdown files");

    let arch = files
        .iter()
        .find(|f| f.relative_path.contains("architecture"))
        .unwrap();
    let chunks = chunk_document(&arch.content);
    assert_eq!(chunks.len(), 3, "architecture.md has 3 H2 headings");
    assert_eq!(chunks[0].heading.as_deref(), Some("Overview"));
    assert_eq!(chunks[2].heading.as_deref(), Some("Authentication"));
}

#[tokio::test]
async fn test_full_index_pipeline_idempotency_delete_rebuild() {
    let config = match load_config() {
        Some(c) => c,
        None => {
            eprintln!("skipping integration test: DATABASE_URL or OPENROUTER_API_KEY not set");
            return;
        }
    };
    let pool = db::create_pool(&config).expect("should create pool");
    db::run_migrations(&pool)
        .await
        .expect("should run migrations");

    let provider = OpenRouterProvider::new(&config);
    let dir = TempDir::new().unwrap();
    setup_docs_fixture(&dir);

    let project_name = format!("integration-test-{}", uuid::Uuid::new_v4());

    index::run(
        &pool,
        &provider,
        &config,
        &project_name,
        dir.path(),
        None,
        Some("commit-001"),
        None,
        None,
    )
    .await
    .expect("initial indexing should succeed");

    let rows = sqlx::query(
        r#"
        SELECT d.path, COUNT(c.id) as chunk_count
        FROM projects p
        JOIN documents d ON d.project_id = p.id
        JOIN chunks c ON c.document_id = d.id
        WHERE p.name = $1
        GROUP BY d.path
        ORDER BY d.path
        "#,
    )
    .bind(&project_name)
    .fetch_all(&pool)
    .await
    .expect("should query chunks");

    assert_eq!(rows.len(), 2, "should have 2 documents indexed");

    let commit_sha: String = sqlx::query_scalar(
        "SELECT d.commit_sha FROM documents d JOIN projects p ON d.project_id = p.id WHERE p.name = $1 LIMIT 1",
    )
    .bind(&project_name)
    .fetch_one(&pool)
    .await
    .expect("should get commit_sha");
    assert_eq!(commit_sha, "commit-001", "commit_sha should be stored");

    let total_chunks_before: i64 = rows.iter().map(|r| r.get::<i64, _>("chunk_count")).sum();

    index::run(
        &pool,
        &provider,
        &config,
        &project_name,
        dir.path(),
        None,
        Some("commit-001"),
        None,
        None,
    )
    .await
    .expect("second indexing (idempotent) should succeed");

    let total_chunks_after: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM chunks c JOIN documents d ON c.document_id = d.id JOIN projects p ON d.project_id = p.id WHERE p.name = $1",
    )
    .bind(&project_name)
    .fetch_one(&pool)
    .await
    .unwrap();

    assert_eq!(
        total_chunks_before, total_chunks_after,
        "re-indexing the same content must produce identical chunk count (idempotency)"
    );

    let project_id: (i32,) = sqlx::query_as("SELECT id FROM projects WHERE name = $1")
        .bind(&project_name)
        .fetch_one(&pool)
        .await
        .unwrap();

    db::delete_document(&pool, project_id.0, "docs/setup.md")
        .await
        .expect("delete should succeed");

    let remaining: Vec<String> = sqlx::query_scalar(
        "SELECT d.path FROM documents d WHERE d.project_id = $1 ORDER BY d.path",
    )
    .bind(project_id.0)
    .fetch_all(&pool)
    .await
    .unwrap();

    assert_eq!(remaining, vec!["docs/architecture.md"], "only architecture.md should remain after delete");

    db::delete_all_project_documents(&pool, project_id.0)
        .await
        .unwrap();

    index::run(
        &pool,
        &provider,
        &config,
        &project_name,
        dir.path(),
        None,
        Some("commit-002"),
        None,
        None,
    )
    .await
    .expect("rebuild (re-index after delete_all) should succeed");

    let count_rebuilt: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM chunks c JOIN documents d ON c.document_id = d.id WHERE d.project_id = $1",
    )
    .bind(project_id.0)
    .fetch_one(&pool)
    .await
    .unwrap();

    assert!(count_rebuilt > 0, "rebuilt index should have chunks");

    sqlx::query("DELETE FROM documents WHERE project_id = $1")
        .bind(project_id.0)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("DELETE FROM projects WHERE id = $1")
        .bind(project_id.0)
        .execute(&pool)
        .await
        .unwrap();
}