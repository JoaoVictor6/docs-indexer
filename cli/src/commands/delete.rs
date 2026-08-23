use anyhow::Context;
use sqlx::PgPool;
use std::path::PathBuf;
use tracing::info;

use crate::db;

pub async fn run(
    pool: &PgPool,
    project_name: &str,
    files: &[PathBuf],
) -> anyhow::Result<()> {
    let project_id: (i32,) = sqlx::query_as("SELECT id FROM projects WHERE name = $1")
        .bind(project_name)
        .fetch_optional(pool)
        .await
        .context("failed to query project")?
        .with_context(|| format!("project '{}' not found", project_name))?;

    for file in files {
        let path = file.to_string_lossy().to_string();
        db::delete_document(pool, project_id.0, &path).await?;

        info!(
            project = %project_name,
            path = %path,
            status = "deleted",
        );
    }

    Ok(())
}