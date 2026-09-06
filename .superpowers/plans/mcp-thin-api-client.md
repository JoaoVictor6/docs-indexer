# MCP as Thin HTTP Client over the API

> **For agentic workers:** Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Move all DB/embedding access from the MCP server into the API, turning the MCP into a thin HTTP client that carries only `API_URL` (plus `SCM_TOKEN` for client-side Git fetch). This eliminates the security problem of distributing `DATABASE_URL` and `OPENROUTER_API_KEY` to every MCP consumer.

**Architecture after refactor:**

```
AI Agent → MCP (thin) ──HTTP──→ API ──→ Postgres (search + metadata)
                │                    └──→ OpenRouter (query embedding)
                └──→ Git (GitHub/Bitbucket, client-side, SCM_TOKEN)
```

**Spec:** Issue [#4](https://github.com/JoaoVictor6/docs-indexer/issues/4) (binding authority).

## Global Constraints

- TypeScript with Bun runtime, zod v4 for validation, `@modelcontextprotocol/server` v2 for MCP
- Only modify `api/` and `mcp/` directories; Rust CLI is out of scope
- Commit after every task; commit messages follow `refactor:` prefix for MCP changes, `feat:` for new API functionality
- Tests use `bun:test` with mocks; `bun test src/` must pass in the affected directory for each commit
- The `GitProvider` interface (`mcp/src/git.ts:1-4`) and its `git.ts` implementation remain **unchanged** (issue explicitly says "`git.ts` stays intact")
- `get_document` response contract: `{ project, path, commitSha, branch, content, sourceUrl }` — unchanged shape
- `search_documentation` response contract: `{ title, path, project, heading, chunk, similarity, repositoryUrl }` — same shape plus the new URL field
- Error messages unchanged: `"Project '<name>' not found"` and `"repository_url is not set for project '<name>'"`
- API auth stays no-op (`api/src/auth.ts` unchanged)
- The `InMemoryTransport` usage in `index.test.ts` and integration test must remain compatible

### API error semantics (ruling)

- `GET /projects/:name/document`: project not found → **404** with error body; project found without `repository_url` → **200** with `repositoryUrl: null`. The MCP api-client maps 404 → `null` return (which the tool converts to "Project '<name>' not found"), and `repositoryUrl: null` → `"repository_url is not set for project '<name>'"".
- `GET /search`: returns empty array `[]` when no results match. Non-2xx → api-client throws.

### Integration test (ruling)

- `postgres` is **fully removed** from mcp dependencies (no devDependency).
- `mcp/tests/mcp.integration.test.ts` is updated to require a running API + pre-seeded data + `SCM_TOKEN`. It only reads via the API, never touches the DB.

---

## Tasks

### Task 1: API — enrich `/search`

**Goal:** Add `repositoryUrl`, `title`, and `heading` to the `/search` endpoint's SELECT and response schema. No other behavior changes.

**Files to modify:**
- `api/src/routes/search.ts`:
  - Add `p.repository_url AS "repositoryUrl"`, `d.title AS title`, `c.heading AS heading` to the SELECT clause
  - Add `repositoryUrl: z.string().nullable()`, `title: z.string().nullable()`, `heading: z.string().nullable()` to `searchResultSchema`
- `api/src/routes/search.test.ts`:
  - Add `repositoryUrl`, `title`, `heading` fields to both mock result rows (e.g. repositoryUrl: `"https://github.com/acme/docs.git"`, title: `"Authentication"`, heading: `"Overview"`)
  - Add assertions: `expect(body[0]).toHaveProperty("repositoryUrl")`, `"title"`, `"heading"` in the "returns search results" test

**Exact values:** `repositoryUrl` type = `z.string().nullable()` (projects.repository_url is nullable TEXT); `title` = `z.string().nullable()` (documents.title nullable TEXT); `heading` = `z.string().nullable()` (chunks.heading nullable TEXT).

**Verification:** `cd api && bun test src/` passes.

---

### Task 2: API — new `GET /projects/:name/document` endpoint

**Goal:** A new route that joins projects + documents by path for a given project name, returns `{ project, path, repositoryUrl, branch, commitSha }`. Register it in the app.

**Files to create:**
- `api/src/routes/project-document.ts`
- `api/src/routes/project-document.test.ts`

**Files to modify:**
- `api/src/index.ts`: import and `.use()` the new route in `buildApp`

**`project-document.ts` implementation:**
```typescript
import { Elysia } from "elysia";
import { z } from "zod";
import type { Sql } from "../db";

const documentParamsSchema = z.object({ name: z.string().min(1) });
const documentQuerySchema = z.object({ path: z.string().min(1) });

const documentResponseSchema = z.object({
  project: z.string(),
  path: z.string(),
  repositoryUrl: z.string().nullable(),
  branch: z.string(),
  commitSha: z.string().nullable(),
});

export function createProjectDocumentRoute(sql: Sql) {
  return new Elysia({ name: "project-document" }).get(
    "/projects/:name/document",
    async ({ params, query }) => {
      const rows = await sql`
        SELECT
          p.name AS project,
          p.repository_url AS "repositoryUrl",
          p.default_branch AS branch,
          d.commit_sha AS "commitSha"
        FROM projects p
        LEFT JOIN documents d ON d.project_id = p.id AND d.path = ${query.path}
        WHERE p.name = ${params.name}
      `;

      if (rows.length === 0) {
        return new Response(
          JSON.stringify({ error: `Project '${params.name}' not found` }),
          { status: 404, headers: { "Content-Type": "application/json" } }
        );
      }

      return {
        project: params.name,
        path: query.path,
        repositoryUrl: rows[0].repositoryUrl,
        branch: rows[0].branch,
        commitSha: rows[0].commitSha,
      };
    },
    {
      params: documentParamsSchema,
      query: documentQuerySchema,
      response: z.union([
        documentResponseSchema,
        z.object({ error: z.string() }),
      ]),
    }
  );
}
```

**`project-document.test.ts` tests:**
1. Returns project metadata with repositoryUrl, branch, commitSha when project + document exist
2. Returns 404 when project does not exist
3. Returns 200 with `repositoryUrl: null` when project found but repository_url is NULL
4. Validates path query param is required (422 on missing)

**`index.ts` change:** In `buildApp`, add `const projectDocumentRoute = createProjectDocumentRoute(sql);` and `.use(projectDocumentRoute)`.

**Exact values:** Response on 404 = `{ error: "Project '<name>' not found" }` with status 404. On 200, `path` echoes the query param (not `d.path` which may be null from LEFT JOIN). `repositoryUrl` = `string | null` (from `p.repository_url`). `branch` = `p.default_branch` (never null, has default `'main'`). `commitSha` = `string | null`.

**Verification:** `cd api && bun test src/` passes.

---

### Task 3: MCP — config + api-client

**Goal:** Change `McpConfig` to `{ apiUrl, scmToken }` (env `API_URL` + `SCM_TOKEN`), drop DB/embedding config fields. Create thin `api-client.ts` over `fetch`, base URL from config.

**Files to create:**
- `mcp/src/api-client.ts`

**Files to modify:**
- `mcp/src/config.ts`: replace env schema and `McpConfig` interface
- `mcp/src/config.test.ts`: update to test new env vars

**`config.ts` new shape:**
```typescript
const envSchema = z.object({
  API_URL: z.string().url(),
  SCM_TOKEN: z.string().min(1),
});

export interface McpConfig {
  apiUrl: string;
  scmToken: string;
}
```

**`api-client.ts`:** Export `ApiClient` interface with `search` and `getDocumentMetadata` methods, `createApiClient(baseUrl)` factory, plus typed interfaces `DocumentMetadata` and `ApiSearchResult`.

**`config.test.ts`:** Replace `DATABASE_URL`/`OPENROUTER_API_KEY` tests with `API_URL`/`SCM_TOKEN` tests. Same pattern (saveEnv/clearEnv/restoreEnv). Cover: reads required vars, throws on missing `API_URL`, throws on missing `SCM_TOKEN`, validates URL format.

**Exact values:**
- `API_URL`: `z.string().url()` — must be a valid URL
- `SCM_TOKEN`: `z.string().min(1)` — must be non-empty string
- Config fields: `apiUrl: string`, `scmToken: string`

**Verification:** `cd mcp && bun test src/config.test.ts` passes.

---

### Task 4: MCP — rewrite `search_documentation`

**Goal:** Rewrite the tool to call `GET /search` via `apiClient` instead of using `sql` + `embeddingClient`. Keep output shape (title, path, project, heading, chunk, similarity) plus new `repositoryUrl`.

**Files to modify:**
- `mcp/src/tools/search-documentation.ts`:
  - Change factory signature from `(sql: Sql, embeddingClient: EmbeddingClient)` to `(apiClient: ApiClient)`
  - Handler: `await apiClient.search({ query, project, limit: limit ?? 10 })`
  - Remove `sql`, `EmbeddingClient` imports; add `ApiClient` import from `../api-client`
  - Add `repositoryUrl: string | null` to `SearchResult` interface
  - Remove vector embedding logic
- `mcp/src/tools/search-documentation.test.ts`:
  - Replace `Sql`/`EmbeddingClient` mocks with `ApiClient` mock
  - Mock `apiClient.search` returns enriched rows with `repositoryUrl`, `title`, `heading`
  - Assert `repositoryUrl` appears in result
  - Keep input schema validation test unchanged

**Verification:** `cd mcp && bun test src/tools/search-documentation.test.ts` passes.

---

### Task 5: MCP — rewrite `get_document`

**Goal:** Rewrite to call `GET /projects/:name/document` for metadata, then `gitProvider.getDocument` for content. Keep response contract and error messages unchanged.

**Files to modify:**
- `mcp/src/tools/get-document.ts`:
  - Change factory signature from `(sql: Sql, gitProvider: GitProvider)` to `(apiClient: ApiClient, gitProvider: GitProvider)`
  - Replace SQL query with: `const metadata = await apiClient.getDocumentMetadata(project, path);`
  - `if (!metadata) throw new Error("Project '${project}' not found");`
  - `if (!metadata.repositoryUrl) throw new Error("repository_url is not set for project '${project}'");`
  - `const content = await gitProvider.getDocument(metadata.repositoryUrl, metadata.branch, path);`
  - Return shape unchanged: `{ project, path, commitSha: metadata.commitSha, branch: metadata.branch, content, sourceUrl: metadata.repositoryUrl.replace(/\.git$/, "") }`
  - Remove `Sql` import, add `ApiClient` import; remove `ProjectRow` interface
- `mcp/src/tools/get-document.test.ts`:
  - Replace `Sql` mock with `ApiClient` mock
  - Three tests remain: success, project not found, repository_url null
  - `gitProvider.getDocument` mock stays unchanged

**Verification:** `cd mcp && bun test src/tools/get-document.test.ts` passes.

---

### Task 6: MCP — wiring + removal

**Goal:** Update `index.ts` signature, delete `db.ts` and `embedding.ts`, remove `postgres` dependency, update/remove stale tests.

**Files to modify:**
- `mcp/src/index.ts`:
  - `buildMcpServer` signature: `(config: McpConfig, apiClient: ApiClient, gitProvider: GitProvider): McpServer`
  - `createSearchDocumentationTool(apiClient)` (no sql/embedding)
  - `createGetDocumentTool(apiClient, gitProvider)` (apiClient instead of sql)
  - `main()`: create `apiClient`, replace sql + embedding; call `buildMcpServer(config, apiClient, gitProvider)`
  - Update imports: remove `db`, `embedding`, `Sql`, `EmbeddingClient`; add `createApiClient, ApiClient` from `./api-client`
- `mcp/src/index.test.ts`:
  - Replace mock `Sql`/`EmbeddingClient` with mock `ApiClient`
  - Update `McpConfig` to `{ apiUrl: "http://localhost:3000", scmToken: "ghp-test" }`
  - `buildMcpServer(config, mockApiClient, mockGitProvider)` call
- `mcp/package.json`: remove `"postgres"` from `dependencies`; run `bun install`
- `mcp/tests/mcp.integration.test.ts`:
  - Remove `createPool`, `createEmbeddingClient`, `sql`, `Sql` imports
  - Remove all seeding logic
  - `beforeAll`: create apiClient + gitProvider (with mocked getDocument), build server
  - `afterAll`: only `await server.close()`
  - Add comment: `// Requires: running API at API_URL, pre-seeded project 'mcp-intgration-project' with document 'docs/intgration-test.md' and a chunk`

**Files to delete:**
- `mcp/src/db.ts`
- `mcp/src/db.test.ts`
- `mcp/src/embedding.ts`
- `mcp/src/embedding.test.ts`

**Verification:** `cd mcp && bun test src/` passes. `bun test tests/` runs if API + pre-seeded data are available.

---

### Task 7: Docs

**Goal:** Update `mcp/.env.example`, `mcp/README.md`, `api/.env.example`, and root `README.md`.

**Files to modify:**
- `mcp/.env.example`: replace with `API_URL=http://localhost:3000` and `SCM_TOKEN=username:token-here`
- `mcp/README.md`:
  - Update "How it works" diagram to show MCP→API→Postgres flow
  - Update config table: only `API_URL` and `SCM_TOKEN`
  - Update connection examples
  - Update tool reference: `search_documentation` output includes `repositoryUrl`
  - Update Prerequisites: remove "OpenRouter API key", add "Running API server"
  - Update "Known gaps": remove gap #1 (CLI already populates repository_url per #3)
  - Add note: MCP no longer needs direct DB access
- `api/.env.example`: unchanged (already has correct vars)
- `README.md`: update Architecture section diagram to reflect new flow

**Verification:** Manual review for consistency and no stale references.

---

## Decision Document

- **Architecture:** MCP becomes thin HTTP client; all DB/embedding access lives in the API
- **`get_document` Git fetch:** stays client-side in MCP (user supplies `SCM_TOKEN`)
- **API `GET /search` enrichment:** adds `repositoryUrl`, `title`, `heading`
- **New API endpoint:** `GET /projects/:name/document?path=docs/auth.md`
- **MCP config:** `{ apiUrl, scmToken }` from `API_URL` + `SCM_TOKEN`
- **Auth:** deferred — API auth stays no-op
- **`git.ts`:** unchanged
- **Integration test:** read-only, requires pre-seeded data + running API + `SCM_TOKEN`

## Out of Scope

- API authentication (stays no-op)
- GitLab support in `get_document`
- Database schema migrations
- The `repository_url` CLI flag work (already delivered in #3)