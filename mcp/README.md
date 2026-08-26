# docs-indexer MCP Server

A Model Context Protocol (MCP) server that lets AI agents discover and retrieve
documentation across distributed Git repositories. It is the serving layer of
`docs-indexer`: it searches the pgVector semantic index for *discovery*, then
fetches the full document from the Git *source of truth* — it never trusts the
index as the source of document content.

## How it works

```
AI Agent
   │  search_documentation(project, query, limit)
   ▼
Semantic search (OpenRouter embedding → pgVector)
   │  ranked chunks: title, path, heading, chunk text, score
   ▼
AI Agent picks a document
   │  get_document(project, path)
   ▼
Git provider (raw.githubusercontent.com, branch `main`)
   │  full document content
   ▼
AI Agent gets trusted, up-to-date context
```

Two tools are exposed:

| Tool | Purpose | Returns |
|---|---|---|
| `search_documentation` | Semantic discovery over a project's index | Ranked chunks with title, path, heading, chunk text, similarity |
| `get_document` | Fetch a full document from Git | Document content + metadata (commit, branch, source) |

## Prerequisites

- **PostgreSQL 16 + pgVector** running (see the repo root `infra/`):
  `docker compose -f infra/docker-compose.yml up -d`
- **Indexed documentation** (run the Rust CLI first — see the repo root `README.md` "Quick Start")
- **Bun** (`https://bun.sh`) as the runtime
- A valid **OpenRouter API key**
- A **GitHub token** (used to read private repositories; for public repos any token works)

## Configuration

Copy `.env.example` to `.env` and fill in your values:

```bash
cd mcp
cp .env.example .env
```

| Env Var | Required | Default | Description |
|---|---|---|---|
| `DATABASE_URL` | yes | — | PostgreSQL connection string |
| `OPENROUTER_API_KEY` | yes | — | OpenRouter API key for query embeddings |
| `OPENROUTER_BASE_URL` | yes | `https://openrouter.ai/api/v1` | OpenRouter base URL |
| `EMBEDDING_MODEL` | yes | `openai/text-embedding-3-small` | Embedding model (must match what the indexer used) |
| `GITHUB_TOKEN` | yes | — | GitHub token for reading repositories |
| `GITHUB_BASE_URL` | yes | `https://raw.githubusercontent.com` | Raw content base URL |

> **Note:** `get_document` requires each project to have a `repository_url` set in
> the `projects` table. The indexer CLI does not yet populate this automatically —
> set it via SQL, e.g.:
>
> ```sql
> UPDATE projects SET repository_url = 'https://github.com/acme/payments-docs.git' WHERE name = 'payments';
> ```

## Running

```bash
cd mcp
bun install
bun run start
```

The server speaks MCP over **stdio** (stdout is reserved for the JSON-RPC wire;
logs go to stderr).

## Connecting from a client

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "docs-indexer": {
      "command": "bun",
      "args": ["run", "--cwd", "/absolute/path/to/docs-indexer/mcp", "start"],
      "env": {
        "DATABASE_URL": "postgres://docsindexer:docsindexer@localhost:5432/docsindexer",
        "OPENROUTER_API_KEY": "sk-or-v1-...",
        "GITHUB_TOKEN": "ghp_..."
      }
    }
  }
}
```

### Cursor

Add an MCP server in Cursor settings pointing at the same `bun run start`
command with the environment variables above.

## Tool reference

### `search_documentation`

**Input:**

| Field | Type | Required | Description |
|---|---|---|---|
| `project` | string | yes | Project name to search within |
| `query` | string | yes | Natural-language search query |
| `limit` | number | no | Max results (default 10) |

**Output:** array of `{ title, path, project, heading, chunk, similarity }`,
ordered by similarity descending.

### `get_document`

**Input:**

| Field | Type | Required | Description |
|---|---|---|---|
| `project` | string | yes | Project name |
| `path` | string | yes | Document path, e.g. `docs/authentication.md` |

**Output:** `{ project, path, commitSha, branch, content, sourceUrl }` — the
content comes directly from the `main` branch of the project's Git repository.

## Development

```bash
cd mcp
bun test               # full suite (integration tests need live Postgres + OpenRouter key)
bun test src/          # unit tests only (mock-based, no network)
bun test tests/        # integration test only (requires Docker + OpenRouter key)
```

## Known gaps (MVP)

The following gaps are known and intentionally out of scope for the MVP:

1. **`repository_url` is not populated by the indexer.** `get_document`
   resolves the project's Git source of truth from the `repository_url`
   column, but the Rust indexer CLI currently upserts projects with
   `repository_url = NULL` (see `cli/src/db.rs::upsert_project` and its
   callers in `cli/src/commands/index.rs` and `cli/src/commands/rebuild.rs`).
   Until the CLI is updated to persist this, operators must set it manually:

   ```sql
   UPDATE projects SET repository_url = 'https://github.com/acme/payments-docs.git'
   WHERE name = 'payments';
   ```

   Without it, `get_document` fails with
   `repository_url is not set for project '<name>'`.

2. **Only GitHub is supported** for source-of-truth retrieval (GitLab is a
   future provider — see the `GitProvider` interface in `src/git.ts`).

3. **Authorization is not yet enforced per-project.** The server trusts its
   environment (see PRD sections 27–28 for the planned model).
