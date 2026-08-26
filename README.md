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

## API Server

A REST API (Bun + Elysia + TypeScript) that serves the search index.

### Running

```bash
cd api
cp .env.example .env
# Edit .env with your OpenRouter API key
bun install
bun run dev
```

### Endpoints

| Method | Path | Query Params | Description |
|---|---|---|---|
| GET | `/search` | `q` (required), `project` (optional), `limit` (optional, default 10) | Semantic search returning ranked results |
| GET | `/openapi` | — | Interactive API docs (Scalar UI) |
| GET | `/openapi/json` | — | Raw OpenAPI spec |

Example:

```bash
curl "http://localhost:3000/search?q=authentication&project=payments&limit=10"
```

Response (JSON array, ordered by similarity descending):

```json
[
  {
    "chunk": "All API calls must include a bearer token...",
    "path": "docs/auth.md",
    "project": "payments",
    "similarity": 0.92
  }
]
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

### Current Setup

The default model is `text-embedding-3-small` (1536 dimensions), and the database migration includes a working `ivfflat` ANN index. This gives fast vector search out of the box.

### The Constraint

pgVector's `ivfflat` index has a hard limit of **2000 dimensions**. Our default model (`text-embedding-3-small` = 1536d) fits comfortably. If you switch to a model exceeding 2000 dimensions (e.g. `qwen3-embedding-8b` = 4096d), the `ivfflat` index creation will fail. You must migrate to a different indexing strategy:

### Migration Paths (>2000-dim models)

| Solution | Effort | Trade-offs |
|---|---|---|
| **1. Use a ≤2000-dim model** (recommended) | Minimal — change `.env` + rebuild | Simplest path. Keeps ivfflat. Evaluate recall quality on your data. |
| **2. HNSW index** (pgvector 0.8+, no 2000-dim limit) | Medium — upgrade pgvector, modify migration | Solves the dimensionality constraint. Experimental in pgvector 0.8+. Monitor memory usage (HNSW is memory-heavy). |
| **3. Dimensionality reduction** (PCA/projection before storing) | Medium — add preprocessing step to the pipeline | Lossy. Evaluate recall@k degradation before committing. |
| **4. External vector store** (Qdrant, Milvus, Pinecone) | High — adds infrastructure | Full ANN support for any dimension. Adds operational complexity. |

### Current State

The default migration uses `vector(1536)` with the `ivfflat` ANN index — vector search is accelerated by default. All queries use ANN; there is no brute-force fallback.

### Recommendation by Scale

| Deployment Size | Solution |
|---|---|
| Prototype / Demo (≤1k chunks) | Default setup — ivfflat, no changes |
| Single team (≤100k chunks) | Default setup — ivfflat scales well here |
| Multi-team org (≤1M chunks) | Default setup — increase `lists` parameter |
| Platform (≥10M chunks) | External vector store or HNSW when stable |

> **Rule of thumb:** ivfflat handles common scales well. Increase `lists` as the dataset grows. If you need a >2000-dim model, pick a migration path from the table above.

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
  branch      title            embedding  vector(1536)
  created_at  created_at       heading
  updated_at  updated_at       metadata   jsonb
                               created_at
```

## Project Structure

```
├── .env.example              # Environment template
├── .github/workflows/ci.yml  # CI: unit tests + Docker build
├── api/
│   ├── package.json
│   ├── tsconfig.json
│   ├── src/
│   │   ├── index.ts          # App entry point + OpenAPI plugin
│   │   ├── config.ts         # Zod-validated env config (fail-fast)
│   │   ├── db.ts             # PostgreSQL connection pool (postgres.js)
│   │   ├── embedding.ts      # OpenRouter embedding client
│   │   ├── auth.ts           # No-op auth plugin (seam for future)
│   │   └── routes/
│   │       └── search.ts     # GET /search — pgvector cosine similarity
│   └── tests/
│       └── search.integration.test.ts
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