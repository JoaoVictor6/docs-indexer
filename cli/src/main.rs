mod config;
mod embedding;
mod openrouter;

use clap::{Parser, Subcommand};
use std::path::PathBuf;

#[derive(Parser)]
#[command(
    name = "docs-indexer",
    version,
    about = "Semantic documentation indexer for AI agents",
    long_about = "Scans documentation repositories, chunks Markdown files, generates embeddings via OpenRouter, and persists them to PostgreSQL + pgVector."
)]
pub struct Cli {
    #[command(subcommand)]
    pub command: Command,
}

#[derive(Subcommand)]
pub enum Command {
    /// Index documentation files into pgVector
    Index {
        /// Project name (must match a registered project)
        #[arg(long)]
        project: String,

        /// Root directory of the documentation repository
        #[arg(long)]
        repository: PathBuf,

        /// Specific files to index (relative to repository root). If omitted, all .md/.mdx files are scanned.
        #[arg(long, num_args = 1..)]
        files: Option<Vec<PathBuf>>,

        /// Commit SHA of the main branch version being indexed
        #[arg(long)]
        commit_sha: Option<String>,
    },
    /// Delete indexed files for a project
    Delete {
        /// Project name
        #[arg(long)]
        project: String,

        /// Files to remove from the index (relative paths from repository root)
        #[arg(long, num_args = 1..)]
        files: Vec<PathBuf>,
    },
    /// Rebuild the entire index for a project (deletes all chunks, then re-indexes)
    Rebuild {
        /// Project name
        #[arg(long)]
        project: String,

        /// Root directory of the documentation repository
        #[arg(long)]
        repository: PathBuf,

        /// Commit SHA of the main branch version being indexed
        #[arg(long)]
        commit_sha: Option<String>,
    },
}

fn main() {
    let cli = Cli::parse();
    match &cli.command {
        Command::Index { project, .. } => println!("Command: index (project: {})", project),
        Command::Delete { project, .. } => println!("Command: delete (project: {})", project),
        Command::Rebuild { project, .. } => println!("Command: rebuild (project: {})", project),
    }
}