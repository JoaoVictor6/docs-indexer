# Multi-Provider SCM Support (GitHub + Bitbucket) in MCP Server

## Global Constraints

- TypeScript with Bun runtime, zod for validation, `@modelcontextprotocol/server` for MCP
- Only modify `mcp/` directory; repository root is `/home/joao/projects/docs-indexer`
- Tests use `bun:test` with mocked `fetch` (same pattern as existing `src/git.test.ts`)
- Commit messages must follow `refactor:` prefix
- Run `bun test` in `mcp/` directory to verify all tests pass before each commit
- The `GitProvider` interface (`src/git.ts`) remains stable — `getDocument(repositoryUrl, branch, path): Promise<string>`
- Provider detection from URL domain only (github.com → GitHub, bitbucket.org → Bitbucket)
- Single credential: `SCM_TOKEN` env var using HTTP Basic auth (base64-encoded `username:password`)
- Hardcoded public SaaS URLs only: `raw.githubusercontent.com` and `bitbucket.org/... /raw/...`
- Error format for unsupported domains: clear message listing supported providers

## Tasks

### Task 1: Extract provider-agnostic URL parser and update the existing GitHub provider

**Goal:** Replace `parseGitHubRepo` with a generic `parseRepositoryUrl` function returning `{ provider: "github" | "bitbucket", owner: string, repo: string }`. Update `GitHubGitProvider` to use it internally. No behavior change — only GitHub repos still work.

**Files to modify:**
- `mcp/src/git.ts`: Replace `parseGitHubRepo` with `parseRepositoryUrl`, update `GitHubGitProvider.getDocument` to use it
- `mcp/src/git.test.ts`: Add thorough tests for `parseRepositoryUrl` covering:
  - GitHub HTTPS URLs with and without `.git` suffix: `https://github.com/acme/payments-docs.git` → `{ provider: "github", owner: "acme", repo: "payments-docs" }`
  - `https://github.com/acme/payments-docs` → `{ provider: "github", owner: "acme", repo: "payments-docs" }`
  - Bitbucket HTTPS URLs with and without `.git`: `https://bitbucket.org/acme/payments-docs.git` → `{ provider: "bitbucket", owner: "acme", repo: "payments-docs" }`
  - Unsupported domains → throws error listing github.com and bitbucket.org as supported

**Note:** Export `parseRepositoryUrl` so the factory in Task 5 can reuse it. Keep `GitHubGitProvider` internal but update it to use the new parser.

### Task 2: Rename config to be provider-agnostic

**Goal:** Rename `GITHUB_TOKEN` → `SCM_TOKEN` in config, remove `GITHUB_BASE_URL`. Update all files that reference these config fields.

**Files to modify:**
- `mcp/.env.example`: Replace `GITHUB_TOKEN=ghp_your-token-here` with `SCM_TOKEN=username:token-here`
- `mcp/src/config.ts`: Rename zod field and McpConfig interface field
- `mcp/src/git.ts`: Update `GitHubGitProvider` constructor to accept `scmToken` instead of `config` object, build raw URL internally (no more `baseUrl` from config)
- `mcp/src/index.ts`: Pass `config.scmToken` to `createGitProvider`
- `mcp/src/config.test.ts`: Update all references
- `mcp/src/db.test.ts`: Update config object constructor
- `mcp/src/embedding.test.ts`: Update config object constructor  
- `mcp/src/git.test.ts`: Update config object constructor and auth expectations
- `mcp/src/index.test.ts`: Update config object constructor
- `mcp/src/tools/search-documentation.test.ts`: Not directly affected (doesn't use config)
- `mcp/src/tools/get-document.test.ts`: Not directly affected (uses GitProvider interface)
- `mcp/tests/mcp.integration.test.ts`: Update config passing
- `mcp/README.md`: Update config table

**Exact values:**
- Config field name: `scmToken` (camelCase in TypeScript), `SCM_TOKEN` (env var)
- Remove `githubBaseUrl` entirely from `McpConfig` interface

### Task 3: Switch GitHub provider to HTTP Basic auth

**Goal:** Change `GitHubGitProvider.getDocument` from Bearer auth to Basic auth. The `SCM_TOKEN` is the `username:password` string (e.g. `x-access-token:ghp_xxx` or `token:x-oauth-basic`), base64-encoded at request time.

**Files to modify:**
- `mcp/src/git.ts`: In `GitHubGitProvider.getDocument`, change `Authorization: Bearer ${token}` to `Authorization: Basic ${base64(token)}`
- `mcp/src/git.test.ts`: Update auth assertions from Bearer to Basic header, verify base64 encoding

**Exact values:** Use Node's `btoa()` for base64 encoding (available in Bun). Git provider constructor receives `scmToken: string`, stores it, encodes on each request.

### Task 4: Add Bitbucket provider

**Goal:** Implement `BitbucketGitProvider` class implementing `GitProvider` interface. Parse workspace and repo from URL, construct raw URL `https://bitbucket.org/{workspace}/{repo}/raw/{branch}/{path}`, use HTTP Basic auth with `SCM_TOKEN`.

**Files to create/modify:**
- `mcp/src/git.ts`: Add `BitbucketGitProvider` class, export it (or keep internal for factory in Task 5)
- `mcp/src/git.test.ts`: Add tests covering:
  - Successful fetch with Basic auth header for Bitbucket URL
  - Non-2xx error response format
  - URL construction: `https://bitbucket.org/acme/payments-docs/raw/main/docs/auth.md`

**Exact values:** Raw URL pattern: `${workspace}/${repo}/raw/${branch}/${path}` on `https://bitbucket.org`. The `parseRepositoryUrl` from Task 1 provides `owner` (workspace) and `repo`.

### Task 5: Add provider factory with URL-based dispatch

**Goal:** Create a factory/wrapper that returns the correct `GitProvider` based on `repositoryUrl`. Update `createGitProvider` to accept `scmToken` and return the factory-dispatched provider.

**Files to modify:**
- `mcp/src/git.ts`: Add `createGitProvider(token: string): GitProvider` that returns a wrapper delegating to the right provider class. Dispatch: github.com → `GitHubGitProvider`, bitbucket.org → `BitbucketGitProvider`, else → throw clear error.
- `mcp/src/index.ts`: Call `createGitProvider(config.scmToken)` (already done in Task 2)
- `mcp/src/git.test.ts`: Add factory tests:
  - GitHub URL routes to GitHub provider behavior
  - Bitbucket URL routes to Bitbucket provider behavior
  - Unknown domain throws error listing supported providers

### Task 6: Update README documentation

**Goal:** Update README to reflect multi-provider support and new config names.

**Files to modify:**
- `mcp/README.md`: 
  - Remove "Only GitHub is supported" from Known Gaps
  - Update env var table: replace `GITHUB_TOKEN` / `GITHUB_BASE_URL` with `SCM_TOKEN`, document format
  - Update connection examples (Claude Desktop, Cursor)
  - Update any other mentions of `GITHUB_TOKEN`

---

## Out of Scope

- GitLab support
- Self-hosted enterprise instances
- Provider type in database
- Multiple tokens per provider
- Bearer auth or OAuth flows
- Rate limiting or retry logic
- Caching
- Changes to Rust indexer CLI