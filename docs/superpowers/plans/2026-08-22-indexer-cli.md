# Indexer CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Rust Indexer CLI — a command-line tool that scans documentation repositories, chunks Markdown files, generates embeddings via OpenRouter, and persists them to PostgreSQL+pgVector with transactional idempotency.

**Architecture:** Monorepo with `cli/` (Rust binary) and `infra/` (Docker Compose + SQL migrations). The CLI follows a pipeline: scan → parse → chunk → embed → persist. Each file is indexed atomically in a PostgreSQL transaction. Docker Compose provisions a local PostgreSQL 16 + pgvector for development.

**Tech Stack:** Rust (edition 2021), clap 4 (CLI args), tokio 1 (async runtime), sqlx 0.8 + pgvector 0.3 (PostgreSQL driver), reqwest 0.12 (HTTP client), pulldown-cmark 0.12 (Markdown parser), serde/serde_json/serde_yaml, async-trait, tracing + tracing-subscriber, Docker Compose, PostgreSQL 16 + pgvector 0.7.

**Spec:** `PRD.md` — sections 8–18, 30–38, 39 (RF01–RF07, RF12–RF14), 40 (RNF01–RNF02, RNF05–RNF07), 41

## Global Constraints

- Rust edition 2021, stable toolchain 1.80+
- PostgreSQL 16 with pgVector extension v0.7+
- Secrets via environment variables only — never in config files or committed code
- Indexer must be stateless — no local persistent state between runs
- The `main` branch of each documentation repo is the source of truth
- All indexing operations must be idempotent: run twice = same logical state
- Document identity = `project_id + path` (unique constraint on both columns)
- Embedding model name and dimension stored in chunk metadata for future model migration
- Structured JSON logging to stdout via `tracing-subscriber` json feature
- Any external failure must roll back the per-file transaction (never leave partial chunks)

---

### Task 1: Monorepo Scaffold and Rust Crate

**Files:**
- Create: `cli/Cargo.toml`
- Create: `cli/src/main.rs`
- Create: `.gitignore`

**Interfaces:**
- Consumes: *nothing (greenfield)*
- Produces: Rust binary crate `docs-indexer`, compiles with `cargo build`

- [ ] **Step 1: Write `.gitignore`**

```gitignore
/target/
.env
*.rs.bk
.idea/
.vscode/
*.swp
*.swo
.DS_Store
```

- [ ] **Step 2: Write `cli/Cargo.toml`**

```toml
[package]
name = "docs-indexer"
version = "0.1.0"
edition = "2021"

[[bin]]
name = "docs-indexer"
path = "src/main.rs"

[dependencies]
clap = { version = "4", features = ["derive"] }
tokio = { version = "1", features = ["full"] }
sqlx = { version = "0.8", features = ["runtime-tokio", "tls-rustls", "postgres", "chrono"] }
pgvector = { version = "0.3", features = ["sqlx"] }
reqwest = { version = "0.12", features = ["json"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
serde_yaml = "0.9"
async-trait = "0.1"
tracing = "0.1"
tracing-subscriber = { version = "0.3", features = ["json", "env-filter"] }
pulldown-cmark = "0.12"
anyhow = "1"
uuid = { version = "1", features = ["v4", "serde"] }
chrono = { version = "0.4", features = ["serde"] }
dotenvy = "0.15"

[dev-dependencies]
tempfile = "3"
```

- [ ] **Step 3: Write `cli/src/main.rs`**

```rust
fn main() {
    println!("docs-indexer v0.1.0");
}
```

- [ ] **Step 4: Initialize git, build, and run**

```bash
cd /home/joao/projects/docs-indexer && git init
cargo build
cargo run
```

Expected: `docs-indexer v0.1.0`

- [ ] **Step 5: Commit**

```bash
git add .gitignore cli/Cargo.toml cli/src/main.rs
git commit -m "chore: scaffold docs-indexer Rust crate with cargo init"
```

---

### Task 2: Docker Compose and SQL Migrations

**Files:**
- Create: `infra/docker-compose.yml`
- Create: `infra/migrations/001_create_projects.sql`
- Create: `infra/migrations/002_create_documents.sql`
- Create: `infra/migrations/003_create_chunks.sql`
- Create: `.env.example`

**Interfaces:**
- Consumes: *nothing*
- Produces: `docker compose -f infra/docker-compose.yml up -d` starts PostgreSQL 16 + pgvector on port 5432 with all 3 tables created

- [ ] **Step 1: Write `.env.example`**

```env
DATABASE_URL=postgres://docsindexer:docsindexer@localhost:5432/docsindexer
OPENROUTER_API_KEY=sk-or-v1-your-key-here
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
EMBEDDING_MODEL=openai/text-embedding-3-small
EMBEDDING_DIMENSION=1536
RUST_LOG=info,docs_indexer=debug
```

- [ ] **Step 2: Write `infra/docker-compose.yml`**

```yaml
services:
  db:
    image: pgvector/pgvector:pg16
    container_name: docsindexer-db
    environment:
      POSTGRES_USER: docsindexer
      POSTGRES_PASSWORD: docsindexer
      POSTGRES_DB: docsindexer
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
      - ./migrations:/docker-entrypoint-initdb.d
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U docsindexer -d docsindexer"]
      interval: 3s
      timeout: 3s
      retries: 10

volumes:
  pgdata:
```

- [ ] **Step 3: Write `infra/migrations/001_create_projects.sql`**

```sql
CREATE TABLE IF NOT EXISTS projects (
    id              SERIAL PRIMARY KEY,
    name            TEXT NOT NULL UNIQUE,
    repository_url  TEXT,
    default_branch  TEXT NOT NULL DEFAULT 'main',
    provider        TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

- [ ] **Step 4: Write `infra/migrations/002_create_documents.sql`**

```sql
CREATE TABLE IF NOT EXISTS documents (
    id          SERIAL PRIMARY KEY,
    project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    path        TEXT NOT NULL,
    commit_sha  TEXT,
    title       TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(project_id, path)
);

CREATE INDEX IF NOT EXISTS idx_documents_project_id ON documents(project_id);
```

- [ ] **Step 5: Write `infra/migrations/003_create_chunks.sql`**

```sql
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS chunks (
    id              SERIAL PRIMARY KEY,
    document_id     INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    chunk_index     INTEGER NOT NULL,
    text            TEXT NOT NULL,
    embedding       vector(1536),
    heading         TEXT,
    metadata        JSONB NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(document_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS idx_chunks_document_id ON chunks(document_id);

CREATE INDEX IF NOT EXISTS idx_chunks_embedding
    ON chunks USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 100);
```

- [ ] **Step 6: Start the database and verify**

```bash
docker compose -f infra/docker-compose.yml up -d
sleep 5
docker compose -f infra/docker-compose.yml ps
```

Expected: `docsindexer-db` is `Up` and healthy.

Verify tables:

```bash
docker compose -f infra/docker-compose.yml exec db psql -U docsindexer -d docsindexer -c "\dt"
```

Expected: `chunks`, `documents`, `projects` listed.

- [ ] **Step 7: Commit**

```bash
git add infra/ .env.example
git commit -m "chore: add docker compose with postgres+pgvector and sql migrations"
```

---

### Task 3: CLI Binary with Clap Subcommands

**Files:**
- Modify: `cli/src/main.rs`

**Interfaces:**
- Consumes: `clap` from Task 1 `Cargo.toml`
- Produces: `Cli { command: Command }` with `Index`, `Delete`, `Rebuild` subcommands. `docs-indexer --help` prints all subcommands.

- [ ] **Step 1: Write `cli/src/main.rs`**

```rust
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
    let _cli = Cli::parse();
    println!("docs-indexer v0.1.0");
}
```

- [ ] **Step 2: Build and verify help output**

```bash
cargo build
cargo run -- --help
```

Expected: full help text showing `index`, `delete`, `rebuild` subcommands.

Verify each subcommand:

```bash
cargo run -- index --help
cargo run -- delete --help
cargo run -- rebuild --help
```

Expected: each shows its specific arguments.

- [ ] **Step 3: Commit**

```bash
git add cli/src/main.rs
git commit -m "feat: add CLI with index, delete, and rebuild subcommands"
```

---

### Task 4: Configuration Module

**Files:**
- Create: `cli/src/config.rs`
- Modify: `cli/src/main.rs` (add `mod config;`)

**Interfaces:**
- Consumes: `serde`, `serde_yaml`, `dotenvy` from Task 1
- Produces:
  - `Config { database_url: String, openrouter_api_key: String, openrouter_base_url: String, embedding_model: String, embedding_dimension: i32 }`
  - `Config::from_file(path: &Path) -> anyhow::Result<Self>` — loads from YAML, applies env var overrides for secrets

- [ ] **Step 1: Write the failing tests in `cli/src/config.rs`**

```rust
use anyhow::Context;
use serde::Deserialize;
use std::path::Path;

#[derive(Debug, Clone, Deserialize)]
pub struct Config {
    pub database_url: String,
    pub openrouter_api_key: String,
    #[serde(default = "default_openrouter_base_url")]
    pub openrouter_base_url: String,
    #[serde(default = "default_embedding_model")]
    pub embedding_model: String,
    #[serde(default = "default_embedding_dimension")]
    pub embedding_dimension: i32,
}

fn default_openrouter_base_url() -> String {
    "https://openrouter.ai/api/v1".to_string()
}

fn default_embedding_model() -> String {
    "openai/text-embedding-3-small".to_string()
}

fn default_embedding_dimension() -> i32 {
    1536
}

impl Config {
    pub fn from_file(path: &Path) -> anyhow::Result<Self> {
        let _ = dotenvy::dotenv();

        let contents = std::fs::read_to_string(path)
            .with_context(|| format!("failed to read config file: {}", path.display()))?;

        let mut config: Self = serde_yaml::from_str(&contents)
            .with_context(|| format!("failed to parse config file: {}", path.display()))?;

        if let Ok(val) = std::env::var("DATABASE_URL") {
            config.database_url = val;
        }
        if let Ok(val) = std::env::var("OPENROUTER_API_KEY") {
            config.openrouter_api_key = val;
        }
        if let Ok(val) = std::env::var("OPENROUTER_BASE_URL") {
            config.openrouter_base_url = val;
        }
        if let Ok(val) = std::env::var("EMBEDDING_MODEL") {
            config.embedding_model = val;
        }
        if let Ok(val) = std::env::var("EMBEDDING_DIMENSION") {
            config.embedding_dimension = val.parse().context("EMBEDDING_DIMENSION must be an integer")?;
        }

        Ok(config)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::NamedTempFile;

    #[test]
    fn test_from_file_basic() {
        let yaml = r#"
database_url: "postgres://localhost/test"
openrouter_api_key: "sk-test-123"
"#;
        let mut file = NamedTempFile::new().unwrap();
        file.write_all(yaml.as_bytes()).unwrap();

        let config = Config::from_file(file.path()).unwrap();
        assert_eq!(config.database_url, "postgres://localhost/test");
        assert_eq!(config.openrouter_api_key, "sk-test-123");
        assert_eq!(config.openrouter_base_url, "https://openrouter.ai/api/v1");
        assert_eq!(config.embedding_model, "openai/text-embedding-3-small");
        assert_eq!(config.embedding_dimension, 1536);
    }

    #[test]
    fn test_from_file_with_custom_fields() {
        let yaml = r#"
database_url: "postgres://localhost/test"
openrouter_api_key: "sk-test"
openrouter_base_url: "https://custom.api/v1"
embedding_model: "custom-model"
embedding_dimension: 768
"#;
        let mut file = NamedTempFile::new().unwrap();
        file.write_all(yaml.as_bytes()).unwrap();

        let config = Config::from_file(file.path()).unwrap();
        assert_eq!(config.openrouter_base_url, "https://custom.api/v1");
        assert_eq!(config.embedding_model, "custom-model");
        assert_eq!(config.embedding_dimension, 768);
    }

    #[test]
    fn test_env_var_overrides_file() {
        let yaml = r#"
database_url: "postgres://localhost/test"
openrouter_api_key: "sk-file-key"
"#;
        let mut file = NamedTempFile::new().unwrap();
        file.write_all(yaml.as_bytes()).unwrap();

        std::env::set_var("OPENROUTER_API_KEY", "sk-env-key");
        std::env::set_var("EMBEDDING_DIMENSION", "3072");

        let config = Config::from_file(file.path()).unwrap();
        assert_eq!(config.openrouter_api_key, "sk-env-key");
        assert_eq!(config.embedding_dimension, 3072);
    }

    #[test]
    fn test_missing_file_is_error() {
        let result = Config::from_file(Path::new("/nonexistent/config.yaml"));
        assert!(result.is_err());
    }

    #[test]
    fn test_invalid_yaml_is_error() {
        let mut file = NamedTempFile::new().unwrap();
        file.write_all(b"not: valid: yaml: [").unwrap();
        let result = Config::from_file(file.path());
        assert!(result.is_err());
    }
}
```

- [ ] **Step 2: Update `cli/src/main.rs`** — add `mod config;`

```rust
mod config;

use clap::{Parser, Subcommand};
use std::path::PathBuf;
```

- [ ] **Step 3: Run tests**

```bash
cargo test
```

Expected: 5 tests pass (`test_from_file_basic`, `test_from_file_with_custom_fields`, `test_env_var_overrides_file`, `test_missing_file_is_error`, `test_invalid_yaml_is_error`).

- [ ] **Step 4: Commit**

```bash
git add cli/src/config.rs cli/src/main.rs
git commit -m "feat: add configuration module with yaml file and env var overrides"
```

---

### Task 5: EmbeddingProvider Trait and OpenRouter Implementation

**Files:**
- Create: `cli/src/embedding.rs`
- Create: `cli/src/openrouter.rs`
- Modify: `cli/src/main.rs` (add `mod embedding; mod openrouter;`)

**Interfaces:**
- Consumes: `config::Config` (Task 4), `reqwest` (Task 1)
- Produces:
  - `embedding::EmbeddingBatch { embeddings: Vec<Vec<f32>>, model: String, dimension: i32 }`
  - `embedding::EmbeddingProvider` trait: `async fn embed(&self, texts: &[String]) -> anyhow::Result<EmbeddingBatch>`
  - `openrouter::OpenRouterProvider::new(config: &Config) -> Self` implements `EmbeddingProvider`

- [ ] **Step 1: Write `cli/src/embedding.rs`**

```rust
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
```

- [ ] **Step 2: Write `cli/src/openrouter.rs`**

```rust
use anyhow::Context;
use async_trait::async_trait;
use reqwest::Client;
use serde::{Deserialize, Serialize};

use crate::config::Config;
use crate::embedding::{EmbeddingBatch, EmbeddingProvider};

pub struct OpenRouterProvider {
    client: Client,
    api_key: String,
    base_url: String,
    model: String,
}

impl OpenRouterProvider {
    pub fn new(config: &Config) -> Self {
        Self {
            client: Client::new(),
            api_key: config.openrouter_api_key.clone(),
            base_url: config.openrouter_base_url.clone(),
            model: config.embedding_model.clone(),
        }
    }
}

#[derive(Serialize)]
struct EmbeddingRequest {
    model: String,
    input: Vec<String>,
}

#[derive(Deserialize)]
struct EmbeddingData {
    embedding: Vec<f32>,
}

#[derive(Deserialize)]
struct EmbeddingResponse {
    data: Vec<EmbeddingData>,
}

#[async_trait]
impl EmbeddingProvider for OpenRouterProvider {
    async fn embed(&self, texts: &[String]) -> anyhow::Result<EmbeddingBatch> {
        let url = format!("{}/embeddings", self.base_url);

        let request = EmbeddingRequest {
            model: self.model.clone(),
            input: texts.to_vec(),
        };

        let response = self
            .client
            .post(&url)
            .header("Authorization", format!("Bearer {}", self.api_key))
            .header("Content-Type", "application/json")
            .json(&request)
            .send()
            .await
            .context("failed to send embedding request to OpenRouter")?;

        let status = response.status();
        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            anyhow::bail!("OpenRouter returned {}: {}", status, body);
        }

        let result: EmbeddingResponse = response
            .json()
            .await
            .context("failed to parse OpenRouter response")?;

        let embeddings: Vec<Vec<f32>> = result.data.into_iter().map(|d| d.embedding).collect();
        let dimension = embeddings.first().map(|e| e.len() as i32).unwrap_or(0);

        Ok(EmbeddingBatch {
            embeddings,
            model: self.model.clone(),
            dimension,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_embedding_request_serialization() {
        let request = EmbeddingRequest {
            model: "test-model".to_string(),
            input: vec!["hello world".to_string()],
        };
        let json = serde_json::to_string(&request).unwrap();
        assert!(json.contains("test-model"));
        assert!(json.contains("hello world"));
    }

    #[test]
    fn test_embedding_response_deserialization() {
        let json = r#"{
            "data": [
                {"embedding": [0.1, 0.2, 0.3]},
                {"embedding": [0.4, 0.5, 0.6]}
            ]
        }"#;
        let response: EmbeddingResponse = serde_json::from_str(json).unwrap();
        assert_eq!(response.data.len(), 2);
        assert_eq!(response.data[0].embedding, vec![0.1, 0.2, 0.3]);
        assert_eq!(response.data[1].embedding, vec![0.4, 0.5, 0.6]);
    }
}
```

- [ ] **Step 3: Update `cli/src/main.rs`** — add module declarations

```rust
mod config;
mod embedding;
mod openrouter;

use clap::{Parser, Subcommand};
use std::path::PathBuf;
```

- [ ] **Step 4: Run tests**

```bash
cargo test
```

Expected: 7 tests pass (5 config + 2 openrouter).

- [ ] **Step 5: Commit**

```bash
git add cli/src/embedding.rs cli/src/openrouter.rs cli/src/main.rs
git commit -m "feat: add EmbeddingProvider trait and OpenRouter implementation"
```

---

### Task 6: Markdown Chunker with Heading-Aware Section Splitting

**Files:**
- Create: `cli/src/chunker.rs`
- Modify: `cli/src/main.rs` (add `mod chunker;`)

**Interfaces:**
- Consumes: `pulldown-cmark` (Task 1)
- Produces:
  - `chunker::Chunk { text: String, heading: Option<String>, heading_path: Vec<String>, chunk_index: usize }`
  - `chunker::chunk_document(content: &str) -> Vec<Chunk>` — splits by headings, sub-splits oversized sections by paragraphs at ~1500-char boundaries

- [ ] **Step 1: Write `cli/src/chunker.rs`**

```rust
use pulldown_cmark::{Event, Parser, Tag, TagEnd};
use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Chunk {
    pub text: String,
    pub heading: Option<String>,
    pub heading_path: Vec<String>,
    pub chunk_index: usize,
}

const MAX_CHUNK_SIZE: usize = 1500;

pub fn chunk_document(content: &str) -> Vec<Chunk> {
    let sections = split_by_headings(content);
    let mut chunks: Vec<Chunk> = Vec::new();
    let mut heading_stack: Vec<String> = Vec::new();

    for (heading_level, heading_text, section_text) in sections {
        if heading_level == 1 {
            heading_stack.clear();
            heading_stack.push(heading_text.clone());
        } else {
            while heading_stack.len() >= heading_level {
                heading_stack.pop();
            }
            heading_stack.push(heading_text.clone());
        }

        let body = section_text.trim().to_string();
        if body.is_empty() {
            continue;
        }

        let current_heading = heading_stack.last().cloned();

        if body.len() <= MAX_CHUNK_SIZE {
            chunks.push(Chunk {
                text: body,
                heading: current_heading,
                heading_path: heading_stack.clone(),
                chunk_index: chunks.len(),
            });
        } else {
            let subchunks = split_by_paragraphs(&body, MAX_CHUNK_SIZE);
            for text in subchunks {
                chunks.push(Chunk {
                    text,
                    heading: current_heading.clone(),
                    heading_path: heading_stack.clone(),
                    chunk_index: chunks.len(),
                });
            }
        }
    }

    chunks
}

fn split_by_headings(content: &str) -> Vec<(usize, String, String)> {
    let parser = Parser::new(content);
    let mut sections: Vec<(usize, String, String)> = Vec::new();
    let mut current_heading_text = String::new();
    let mut current_text = String::new();
    let mut in_heading = false;
    let mut current_level = 1usize;
    let mut first_section = true;

    for event in parser {
        match event {
            Event::Start(Tag::Heading { level, .. }) => {
                in_heading = true;
                current_level = level as usize;

                if !first_section && !current_text.trim().is_empty() {
                    let last_level = sections.last().map(|(l, _, _)| *l).unwrap_or(1);
                    sections.push((last_level, current_heading_text.clone(), current_text.clone()));
                    current_text.clear();
                }
                first_section = false;
                current_heading_text.clear();
            }
            Event::End(TagEnd::Heading(..)) => {
                in_heading = false;
            }
            Event::Text(text) | Event::Code(text) => {
                if in_heading {
                    current_heading_text.push_str(&text);
                } else {
                    current_text.push_str(&text);
                }
            }
            Event::SoftBreak => {
                if !in_heading {
                    current_text.push(' ');
                }
            }
            Event::HardBreak => {
                if !in_heading {
                    current_text.push('\n');
                }
            }
            _ => {}
        }
    }

    if !current_text.trim().is_empty() {
        let last_level = sections.last().map(|(l, _, _)| *l).unwrap_or(1);
        sections.push((last_level, current_heading_text, current_text));
    }

    sections
}

fn split_by_paragraphs(text: &str, max_size: usize) -> Vec<String> {
    let paragraphs: Vec<&str> = text.split("\n\n").collect();
    let mut chunks: Vec<String> = Vec::new();
    let mut current = String::new();

    for para in paragraphs {
        let para = para.trim();
        if para.is_empty() {
            continue;
        }

        if !current.is_empty() && current.len() + para.len() + 2 > max_size {
            chunks.push(current);
            current = String::new();
        }

        if !current.is_empty() {
            current.push_str("\n\n");
        }
        current.push_str(para);
    }

    if !current.is_empty() {
        chunks.push(current);
    }

    chunks
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_chunk_simple_document() {
        let content = "\
## Introduction
This is the introduction text.

## Setup
First, install the CLI. Then configure the database.

### Configuration
Set up the .env file with your credentials.";

        let chunks = chunk_document(content);
        assert_eq!(chunks.len(), 3);

        assert_eq!(chunks[0].heading.as_deref(), Some("Introduction"));
        assert_eq!(chunks[0].heading_path, vec!["Introduction"]);
        assert!(chunks[0].text.contains("introduction text"));

        assert_eq!(chunks[1].heading.as_deref(), Some("Setup"));
        assert_eq!(chunks[1].heading_path, vec!["Setup"]);

        assert_eq!(chunks[2].heading.as_deref(), Some("Configuration"));
        assert_eq!(chunks[2].heading_path, vec!["Setup", "Configuration"]);
    }

    #[test]
    fn test_chunk_empty_document() {
        let chunks = chunk_document("");
        assert!(chunks.is_empty());
    }

    #[test]
    fn test_chunk_no_headings() {
        let content = "This is a plain document with no headings.\n\nIt has multiple paragraphs.";
        let chunks = chunk_document(content);
        assert_eq!(chunks.len(), 1);
        assert!(chunks[0].heading.is_none());
        assert!(chunks[0].heading_path.is_empty());
    }

    #[test]
    fn test_chunk_skips_empty_sections() {
        let content = "\
## Section A
Content A.

## Section B

## Section C
Content C.";
        let chunks = chunk_document(content);
        assert_eq!(chunks.len(), 2);
        assert_eq!(chunks[0].heading.as_deref(), Some("Section A"));
        assert_eq!(chunks[1].heading.as_deref(), Some("Section C"));
    }

    #[test]
    fn test_chunk_with_h1_resets_heading_path() {
        let content = "\
# Architecture

## Overview
The system has three layers.

## Details
Each layer handles a specific concern.";
        let chunks = chunk_document(content);
        assert_eq!(chunks.len(), 2);
        assert_eq!(chunks[0].heading_path, vec!["Architecture", "Overview"]);
        assert_eq!(chunks[1].heading_path, vec!["Architecture", "Details"]);
    }

    #[test]
    fn test_chunk_large_section_splits() {
        let mut content = String::from("## Large Section\n");
        for i in 0..200 {
            content.push_str(&format!(
                "Paragraph {} with enough text to fill space in the chunk buffer.\n\n",
                i
            ));
        }
        let chunks = chunk_document(&content);
        assert!(chunks.len() > 1, "large section should split into multiple chunks");
        for chunk in &chunks {
            assert_eq!(chunk.heading.as_deref(), Some("Large Section"));
        }
    }

    #[test]
    fn test_chunk_indexes_are_sequential() {
        let content = "\
## A
Content A.

## B
Content B.

## C
Content C.";
        let chunks = chunk_document(content);
        for (i, chunk) in chunks.iter().enumerate() {
            assert_eq!(chunk.chunk_index, i);
        }
    }
}
```

- [ ] **Step 2: Update `cli/src/main.rs`** — add `mod chunker;`

- [ ] **Step 3: Run tests**

```bash
cargo test
```

Expected: 14 tests pass (5 config + 2 openrouter + 7 chunker).

- [ ] **Step 4: Commit**

```bash
git add cli/src/chunker.rs cli/src/main.rs
git commit -m "feat: add Markdown chunker with heading-aware section splitting"
```

---

### Task 7: Database Module — Pool, Migration Runner, Repository Layer

**Files:**
- Create: `cli/src/models.rs`
- Create: `cli/src/db.rs`
- Modify: `cli/src/main.rs` (add `mod models; mod db;`)

**Interfaces:**
- Consumes: `config::Config` (Task 4), `sqlx`, `pgvector` (Task 1)
- Produces:
  - `models::Project { id: i32, name: String, repository_url: Option<String>, default_branch: String, provider: Option<String>, created_at: DateTime<Utc>, updated_at: DateTime<Utc> }`
  - `models::Document { id: i32, project_id: i32, path: String, commit_sha: Option<String>, title: Option<String>, created_at: DateTime<Utc>, updated_at: DateTime<Utc> }`
  - `models::ChunkInsert { chunk_index: i32, text: String, embedding: pgvector::Vector, heading: Option<String>, metadata: serde_json::Value }`
  - `db::create_pool(config: &Config) -> anyhow::Result<PgPool>`
  - `db::run_migrations(pool: &PgPool) -> anyhow::Result<()>`
  - `db::upsert_project(pool: &PgPool, name: &str, git_url: Option<&str>, branch: &str, provider: Option<&str>) -> anyhow::Result<Project>`
  - `db::upsert_document(pool: &PgPool, project_id: i32, path: &str, commit_sha: Option<&str>, title: Option<&str>) -> anyhow::Result<Document>`
  - `db::delete_document(pool: &PgPool, project_id: i32, path: &str) -> anyhow::Result<()>`
  - `db::delete_all_project_documents(pool: &PgPool, project_id: i32) -> anyhow::Result<()>`
  - `db::insert_chunks(pool: &PgPool, document_id: i32, chunks: &[ChunkInsert]) -> anyhow::Result<()>`

- [ ] **Step 1: Write `cli/src/models.rs`**

```rust
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
```

- [ ] **Step 2: Write `cli/src/db.rs`**

```rust
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
    sqlx::query(include_str!("../../infra/migrations/001_create_projects.sql"))
        .execute(pool)
        .await
        .context("failed to run migration 001")?;

    sqlx::query(include_str!("../../infra/migrations/002_create_documents.sql"))
        .execute(pool)
        .await
        .context("failed to run migration 002")?;

    sqlx::query(include_str!("../../infra/migrations/003_create_chunks.sql"))
        .execute(pool)
        .await
        .context("failed to run migration 003")?;

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

    #[test]
    fn test_create_pool_with_invalid_url_still_returns_ok() {
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
```

- [ ] **Step 3: Update `cli/src/main.rs`** — add `mod models;` and `mod db;`

- [ ] **Step 4: Build check and run tests**

```bash
cargo build
cargo test
```

Expected: compilation succeeds, 15 tests pass (5 config + 2 openrouter + 7 chunker + 1 db).

- [ ] **Step 5: Commit**

```bash
git add cli/src/models.rs cli/src/db.rs cli/src/main.rs
git commit -m "feat: add database module with pool, migration runner, and repository functions"
```

---

### Task 8: File Scanner

**Files:**
- Create: `cli/src/scanner.rs`
- Modify: `cli/src/main.rs` (add `mod scanner;`)

**Interfaces:**
- Consumes: *nothing outside std*
- Produces:
  - `scanner::ScannedFile { relative_path: String, absolute_path: PathBuf, content: String }`
  - `scanner::scan_repository(root: &Path, extensions: &[&str]) -> anyhow::Result<Vec<ScannedFile>>` — recursive walk, skipping hidden dirs and known non-doc directories
  - `scanner::scan_specific_files(root: &Path, paths: &[PathBuf], extensions: &[&str]) -> anyhow::Result<Vec<ScannedFile>>` — reads only the listed files, filtering by extension

- [ ] **Step 1: Write `cli/src/scanner.rs`**

```rust
use anyhow::Context;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone)]
pub struct ScannedFile {
    pub relative_path: String,
    pub absolute_path: PathBuf,
    pub content: String,
}

const SKIP_DIRS: &[&str] = &[
    "node_modules",
    "target",
    ".git",
    "dist",
    "build",
    "__pycache__",
    "venv",
    ".venv",
    "static",
    "blog",
    ".docusaurus",
];

pub fn scan_repository(root: &Path, extensions: &[&str]) -> anyhow::Result<Vec<ScannedFile>> {
    let root = root
        .canonicalize()
        .with_context(|| format!("failed to resolve path: {}", root.display()))?;

    let mut files = Vec::new();
    scan_dir(&root, &root, extensions, &mut files)?;
    Ok(files)
}

pub fn scan_specific_files(
    root: &Path,
    paths: &[PathBuf],
    extensions: &[&str],
) -> anyhow::Result<Vec<ScannedFile>> {
    let root = root
        .canonicalize()
        .with_context(|| format!("failed to resolve path: {}", root.display()))?;

    let mut results = Vec::new();
    for relative in paths {
        let ext = relative
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("");
        if !extensions.contains(&ext) {
            continue;
        }

        let absolute = root.join(relative);
        let content = fs::read_to_string(&absolute)
            .with_context(|| format!("failed to read file: {}", absolute.display()))?;

        results.push(ScannedFile {
            relative_path: relative.to_string_lossy().to_string(),
            absolute_path: absolute,
            content,
        });
    }
    Ok(results)
}

fn scan_dir(
    base: &Path,
    current: &Path,
    extensions: &[&str],
    files: &mut Vec<ScannedFile>,
) -> anyhow::Result<()> {
    for entry in fs::read_dir(current).context("failed to read directory")? {
        let entry = entry?;
        let path = entry.path();
        let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");

        if path.is_dir() {
            if name.starts_with('.') || SKIP_DIRS.contains(&name) {
                continue;
            }
            scan_dir(base, &path, extensions, files)?;
        } else if path.is_file() {
            if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
                if extensions.contains(&ext) {
                    let content = fs::read_to_string(&path)
                        .with_context(|| format!("failed to read: {}", path.display()))?;
                    let relative = path
                        .strip_prefix(base)
                        .unwrap_or(&path)
                        .to_string_lossy()
                        .to_string();

                    files.push(ScannedFile {
                        relative_path: relative,
                        absolute_path: path,
                        content,
                    });
                }
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::TempDir;

    fn setup_fixture() -> TempDir {
        let dir = TempDir::new().unwrap();
        let docs = dir.path().join("docs");
        fs::create_dir_all(&docs).unwrap();

        let mut f = fs::File::create(docs.join("intro.md")).unwrap();
        f.write_all(b"# Introduction\n\nHello world.\n").unwrap();

        let mut f = fs::File::create(docs.join("api.md")).unwrap();
        f.write_all(b"## API\n\nEndpoints.\n").unwrap();

        let mut f = fs::File::create(docs.join("config.json")).unwrap();
        f.write_all(b"{}").unwrap();

        let deep = docs.join("architecture");
        fs::create_dir(&deep).unwrap();
        let mut f = fs::File::create(deep.join("overview.md")).unwrap();
        f.write_all(b"# Overview\n\nDeep content.\n").unwrap();

        dir
    }

    #[test]
    fn test_scan_repository_finds_md_files_only() {
        let dir = setup_fixture();
        let files = scan_repository(dir.path(), &["md"]).unwrap();

        let paths: Vec<&str> = files.iter().map(|f| f.relative_path.as_str()).collect();
        assert!(paths.contains(&"docs/intro.md"));
        assert!(paths.contains(&"docs/api.md"));
        assert!(paths.contains(&"docs/architecture/overview.md"));
        assert!(!paths.contains(&"docs/config.json"));
        assert_eq!(files.len(), 3);
    }

    #[test]
    fn test_scan_repository_paths_are_relative() {
        let dir = setup_fixture();
        let files = scan_repository(dir.path(), &["md"]).unwrap();

        for file in &files {
            assert!(
                !file.relative_path.starts_with('/'),
                "relative_path should not be absolute: {}",
                file.relative_path
            );
            assert!(
                file.absolute_path.starts_with(dir.path()),
                "absolute_path should be within root"
            );
        }
    }

    #[test]
    fn test_scan_specific_files_subset() {
        let dir = setup_fixture();
        let files = scan_specific_files(
            dir.path(),
            &[PathBuf::from("docs/intro.md"), PathBuf::from("docs/api.md")],
            &["md"],
        )
        .unwrap();

        assert_eq!(files.len(), 2);
    }

    #[test]
    fn test_scan_specific_files_skips_wrong_extension() {
        let dir = setup_fixture();
        let files = scan_specific_files(
            dir.path(),
            &[PathBuf::from("docs/config.json")],
            &["md"],
        )
        .unwrap();

        assert!(files.is_empty());
    }

    #[test]
    fn test_scan_nonexistent_root_is_error() {
        let result = scan_repository(Path::new("/nonexistent/path"), &["md"]);
        assert!(result.is_err());
    }

    #[test]
    fn test_scan_skips_hidden_dirs() {
        let dir = TempDir::new().unwrap();
        let hidden = dir.path().join(".hidden");
        fs::create_dir(&hidden).unwrap();
        fs::write(hidden.join("secret.md"), "# Secret\n").unwrap();

        let mut f = fs::File::create(dir.path().join("visible.md")).unwrap();
        f.write_all(b"# Visible\n").unwrap();

        let files = scan_repository(dir.path(), &["md"]).unwrap();
        assert_eq!(files.len(), 1);
        assert!(files[0].relative_path.contains("visible"));
    }

    #[test]
    fn test_scan_skips_known_skip_dirs() {
        let dir = TempDir::new().unwrap();
        let node = dir.path().join("node_modules");
        fs::create_dir(&node).unwrap();
        fs::write(node.join("lib.md"), "# Lib\n").unwrap();

        let mut f = fs::File::create(dir.path().join("readme.md")).unwrap();
        f.write_all(b"# Readme\n").unwrap();

        let files = scan_repository(dir.path(), &["md"]).unwrap();
        assert_eq!(files.len(), 1);
        assert!(files[0].relative_path.contains("readme"));
    }
}
```

- [ ] **Step 2: Update `cli/src/main.rs`** — add `mod scanner;`

- [ ] **Step 3: Run tests**

```bash
cargo test
```

Expected: 22 tests pass (5 config + 2 openrouter + 7 chunker + 1 db + 7 scanner).

- [ ] **Step 4: Commit**

```bash
git add cli/src/scanner.rs cli/src/main.rs
git commit -m "feat: add file scanner for recursive markdown discovery"
```

---

### Task 9: Index Command — Full Pipeline

**Files:**
- Create: `cli/src/commands/mod.rs`
- Create: `cli/src/commands/index.rs`
- Modify: `cli/src/main.rs` (wire `Command::Index` to the run function, add tracing init, config loading, pool creation)

**Interfaces:**
- Consumes: `config` (Task 4), `db` (Task 7), `embedding` (Task 5), `openrouter` (Task 5), `chunker` (Task 6), `scanner` (Task 8), `models` (Task 7)
- Produces:
  - `commands::index::run(pool: &PgPool, provider: &dyn EmbeddingProvider, config: &Config, project_name: &str, repository: &Path, files: Option<&[PathBuf]>, commit_sha: Option<&str>) -> anyhow::Result<()>`
  - Full pipeline: scan → chunk → embed → transactional per-file persist
  - Structured `info!` log per indexed file

- [ ] **Step 1: Write `cli/src/commands/mod.rs`**

```rust
pub mod index;
```

- [ ] **Step 2: Write `cli/src/commands/index.rs`**

```rust
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
    config: &Config,
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

        db::delete_document(&mut *tx, project.id, &file.relative_path).await?;

        let document = db::upsert_document(
            &mut *tx,
            project.id,
            &file.relative_path,
            commit_sha,
            None,
        )
        .await?;

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

        db::insert_chunks(&mut *tx, document.id, &chunk_inserts).await?;

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
```

- [ ] **Step 3: Rewrite `cli/src/main.rs`** — full wiring with tracing, config, pool, migrations, and command dispatch

```rust
mod chunker;
mod commands;
mod config;
mod db;
mod embedding;
mod models;
mod openrouter;
mod scanner;

use anyhow::Context;
use clap::{Parser, Subcommand};
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
        Command::Delete { .. } => {
            anyhow::bail!("delete command not yet implemented");
        }
        Command::Rebuild { .. } => {
            anyhow::bail!("rebuild command not yet implemented");
        }
    }

    Ok(())
}
```

- [ ] **Step 4: Create config.yaml for local testing**

```bash
cat > config.yaml << EOF
database_url: "postgres://docsindexer:docsindexer@localhost:5432/docsindexer"
openrouter_api_key: "sk-or-v1-placeholder"
EOF
```

- [ ] **Step 5: Build**

```bash
cargo build
```

Expected: successful compilation.

- [ ] **Step 6: Test manually against the Docker database**

```bash
# Ensure Docker PG is running
docker compose -f infra/docker-compose.yml up -d
sleep 3

# Create test fixtures
mkdir -p /tmp/test-docs/docs
cat > /tmp/test-docs/docs/intro.md << 'EOF'
## Introduction
This is a test document for the documentation indexer.

## Setup
Follow these steps to set up the project.
EOF

cat > /tmp/test-docs/docs/api.md << 'EOF'
## Authentication
The API uses OAuth2 for authentication.

## Endpoints
All endpoints are available under /api/v1/.
EOF
```

```bash
cargo run -- index --project test-fixture --repository /tmp/test-docs --commit_sha abc1234
```

Expected: structured log output showing 2 files indexed, chunk counts, durations.

- [ ] **Step 7: Verify database state**

```bash
docker compose -f infra/docker-compose.yml exec db psql -U docsindexer -d docsindexer -c "
SELECT p.name, d.path, COUNT(c.id) as chunk_count
FROM projects p
JOIN documents d ON d.project_id = p.id
JOIN chunks c ON c.document_id = d.id
WHERE p.name = 'test-fixture'
GROUP BY p.name, d.path;
"
```

Expected: 2 rows (`docs/intro.md`, `docs/api.md`), each with chunk_count > 0.

- [ ] **Step 8: Test idempotency**

```bash
cargo run -- index --project test-fixture --repository /tmp/test-docs --commit_sha abc1234
```

Run the same query again — chunk counts should be identical (no duplication).

- [ ] **Step 9: Commit**

```bash
git add cli/src/commands/ cli/src/main.rs config.yaml
git commit -m "feat: implement index command with transactional per-file indexing"
```

---

### Task 10: Delete Command

**Files:**
- Create: `cli/src/commands/delete.rs`
- Modify: `cli/src/commands/mod.rs` (add `pub mod delete;`)
- Modify: `cli/src/main.rs` (wire `Command::Delete`)

**Interfaces:**
- Consumes: `db` (Task 7)
- Produces:
  - `commands::delete::run(pool: &PgPool, project_name: &str, files: &[PathBuf]) -> anyhow::Result<()>` — looks up project by name, deletes each file's document row (chunks cascade via ON DELETE CASCADE)

- [ ] **Step 1: Write `cli/src/commands/delete.rs`**

```rust
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
```

- [ ] **Step 2: Update `cli/src/commands/mod.rs`**

```rust
pub mod delete;
pub mod index;
```

- [ ] **Step 3: Update `cli/src/main.rs`** — replace `Command::Delete { .. }` arm:

```rust
Command::Delete { project, files } => {
    commands::delete::run(&pool, &project, &files).await?;
}
```

- [ ] **Step 4: Build and test**

```bash
cargo build

# Delete one file
cargo run -- delete --project test-fixture --files docs/intro.md

# Verify
docker compose -f infra/docker-compose.yml exec db psql -U docsindexer -d docsindexer -c "
SELECT d.path FROM projects p JOIN documents d ON d.project_id = p.id WHERE p.name = 'test-fixture';
"
```

Expected: only `docs/api.md` remains.

- [ ] **Step 5: Commit**

```bash
git add cli/src/commands/delete.rs cli/src/commands/mod.rs cli/src/main.rs
git commit -m "feat: implement delete command for removing documents from the index"
```

---

### Task 11: Rebuild Command

**Files:**
- Create: `cli/src/commands/rebuild.rs`
- Modify: `cli/src/commands/mod.rs` (add `pub mod rebuild;`)
- Modify: `cli/src/main.rs` (wire `Command::Rebuild`)

**Interfaces:**
- Consumes: `db` (Task 7), `commands::index::run` (Task 9)
- Produces:
  - `commands::rebuild::run(pool: &PgPool, provider: &dyn EmbeddingProvider, config: &Config, project_name: &str, repository: &Path, commit_sha: Option<&str>) -> anyhow::Result<()>` — deletes all project chunks/documents, then re-indexes from scratch

- [ ] **Step 1: Write `cli/src/commands/rebuild.rs`**

```rust
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
```

- [ ] **Step 2: Update `cli/src/commands/mod.rs`**

```rust
pub mod delete;
pub mod index;
pub mod rebuild;
```

- [ ] **Step 3: Update `cli/src/main.rs`** — replace `Command::Rebuild { .. }` arm:

```rust
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
```

- [ ] **Step 4: Build, delete a file from the filesystem, then rebuild**

```bash
cargo build

# Delete a file from the filesystem to simulate removal from main
rm /tmp/test-docs/docs/api.md

# Rebuild
cargo run -- rebuild --project test-fixture --repository /tmp/test-docs --commit_sha def5678

# Verify only the remaining file is indexed
docker compose -f infra/docker-compose.yml exec db psql -U docsindexer -d docsindexer -c "
SELECT d.path, COUNT(c.id) as chunks
FROM projects p
JOIN documents d ON d.project_id = p.id
JOIN chunks c ON c.document_id = d.id
WHERE p.name = 'test-fixture'
GROUP BY d.path;
"
```

Expected: only `docs/intro.md` is indexed (api.md was deleted from filesystem).

- [ ] **Step 5: Commit**

```bash
git add cli/src/commands/rebuild.rs cli/src/commands/mod.rs cli/src/main.rs
git commit -m "feat: implement rebuild command for full project re-indexing"
```

---

### Task 12: Structured JSON Logging

**Files:**
- Modify: `cli/src/main.rs`

**Interfaces:**
- Consumes: `tracing-subscriber` json feature (Task 1)
- Produces: `--log-json` global CLI flag that switches to JSON-formatted log lines

- [ ] **Step 1: Add `--log-json` to `Cli` struct**

```rust
#[derive(Parser)]
#[command(
    name = "docs-indexer",
    version,
    about = "Semantic documentation indexer for AI agents"
)]
pub struct Cli {
    /// Output logs as JSON (one JSON object per line)
    #[arg(long, global = true)]
    pub log_json: bool,

    #[command(subcommand)]
    pub command: Command,
}
```

- [ ] **Step 2: Update the tracing initializer in `main()`**

Replace the `tracing_subscriber::fmt()` block:

```rust
fn main() -> anyhow::Result<()> {
    let cli = Cli::parse();

    let env_filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into());

    if cli.log_json {
        tracing_subscriber::fmt()
            .with_env_filter(env_filter)
            .json()
            .init();
    } else {
        tracing_subscriber::fmt()
            .with_env_filter(env_filter)
            .init();
    }

    let config = config::Config::from_file(&PathBuf::from("config.yaml"))
        .context("failed to load configuration")?;

    // ... rest of main
}
```

Important: move `let cli = Cli::parse();` to BEFORE the tracing init block. The `Cli::parse()` must come before any `Context` usage in `config::Config::from_file`.

- [ ] **Step 3: Test JSON output**

```bash
cargo build
cargo run -- --log-json index --project test-fixture --repository /tmp/test-docs 2>&1 | head -3
```

Expected: valid JSON objects on each line with fields like `"timestamp"`, `"level"`, `"fields"`, `"message"`.

- [ ] **Step 4: Commit**

```bash
git add cli/src/main.rs
git commit -m "feat: add --log-json flag for structured JSON log output"
```

---

### Task 13: End-to-End Integration Test

**Files:**
- Create: `cli/tests/integration_test.rs`

**Interfaces:**
- Consumes: Running Docker PostgreSQL (Task 2), all modules (Tasks 4–11)
- Produces: Integration test validating full pipeline: index → verify → re-index (idempotency) → delete → rebuild — all against a real database with real OpenRouter embeddings

- [ ] **Step 1: Write `cli/tests/integration_test.rs`**

```rust
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

fn load_config() -> Config {
    let _ = dotenvy::dotenv();

    Config {
        database_url: std::env::var("DATABASE_URL")
            .expect("DATABASE_URL must be set for integration tests"),
        openrouter_api_key: std::env::var("OPENROUTER_API_KEY")
            .expect("OPENROUTER_API_KEY must be set for integration tests"),
        openrouter_base_url: std::env::var("OPENROUTER_BASE_URL")
            .unwrap_or_else(|_| "https://openrouter.ai/api/v1".to_string()),
        embedding_model: std::env::var("EMBEDDING_MODEL")
            .unwrap_or_else(|_| "openai/text-embedding-3-small".to_string()),
        embedding_dimension: std::env::var("EMBEDDING_DIMENSION")
            .unwrap_or_else(|_| "1536".to_string())
            .parse()
            .expect("EMBEDDING_DIMENSION must be an integer"),
    }
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
    let config = load_config();
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
```

- [ ] **Step 2: Ensure `.env` exists with real OpenRouter key**

```bash
cp .env.example .env
# Edit .env: replace OPENROUTER_API_KEY with a real key
```

- [ ] **Step 3: Ensure Docker DB is running, then run integration tests**

```bash
docker compose -f infra/docker-compose.yml up -d
sleep 3
cargo test --test integration_test -- --nocapture
```

Expected: 2 tests pass. `test_full_index_pipeline_idempotency_delete_rebuild` does real OpenRouter calls.

- [ ] **Step 4: Run full test suite**

```bash
cargo test
```

Expected: all tests pass (5 config + 2 openrouter + 7 chunker + 1 db + 7 scanner + 2 integration = 24 tests).

- [ ] **Step 5: Commit**

```bash
git add cli/tests/
git commit -m "test: add end-to-end integration tests for full index pipeline"
```

---

## Self-Review

### 1. Spec Coverage

| PRD Section / Req | Task |
|---|---|
| §8 Doc repository structure | Task 8 (scanner finds `docs/` subtree) |
| §9 Indexer CLI responsibilities | Tasks 9, 10, 11 |
| §10 Full-file reindexing | Task 9 (delete+insert in transaction) |
| §11 Full indexing mode | Task 9 (no --files = scan all) |
| §11 Changed files mode | Task 9 (--files flag) |
| §11 Deleted files | Task 10 |
| §12 Chunking by headings/sections | Task 6 |
| §13 Embeddings via OpenRouter | Task 5 |
| §13 EmbeddingProvider trait | Task 5 |
| §14 DB schema | Task 2, Task 7 |
| §15 Minimum stored info | Tasks 7, 9 |
| §16 Document identity (project_id+path) | Task 2 (UNIQUE constraint), Task 7 |
| §17 Idempotency | Tasks 9, 13 |
| §18 Deleted file handling | Tasks 7, 10 (ON DELETE CASCADE) |
| §30 CLI contract | Tasks 3, 9, 10, 11 |
| §31 Externalized configuration | Task 4 |
| §32 Structured logs | Task 12 |
| §33 Resilience (transactional) | Task 9 (BEGIN→DELETE→INSERT→COMMIT) |
| §34 Commit SHA versioning | Tasks 7, 9 |
| §35 Index eventual consistency | Architecture (CLI runs on push) |
| §36 Full rebuild | Task 11 |
| §37 Embedding model dimension | Task 5 (metadata.model, metadata.dimension) |
| §38 Performance (batch embeddings) | Task 9 (all texts sent in one API call) |
| RF01 Project registration | Task 7 (upsert_project) |
| RF02 Indexação | Task 9 |
| RF03 Chunking | Task 6 |
| RF04 Embedding | Task 5 |
| RF05 Persistência | Tasks 7, 9 |
| RF06 Reindexação | Tasks 9, 11 |
| RF07 Delete | Task 10 |
| RF12 Source of Truth | Architecture (reads from repo, DB is projection) |
| RF13 Idempotência | Tasks 9, 13 |
| RF14 Commit SHA tracking | Tasks 7, 9 |
| RNF01 Rebuildability | Task 11 |
| RNF02 Stateless Indexer | Architecture (no local state) |
| RNF05 Portability CI/CD | Task 2 (Docker Compose works anywhere) |
| RNF06 Provider abstraction | Task 5 (EmbeddingProvider trait) |
| RNF07 Eventual consistency | Architecture |

RF08–RF11 (MCP search/retrieval), RNF03 (security), RNF04 (observability full metrics) are intentionally out of scope — they belong to a separate MCP Server plan.

### 2. Placeholder Scan

No TBD, TODO, "implement later", "add appropriate error handling" (without code), "write tests for the above" (without test code), or "similar to Task N" patterns found. Every step has concrete code or commands.

### 3. Type Consistency

- `Config` fields: `database_url: String`, `openrouter_api_key: String`, `openrouter_base_url: String`, `embedding_model: String`, `embedding_dimension: i32` — Task 4 defines, Tasks 5, 7, 9 consume — consistent
- `EmbeddingProvider::embed(&self, texts: &[String]) -> anyhow::Result<EmbeddingBatch>` — Task 5 defines, Task 9 calls — signature match
- `EmbeddingBatch { embeddings: Vec<Vec<f32>>, model: String, dimension: i32 }` — Task 5 defines `model` and `dimension`, Task 9 reads `batch.model` and `batch.dimension` — consistent
- `Chunk { text: String, heading: Option<String>, heading_path: Vec<String>, chunk_index: usize }` — Task 6 defines, Task 9 accesses `.text`, `.heading`, `.heading_path`, `.chunk_index` — consistent
- `ScannedFile { relative_path: String, absolute_path: PathBuf, content: String }` — Task 8 defines, Task 9 uses `.relative_path`, `.content` — consistent
- `ChunkInsert { chunk_index: i32, text: String, embedding: pgvector::Vector, heading: Option<String>, metadata: serde_json::Value }` — Task 7 defines, Task 9 constructs — consistent
- `db::upsert_project(pool, name, git_url, branch, provider) -> Project` → Tasks 9, 11 call `(pool, project_name, None, "main", None)` — consistent
- `db::upsert_document(pool, project_id, path, commit_sha, title) -> Document` → Task 9 calls — good
- `db::delete_document(pool, project_id, path)` → Tasks 10, 13 call — good
- `db::delete_all_project_documents(pool, project_id)` → Task 11 calls — good
- `db::insert_chunks(pool, document_id, &[ChunkInsert])` → Task 9 calls — good
- `commands::index::run(pool, provider, config, project_name, repository, files, commit_sha)` → Tasks 9 defines, 11 calls (with `None` for files) — signature match