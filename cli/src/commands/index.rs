use anyhow::Context;
use std::path::{Path, PathBuf};
use std::time::Instant;
use tracing::info;

use crate::chunker::chunk_document;
use crate::config::Config;
use crate::db;
use crate::embedding::EmbeddingProvider;
use crate::models::ChunkInsert;
use crate::scanner;
use sqlx::PgPool;

pub async fn run(
    pool: &PgPool,
    provider: &dyn EmbeddingProvider,
    _config: &Config,
    project_name: &str,
    repository: &Path,
    files: Option<&[PathBuf]>,
    commit_sha: Option<&str>,
) -> anyhow::Result<()> {
    let project = db::upsert_project(pool, project_name, None, "main", None).await?;

    let scanned = match files {
        Some(paths) if !paths.is_empty() => {
            scanner::scan_specific_files(repository, paths, &["md", "mdx"])?
        }
        _ => scanner::scan_repository(repository, &["md", "mdx"])?,
    };

    if scanned.is_empty() {
        info!(
            project = %project_name,
            repository = %repository.display(),
            "no markdown files found"
        );
        return Ok(());
    }

    info!(
        project = %project_name,
        file_count = scanned.len(),
        "starting indexing"
    );

    for file in &scanned {
        let start = Instant::now();

        let chunks = chunk_document(&file.content);
        let chunk_count = chunks.len();

        if chunk_count == 0 {
            info!(
                project = %project_name,
                path = %file.relative_path,
                "no chunks produced, skipping"
            );
            continue;
        }

        let texts: Vec<String> = chunks.iter().map(|c| c.text.clone()).collect();
        let batch = provider
            .embed(&texts)
            .await
            .with_context(|| format!("failed to embed chunks for {}", file.relative_path))?;

        let mut tx = pool.begin().await.context("failed to begin transaction")?;

        sqlx::query("DELETE FROM documents WHERE project_id = $1 AND path = $2")
            .bind(project.id)
            .bind(&file.relative_path)
            .execute(&mut *tx)
            .await
            .context("failed to delete document in transaction")?;

        let document = sqlx::query_as::<_, crate::models::Document>(
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
        .bind(project.id)
        .bind(&file.relative_path)
        .bind(commit_sha)
        .bind(None::<&str>)
        .fetch_one(&mut *tx)
        .await
        .context("failed to upsert document in transaction")?;

        let chunk_inserts: Vec<ChunkInsert> = chunks
            .iter()
            .zip(batch.embeddings.iter())
            .map(|(chunk, embedding)| {
                let metadata = serde_json::json!({
                    "heading_path": chunk.heading_path,
                    "model": batch.model,
                    "dimension": batch.dimension,
                    "chunk_size": chunk.text.len(),
                });

                ChunkInsert {
                    chunk_index: chunk.chunk_index as i32,
                    text: chunk.text.clone(),
                    embedding: pgvector::Vector::from(embedding.clone()),
                    heading: chunk.heading.clone(),
                    metadata,
                }
            })
            .collect();

        for chunk in &chunk_inserts {
            sqlx::query(
                r#"
                INSERT INTO chunks (document_id, chunk_index, text, embedding, heading, metadata)
                VALUES ($1, $2, $3, $4, $5, $6)
                "#,
            )
            .bind(document.id)
            .bind(chunk.chunk_index)
            .bind(&chunk.text)
            .bind(&chunk.embedding)
            .bind(&chunk.heading)
            .bind(&chunk.metadata)
            .execute(&mut *tx)
            .await
            .context("failed to insert chunk in transaction")?;
        }

        tx.commit().await.context("failed to commit transaction")?;

        info!(
            project = %project_name,
            path = %file.relative_path,
            status = "indexed",
            chunks = chunk_count,
            duration_ms = start.elapsed().as_millis(),
            commit_sha = %commit_sha.unwrap_or("unknown"),
            model = %batch.model,
        );
    }

    info!(
        project = %project_name,
        status = "complete",
        file_count = scanned.len(),
    );

    Ok(())
}