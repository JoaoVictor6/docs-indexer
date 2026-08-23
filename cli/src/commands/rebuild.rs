use anyhow::Context;
use sqlx::PgPool;
use std::path::Path;
use tracing::info;

use crate::config::Config;
use crate::db;
use crate::embedding::EmbeddingProvider;

use super::index;

pub async fn run(
    pool: &PgPool,
    provider: &dyn EmbeddingProvider,
    config: &Config,
    project_name: &str,
    repository: &Path,
    commit_sha: Option<&str>,
) -> anyhow::Result<()> {
    let project = db::upsert_project(pool, project_name, None, "main", None).await?;

    info!(
        project = %project_name,
        "rebuilding index — deleting all existing documents"
    );

    db::delete_all_project_documents(pool, project.id).await?;

    info!(
        project = %project_name,
        "re-indexing from scratch"
    );

    index::run(
        pool,
        provider,
        config,
        project_name,
        repository,
        None,
        commit_sha,
    )
    .await
    .context("failed to re-index during rebuild")?;

    info!(
        project = %project_name,
        "rebuild complete"
    );

    Ok(())
}