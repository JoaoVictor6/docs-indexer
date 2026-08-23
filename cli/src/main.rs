use anyhow::Context;
use clap::{Parser, Subcommand};
use docs_indexer::{commands, config, db, openrouter};
use std::path::PathBuf;
use tracing_subscriber::filter::EnvFilter;

#[derive(Parser)]
#[command(
    name = "docs-indexer",
    version,
    about = "Semantic documentation indexer for AI agents"
)]
pub struct Cli {
    #[command(subcommand)]
    pub command: Command,
}

#[derive(Subcommand)]
pub enum Command {
    /// Index documentation files into pgVector
    Index {
        #[arg(long)]
        project: String,

        #[arg(long)]
        repository: PathBuf,

        #[arg(long, num_args = 1..)]
        files: Option<Vec<PathBuf>>,

        #[arg(long)]
        commit_sha: Option<String>,
    },
    /// Delete indexed files for a project
    Delete {
        #[arg(long)]
        project: String,

        #[arg(long, num_args = 1..)]
        files: Vec<PathBuf>,
    },
    /// Rebuild the entire index for a project
    Rebuild {
        #[arg(long)]
        project: String,

        #[arg(long)]
        repository: PathBuf,

        #[arg(long)]
        commit_sha: Option<String>,
    },
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()))
        .init();

    let cli = Cli::parse();

    let config = config::Config::from_file(&PathBuf::from("config.yaml"))
        .context("failed to load configuration")?;

    let pool = db::create_pool(&config)?;
    db::run_migrations(&pool).await?;

    let provider = openrouter::OpenRouterProvider::new(&config);

    match cli.command {
        Command::Index {
            project,
            repository,
            files,
            commit_sha,
        } => {
            let files_ref: Option<Vec<PathBuf>> = files;
            commands::index::run(
                &pool,
                &provider,
                &config,
                &project,
                &repository,
                files_ref.as_deref(),
                commit_sha.as_deref(),
            )
            .await?;
        }
        Command::Delete { project, files } => {
            commands::delete::run(&pool, &project, &files).await?;
        }
        Command::Rebuild {
            project,
            repository,
            commit_sha,
        } => {
            commands::rebuild::run(
                &pool,
                &provider,
                &config,
                &project,
                &repository,
                commit_sha.as_deref(),
            )
            .await?;
        }
    }

    Ok(())
}