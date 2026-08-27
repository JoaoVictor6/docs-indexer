use anyhow::Context;
use sqlx::PgPool;
use std::path::Path;
use tracing::info;

use crate::config::Config;
use crate::db;
use crate::embedding::EmbeddingProvider;
use crate::git::resolve_git_remote_url;

use super::index;

pub async fn run(
    pool: &PgPool,
    embedding_provider: &dyn EmbeddingProvider,
    config: &Config,
    project_name: &str,
    repository: &Path,
    commit_sha: Option<&str>,
    repository_url: Option<&str>,
    provider: Option<&str>,
) -> anyhow::Result<()> {
    let effective_url = repository_url
        .map(String::from)
        .or_else(|| resolve_git_remote_url(repository));
    let project =
        db::upsert_project(pool, project_name, effective_url.as_deref(), "main", provider).await?;

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
        embedding_provider,
        config,
        project_name,
        repository,
        None,
        commit_sha,
        effective_url.as_deref(),
        provider,
    )
    .await
    .context("failed to re-index during rebuild")?;

    info!(
        project = %project_name,
        "rebuild complete"
    );

    Ok(())
}