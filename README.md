# docs-indexer

Semantic documentation indexer for AI agents. Scans Markdown documentation repositories, chunks files by headings, generates embeddings via OpenRouter, and persists them to PostgreSQL + pgVector.

## Architecture

```
Repository (Git main)  →  Scanner  →  Chunker  →  OpenRouter Embeddings  →  PostgreSQL + pgVector
                                                                                  │
                                                                                  ▼
                                                                            MCP Server (*)
                                                                         (TypeScript, WIP)
```

- **`cli/`** — Rust binary (`docs-indexer`). Reads `.md`/`.mdx` files, chunks by headings, embeds in batch, and writes to the database transactionally.
- **`infra/`** — Docker Compose for development PostgreSQL 16 + pgVector, SQL migrations, Dockerfile for the CLI binary.
- **MCP Server** (*) — separate TypeScript component (not yet implemented). Queries the index and serves documentation to AI agents.

## Quick Start

```bash
# 1. Set up environment
cp .env.example .env
# Edit .env with your OpenRouter API key and model choice

# 2. Create config
echo 'database_url: "postgres://docsindexer:docsindexer@localhost:5432/docsindexer"
openrouter_api_key: "sk-or-v1-your-key"' > config.yaml

# 3. Start database
docker compose -f infra/docker-compose.yml up -d

# 4. Index documentation
cargo run -- index --project my-project --repository /path/to/docs --commit_sha $(git rev-parse HEAD)

# 5. Index specific files (CI after merge)
cargo run -- index --project my-project --repository /path/to/docs \
  --files docs/auth.md docs/api.md

# 6. Delete removed files
cargo run -- delete --project my-project --files docs/old.md

# 7. Full rebuild (model change, migration, disaster recovery)
cargo run -- rebuild --project my-project --repository /path/to/docs
```

## Configuration

Configuration is loaded from a YAML file (`config.yaml` by default). All values can be overridden by environment variables — secrets must never be committed.

| YAML Key | Env Var | Default | Description |
|---|---|---|---|
| `database_url` | `DATABASE_URL` | — | PostgreSQL connection string |
| `openrouter_api_key` | `OPENROUTER_API_KEY` | — | OpenRouter API key |
| `openrouter_base_url` | `OPENROUTER_BASE_URL` | `https://openrouter.ai/api/v1` | API base URL |
| `embedding_model` | `EMBEDDING_MODEL` | `openai/text-embedding-3-small` | Model to use for embeddings |
| `embedding_dimension` | `EMBEDDING_DIMENSION` | `1536` | Expected output dimension |

## Subcommands

| Command | Description |
|---|---|
| `index` | Scan `.md`/`.mdx` files, chunk, embed, and persist. Full scan or specific files. |
| `delete` | Remove indexed files by path (deletes all chunks for those files). |
| `rebuild` | Delete all project data and re-index from scratch. |

## pgVector ANN Index Dimension Limitation

### The Problem

pgVector's `ivfflat` index (the only built-in ANN index type) has a hard limit of **2000 dimensions**. Popular embedding models like `qwen3-embedding-8b` output **4096 dimensions**, making them incompatible with accelerated vector search on PostgreSQL.

Without an ANN index, searches fall back to **exact (brute-force) cosine distance** comparisons — accurate and fast for small datasets, but linearly slow at scale:

| Scale | Exact Search | ivfflat Index |
|---|---|---|
| ~10k chunks | <10ms per query | <1ms |
| ~100k chunks | ~100ms | <5ms |
| ~1M chunks | ~1s | <20ms |
| ~10M chunks | >10s | <50ms |

For a prototype or small org (<50k chunks), brute force is fine. For production at scale, you need an index.

### Solutions

| Solution | Effort | Trade-offs |
|---|---|---|
| **1. Use a ≤2000-dim model** (e.g. `text-embedding-3-small` = 1536d, `voyage-3-lite` = 512d) | Minimal — change `.env` + rebuild | Lower-dim models may have slightly worse retrieval quality. Run evaluation on your data. |
| **2. HNSW via pgvector 0.8+** (`hnsw` index has no 2000-dim limit) | Medium — upgrade pgvector, modify migration | Still experimental in pgvector 0.8+. Monitor PostgreSQL memory usage (HNSW is memory-heavy). |
| **3. Dimensionality reduction** (PCA/projection 4096→1536 before storing) | Medium — add preprocessing step to the indexer pipeline | Lossy. Evaluate recall@k degradation on your data before committing. |
| **4. Brute force (no index)** — current MVP default | Zero | Works well up to ~50k vectors. Exact results, no index build time. Acceptable for single-org or small multi-project deployments. |
| **5. External vector store** (Qdrant, Milvus, Pinecone) for the embedding column | High — adds infrastructure | Full ANN support for any dimension. Adds operational complexity. |
| **6. Hybrid: brute force + project-level pre-filtering** | Low — application-level optimization | If searches filter by `project_id` first, the brute-force pool shrinks significantly. Combine with connection pooling. |

### Current State

The migration uses `vector(4096)` with **no ANN index** — exact search only. This is the simplest path for the MVP. As the index grows, evaluate which solution fits your scale and latency requirements.

### Recommendation by Scale

| Deployment Size | Solution |
|---|---|
| Prototype / Demo (≤1k chunks) | Brute force — no action needed |
| Single team (≤50k chunks) | Brute force — fine as-is |
| Multi-team org (≤500k chunks) | Project-level pre-filtering + reconsider model to ≤2000d |
| Platform (≥1M chunks) | External vector store or HNSW when stable |

> **Rule of thumb:** switch from brute force when `vector_cosine_distance` queries exceed 50ms on your workload.

## Development

```bash
# Run unit tests
cargo test --lib

# Run integration tests (requires Docker and .env with OpenRouter key)
cargo test --test integration_test -- --nocapture

# Run all tests
cargo test

# Build Docker image
docker build -f infra/Dockerfile -t docs-indexer:latest .
```

## Database

```bash
# Start
docker compose -f infra/docker-compose.yml up -d

# Stop and destroy data
docker compose -f infra/docker-compose.yml down -v

# Manual inspection
docker compose -f infra/docker-compose.yml exec db psql -U docsindexer -d docsindexer
```

### Schema

```
projects  ──< documents  ──< chunks
  id          id               id
  name        project_id       document_id
  git_url     path             chunk_index
  source      commit_sha       text
  branch      title            embedding  vector(4096)
  created_at  created_at       heading
  updated_at  updated_at       metadata   jsonb
                               created_at
```

## Project Structure

```
├── .env.example              # Environment template
├── .github/workflows/ci.yml  # CI: unit tests + Docker build
├── cli/
│   ├── Cargo.toml
│   ├── src/
│   │   ├── main.rs           # Binary entrypoint + CLI
│   │   ├── lib.rs            # Library root
│   │   ├── config.rs         # YAML + env config
│   │   ├── cli.rs            # Clap argument definitions
│   │   ├── db.rs             # PostgreSQL + pgVector operations
│   │   ├── models.rs         # Database models
│   │   ├── chunker.rs        # Markdown heading-aware chunking
│   │   ├── scanner.rs        # Recursive file discovery
│   │   ├── embedding.rs      # EmbeddingProvider trait
│   │   ├── openrouter.rs     # OpenRouter HTTP client
│   │   ├── indexer.rs        # Pipeline orchestration
│   │   └── commands/
│   │       ├── mod.rs
│   │       ├── index.rs      # Index command
│   │       ├── delete.rs     # Delete command
│   │       └── rebuild.rs    # Rebuild command
│   └── tests/
│       └── integration_test.rs
└── infra/
    ├── docker-compose.yml    # PostgreSQL 16 + pgVector
    ├── Dockerfile            # Multi-stage CLI image
    └── migrations/
        ├── 001_create_projects.sql
        ├── 002_create_documents.sql
        └── 003_create_chunks.sql
```

## Logging

Use `--log-json` for structured JSON logs:

```bash
cargo run -- --log-json index --project my-project --repository /path/to/docs
```

Logs include `project`, `path`, `status`, `chunks`, `duration_ms`, `commit_sha`, and `model` per indexed file.