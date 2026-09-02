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
MCP Server (thin HTTP client)
   │  GET /search?q=...&project=...&limit=...
   ▼
API Server (Bun + Elysia)
   │  query embedding → pgVector search
   ▼
PostgreSQL + pgVector
   │  ranked chunks: title, path, heading, chunk text, score, repositoryUrl
   ▼
AI Agent picks a document
   │  get_document(project, path)
   ▼
MCP Server
   │  GET /projects/:name/document?path=... (metadata)
   │  + Git fetch (content, using SCM_TOKEN)
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
- A running **docs-indexer API** server (`cd api && bun run dev`)
- An **SCM token** (used to read private repositories via HTTP Basic auth. Both GitHub and Bitbucket are supported. Format: `username:token` or `username:app-password`)

## Configuration

Copy `.env.example` to `.env` and fill in your values:

```bash
cd mcp
cp .env.example .env
```

| Env Var | Required | Default | Description |
|---|---|---|---|
| `API_URL` | yes | — | URL of the docs-indexer API, e.g. `http://localhost:3000` |
| `LOCAL_REPOS` | no | `{}` | JSON map of project name → local clone path. When set, `get_document` reads files from disk instead of Git. |
| `SCM_TOKEN` | yes | — | SCM token for reading repositories (format: `username:token`) |

> **Note:** The MCP server no longer needs direct DB or OpenRouter access — all search and metadata
> lookup goes through the API. The `SCM_TOKEN` is only used for client-side Git document fetch.

### Local file fallback

When Bitbucket App Passwords aren't available or the repository URL is SSH-only,
you can pre-clone repositories locally and bypass HTTP entirely:

```bash
# Clone the repo locally
git clone git@bitbucket.org:workspace/repo.git /home/joao/repos/my-project

# Point LOCAL_REPOS to it
LOCAL_REPOS='{"my-project":"/home/joao/repos/my-project"}'
```

When a project is found in `LOCAL_REPOS` and the file exists on disk, `get_document`
reads it directly — no HTTP request to Bitbucket/GitHub. If the file doesn't exist
locally, it falls through to the normal API + Git flow.

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
        "API_URL": "http://localhost:3000",
        "SCM_TOKEN": "username:token"
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

**Output:** array of `{ title, path, project, heading, chunk, similarity, repositoryUrl }`,
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
bun test               # full suite (integration test needs running API + pre-seeded data + SCM_TOKEN)
bun test src/          # unit tests only (mock-based, no network)
bun test tests/        # integration test only (requires running API + pre-seeded data + SCM_TOKEN)
```

## Known gaps (MVP)

The following gaps are known and intentionally out of scope for the MVP:

1. **GitLab is not yet supported** (see the `GitProvider` interface in `src/git.ts`).

2. **Authorization is not yet enforced per-project.** The server trusts its
   environment (see PRD sections 27–28 for the planned model).
