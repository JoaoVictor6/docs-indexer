# MCP Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an MCP (Model Context Protocol) server in TypeScript that exposes two tools — `search_documentation` (semantic discovery over the pgVector index) and `get_document` (retrieve the full document from the Git source of truth) — so AI agents can discover and consume distributed documentation without the index becoming a second source of truth.

**Architecture:** The MCP server is a separate TypeScript component (its own `mcp/` package) that talks over stdio using the official MCP SDK. It reads the PostgreSQL + pgVector index the same way the existing `api/` does (embed the query via OpenRouter, then cosine-similarity search across `chunks → documents → projects`), but for `get_document` it does **not** read content from the database — it resolves the project's `repository_url` from the `projects` table and fetches the file directly from the Git provider (GitHub raw content for the MVP) on the `main` branch. Configuration is validated with Zod (fail-fast). The Git fetch is abstracted behind a small `GitProvider` interface so GitHub/GitLab/etc. can be swapped later without touching the tools. Each tool is implemented as a pure, independently-testable factory function; the MCP server wires them together with typed zod input schemas.

**Tech Stack:** Bun 1.x, TypeScript 5.x, `@modelcontextprotocol/server` 2.x, zod 4.x, postgres.js, OpenRouter embeddings API

**Spec:** `PRD.md` sections 19–28 (MCP Server, interaction model, tools, ranking, project isolation, security), section 42 (MVP técnico), Decision 4 (TypeScript para MCP); `README.md` database schema and API Server section.

## Global Constraints

- Use `bun` as the runtime and package manager (`bun run`, `bun test`)
- Use `@modelcontextprotocol/server` (v2, NOT the legacy `@modelcontextprotocol/sdk`) for the MCP server, with the high-level `McpServer` + `registerTool` API and `serveStdio` from `@modelcontextprotocol/server/stdio`
- Use `zod` v4 (import from `zod/v4`) for tool input/output schemas — the SDK derives JSON Schema from them
- Use `postgres` (postgres.js) for the database, matching the existing `api/` conventions
- Environment variables for all secrets and configuration — never hardcode credentials
- Database URL: `postgres://docsindexer:docsindexer@localhost:5432/docsindexer` (dev default, overridden via `DATABASE_URL`)
- Config must fail fast: `getConfig()` throws on missing OR empty `DATABASE_URL`, `OPENROUTER_API_KEY`, and `GITHUB_TOKEN`
- `package.json` must set `"type": "module"` (the SDK ships ES modules only)
- **Never `console.log` to stdout** — stdout is the MCP JSON-RPC wire; log to `console.error` only
- The MCP must NOT be a SQL wrapper: `get_document` fetches content from Git (the source of truth), never from the `chunks.text` in the database
- Tests use `bun:test` — native test runner, no Jest/Vitest
- Commit after every task

---

### Task 1: Scaffold the mcp/ project

**Files:**
- Create: `mcp/package.json`
- Create: `mcp/tsconfig.json`
- Create: `mcp/.env.example`

**Interfaces:**
- Consumes: nothing
- Produces: installable `mcp/` project with deps `@modelcontextprotocol/server`, `zod`, `postgres`, and dev deps `@types/bun`, `typescript`

- [ ] **Step 1: Create mcp/package.json**

Create `mcp/package.json`:
```json
{
  "name": "docs-indexer-mcp",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "bun run --watch src/index.ts",
    "start": "bun run src/index.ts",
    "test": "bun test"
  }
}
```

- [ ] **Step 2: Create mcp/tsconfig.json**

Create `mcp/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "types": ["bun"]
  },
  "include": ["src/**/*.ts", "tests/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 3: Create mcp/.env.example**

Create `mcp/.env.example`:
```
DATABASE_URL=postgres://docsindexer:docsindexer@localhost:5432/docsindexer
OPENROUTER_API_KEY=sk-or-v1-your-key-here
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
EMBEDDING_MODEL=openai/text-embedding-3-small
GITHUB_TOKEN=ghp_your-token-here
```

- [ ] **Step 4: Install dependencies**

Run: `bun install` then `bun add @modelcontextprotocol/server zod postgres` then `bun add -d @types/bun typescript`

Expected: installs `@modelcontextprotocol/server`, `zod`, `postgres`, `@types/bun`, and `typescript` without errors

- [ ] **Step 5: Commit**

```bash
git add mcp/package.json mcp/tsconfig.json mcp/.env.example mcp/bun.lock mcp/bun.lockb
git commit -m "feat: scaffold mcp project with bun + mcp sdk + postgres.js + zod"
```

---

### Task 2: Configuration module with Zod (fail-fast)

**Files:**
- Create: `mcp/src/config.ts`
- Test: `mcp/src/config.test.ts`

**Interfaces:**
- Consumes: environment variables (`DATABASE_URL`, `OPENROUTER_API_KEY`, `OPENROUTER_BASE_URL`, `EMBEDDING_MODEL`, `GITHUB_TOKEN`, `GITHUB_BASE_URL`)
- Produces: `getConfig(): McpConfig` — typed object with fields `databaseUrl`, `openrouterApiKey`, `openrouterBaseUrl`, `embeddingModel`, `githubToken`, `githubBaseUrl`; throws on missing/empty required vars

- [ ] **Step 1: Write the test file**

Create `mcp/src/config.test.ts`:
```typescript
import { describe, it, expect, beforeEach, afterEach } from "bun:test";

function saveEnv(): Record<string, string | undefined> {
  return {
    DATABASE_URL: process.env.DATABASE_URL,
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
    OPENROUTER_BASE_URL: process.env.OPENROUTER_BASE_URL,
    EMBEDDING_MODEL: process.env.EMBEDDING_MODEL,
    GITHUB_TOKEN: process.env.GITHUB_TOKEN,
    GITHUB_BASE_URL: process.env.GITHUB_BASE_URL,
  };
}

function restoreEnv(saved: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function clearEnv() {
  delete process.env.DATABASE_URL;
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.OPENROUTER_BASE_URL;
  delete process.env.EMBEDDING_MODEL;
  delete process.env.GITHUB_TOKEN;
  delete process.env.GITHUB_BASE_URL;
}

describe("getConfig", () => {
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    savedEnv = saveEnv();
    clearEnv();
  });

  afterEach(() => restoreEnv(savedEnv));

  it("reads required vars from env", async () => {
    process.env.DATABASE_URL = "postgres://user:pass@localhost:5432/db";
    process.env.OPENROUTER_API_KEY = "sk-test-key";
    process.env.GITHUB_TOKEN = "ghp-test";
    const { getConfig } = await import("./config");
    const config = getConfig();
    expect(config.databaseUrl).toBe("postgres://user:pass@localhost:5432/db");
    expect(config.openrouterApiKey).toBe("sk-test-key");
    expect(config.githubToken).toBe("ghp-test");
  });

  it("applies defaults for optional vars", async () => {
    process.env.DATABASE_URL = "postgres://user:pass@localhost:5432/db";
    process.env.OPENROUTER_API_KEY = "sk-test-key";
    process.env.GITHUB_TOKEN = "ghp-test";
    const { getConfig } = await import("./config");
    const config = getConfig();
    expect(config.openrouterBaseUrl).toBe("https://openrouter.ai/api/v1");
    expect(config.embeddingModel).toBe("openai/text-embedding-3-small");
    expect(config.githubBaseUrl).toBe("https://raw.githubusercontent.com");
  });

  it("throws if DATABASE_URL is missing", async () => {
    process.env.OPENROUTER_API_KEY = "sk-test-key";
    process.env.GITHUB_TOKEN = "ghp-test";
    const { getConfig } = await import("./config");
    expect(() => getConfig()).toThrow("DATABASE_URL");
  });

  it("throws if OPENROUTER_API_KEY is missing", async () => {
    process.env.DATABASE_URL = "postgres://user:pass@localhost:5432/db";
    process.env.GITHUB_TOKEN = "ghp-test";
    const { getConfig } = await import("./config");
    expect(() => getConfig()).toThrow("OPENROUTER_API_KEY");
  });

  it("throws if GITHUB_TOKEN is missing", async () => {
    process.env.DATABASE_URL = "postgres://user:pass@localhost:5432/db";
    process.env.OPENROUTER_API_KEY = "sk-test-key";
    const { getConfig } = await import("./config");
    expect(() => getConfig()).toThrow("GITHUB_TOKEN");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test mcp/src/config.test.ts`
Expected: FAIL — module `./config` not found

- [ ] **Step 3: Implement config.ts**

Create `mcp/src/config.ts`:
```typescript
import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  OPENROUTER_API_KEY: z.string().min(1),
  OPENROUTER_BASE_URL: z.string().url().default("https://openrouter.ai/api/v1"),
  EMBEDDING_MODEL: z.string().min(1).default("openai/text-embedding-3-small"),
  GITHUB_TOKEN: z.string().min(1),
  GITHUB_BASE_URL: z.string().url().default("https://raw.githubusercontent.com"),
});

export interface McpConfig {
  databaseUrl: string;
  openrouterApiKey: string;
  openrouterBaseUrl: string;
  embeddingModel: string;
  githubToken: string;
  githubBaseUrl: string;
}

export function getConfig(): McpConfig {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  const env = parsed.data;
  return {
    databaseUrl: env.DATABASE_URL,
    openrouterApiKey: env.OPENROUTER_API_KEY,
    openrouterBaseUrl: env.OPENROUTER_BASE_URL,
    embeddingModel: env.EMBEDDING_MODEL,
    githubToken: env.GITHUB_TOKEN,
    githubBaseUrl: env.GITHUB_BASE_URL,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test mcp/src/config.test.ts`
Expected: PASS — 5 tests pass

- [ ] **Step 5: Commit**

```bash
git add mcp/src/config.ts mcp/src/config.test.ts
git commit -m "feat: add zod-validated mcp config with fail-fast on missing env"
```

---

### Task 3: Database connection pool

**Files:**
- Create: `mcp/src/db.ts`
- Test: `mcp/src/db.test.ts`

**Interfaces:**
- Consumes: `McpConfig.databaseUrl` from Task 2
- Produces: `createPool(config: McpConfig): Sql` — returns a postgres.js `Sql` instance (typed via `ReturnType<typeof postgres>`)

- [ ] **Step 1: Write the test**

Create `mcp/src/db.test.ts`:
```typescript
import { describe, it, expect } from "bun:test";
import { createPool } from "./db";

describe("createPool", () => {
  const config = {
    databaseUrl: process.env.DATABASE_URL || "postgres://docsindexer:docsindexer@localhost:5432/docsindexer",
    openrouterApiKey: "sk-test",
    openrouterBaseUrl: "https://openrouter.ai/api/v1",
    embeddingModel: "openai/text-embedding-3-small",
    githubToken: "ghp-test",
    githubBaseUrl: "https://raw.githubusercontent.com",
  };

  it("returns a sql instance when given a valid config", async () => {
    const sql = createPool(config);
    expect(sql).toBeDefined();
    expect(typeof sql).toBe("function");
    await sql.end();
  });

  it("creates a pool that can query the database", async () => {
    const sql = createPool(config);
    const result = await sql`SELECT 1 AS one`;
    expect(result[0].one).toBe(1);
    await sql.end();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test mcp/src/db.test.ts`
Expected: FAIL — `createPool` not defined

- [ ] **Step 3: Implement db.ts**

Create `mcp/src/db.ts`:
```typescript
import postgres from "postgres";
import type { McpConfig } from "./config";

export type Sql = ReturnType<typeof postgres>;

export function createPool(config: McpConfig): Sql {
  return postgres(config.databaseUrl, {
    max: 10,
    idle_timeout: 30,
    connect_timeout: 10,
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test mcp/src/db.test.ts`
Expected: PASS (requires PostgreSQL running — start with `docker compose -f infra/docker-compose.yml up -d` if not running)

- [ ] **Step 5: Commit**

```bash
git add mcp/src/db.ts mcp/src/db.test.ts
git commit -m "feat: add postgres.js connection pool module for mcp"
```

---

### Task 4: Embedding client (OpenRouter)

**Files:**
- Create: `mcp/src/embedding.ts`
- Test: `mcp/src/embedding.test.ts`

**Interfaces:**
- Consumes: `McpConfig.openrouterApiKey`, `McpConfig.openrouterBaseUrl`, `McpConfig.embeddingModel` from Task 2
- Produces: `createEmbeddingClient(config: McpConfig): EmbeddingClient` where `EmbeddingClient` has `.embed(text: string): Promise<number[]>`

- [ ] **Step 1: Write the test**

Create `mcp/src/embedding.test.ts`:
```typescript
import { describe, it, expect, afterEach, mock } from "bun:test";
import { createEmbeddingClient } from "./embedding";
import type { McpConfig } from "./config";

const originalFetch = globalThis.fetch;

describe("EmbeddingClient", () => {
  const config: McpConfig = {
    databaseUrl: "postgres://localhost/db",
    openrouterApiKey: "sk-test",
    openrouterBaseUrl: "https://openrouter.ai/api/v1",
    embeddingModel: "openai/text-embedding-3-small",
    githubToken: "ghp-test",
    githubBaseUrl: "https://raw.githubusercontent.com",
  };

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("calls OpenRouter and returns an embedding vector", async () => {
    const client = createEmbeddingClient(config);

    const fetchMock = mock(() =>
      Promise.resolve(new Response(
        JSON.stringify({ data: [{ embedding: [0.1, 0.2, 0.3] }] }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      ))
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const embedding = await client.embed("hello world");
    expect(embedding).toEqual([0.1, 0.2, 0.3]);

    expect(fetchMock).toHaveBeenCalledWith(
      "https://openrouter.ai/api/v1/embeddings",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer sk-test",
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({ model: "openai/text-embedding-3-small", input: ["hello world"] }),
      })
    );
  });

  it("throws when OpenRouter returns a non-2xx status", async () => {
    const client = createEmbeddingClient(config);

    globalThis.fetch = mock(() =>
      Promise.resolve(new Response("unauthorized", { status: 401 }))
    ) as unknown as typeof fetch;

    await expect(client.embed("hello")).rejects.toThrow("OpenRouter returned 401");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test mcp/src/embedding.test.ts`
Expected: FAIL — module `./embedding` not found

- [ ] **Step 3: Implement embedding.ts**

Create `mcp/src/embedding.ts`:
```typescript
import type { McpConfig } from "./config";

export interface EmbeddingClient {
  embed(text: string): Promise<number[]>;
}

export function createEmbeddingClient(config: McpConfig): EmbeddingClient {
  return new OpenRouterEmbeddingClient(config);
}

class OpenRouterEmbeddingClient implements EmbeddingClient {
  private apiKey: string;
  private baseUrl: string;
  private model: string;

  constructor(config: McpConfig) {
    this.apiKey = config.openrouterApiKey;
    this.baseUrl = config.openrouterBaseUrl;
    this.model = config.embeddingModel;
  }

  async embed(text: string): Promise<number[]> {
    const response = await fetch(`${this.baseUrl}/embeddings`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        input: [text],
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`OpenRouter returned ${response.status}: ${body}`);
    }

    const result = (await response.json()) as {
      data: Array<{ embedding: number[] }>;
    };

    if (!result.data || result.data.length === 0) {
      throw new Error("OpenRouter returned no embeddings");
    }

    return result.data[0].embedding;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test mcp/src/embedding.test.ts`
Expected: PASS — 2 tests pass (mock-based, no OpenRouter call)

- [ ] **Step 5: Commit**

```bash
git add mcp/src/embedding.ts mcp/src/embedding.test.ts
git commit -m "feat: add openrouter embedding client for mcp"
```

---

### Task 5: Git provider abstraction (GitHub raw content)

**Files:**
- Create: `mcp/src/git.ts`
- Test: `mcp/src/git.test.ts`

**Interfaces:**
- Consumes: `McpConfig.githubToken`, `McpConfig.githubBaseUrl` from Task 2
- Produces: `createGitProvider(config: McpConfig): GitProvider` where `GitProvider` has `.getDocument(repositoryUrl: string, branch: string, path: string): Promise<string>` — returns raw file content from the source of truth, throws a descriptive error on failure (non-2xx or non-GitHub URL)

- [ ] **Step 1: Write the test**

Create `mcp/src/git.test.ts`:
```typescript
import { describe, it, expect, afterEach, mock } from "bun:test";
import { createGitProvider } from "./git";
import type { McpConfig } from "./config";

const originalFetch = globalThis.fetch;

describe("GitProvider (GitHub)", () => {
  const config: McpConfig = {
    databaseUrl: "postgres://localhost/db",
    openrouterApiKey: "sk-test",
    openrouterBaseUrl: "https://openrouter.ai/api/v1",
    embeddingModel: "openai/text-embedding-3-small",
    githubToken: "ghp-test",
    githubBaseUrl: "https://raw.githubusercontent.com",
  };

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("fetches a file from a GitHub https repository URL", async () => {
    const provider = createGitProvider(config);

    const fetchMock = mock(() =>
      Promise.resolve(new Response("# Authentication\n\nFull document content", {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      }))
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const content = await provider.getDocument(
      "https://github.com/acme/payments-docs.git",
      "main",
      "docs/authentication.md"
    );

    expect(content).toBe("# Authentication\n\nFull document content");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://raw.githubusercontent.com/acme/payments-docs/main/docs/authentication.md",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer ghp-test",
        }),
      })
    );
  });

  it("throws when the repository URL is not GitHub", async () => {
    const provider = createGitProvider(config);

    await expect(
      provider.getDocument("https://gitlab.com/acme/payments-docs.git", "main", "docs/auth.md")
    ).rejects.toThrow("Only GitHub repositories are supported");
  });

  it("throws when the fetch returns non-2xx", async () => {
    const provider = createGitProvider(config);

    globalThis.fetch = mock(() =>
      Promise.resolve(new Response("Not Found", { status: 404 }))
    ) as unknown as typeof fetch;

    await expect(
      provider.getDocument("https://github.com/acme/payments-docs.git", "main", "docs/missing.md")
    ).rejects.toThrow("404");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test mcp/src/git.test.ts`
Expected: FAIL — module `./git` not found

- [ ] **Step 3: Implement git.ts**

Create `mcp/src/git.ts`:
```typescript
import type { McpConfig } from "./config";

export interface GitProvider {
  getDocument(repositoryUrl: string, branch: string, path: string): Promise<string>;
}

export function createGitProvider(config: McpConfig): GitProvider {
  return new GitHubGitProvider(config);
}

class GitHubGitProvider implements GitProvider {
  private token: string;
  private baseUrl: string;

  constructor(config: McpConfig) {
    this.token = config.githubToken;
    this.baseUrl = config.githubBaseUrl;
  }

  async getDocument(repositoryUrl: string, branch: string, path: string): Promise<string> {
    const repo = parseGitHubRepo(repositoryUrl);
    if (!repo) {
      throw new Error(
        `Only GitHub repositories are supported (got: ${repositoryUrl}); ` +
        `set the project's repository_url to a github.com repository`
      );
    }

    const rawUrl = `${this.baseUrl}/${repo}/${branch}/${path}`;
    const response = await fetch(rawUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: "application/vnd.github.raw+json",
      },
    });

    if (!response.ok) {
      throw new Error(`GitHub returned ${response.status} for ${rawUrl}`);
    }

    return await response.text();
  }
}

function parseGitHubRepo(repositoryUrl: string): string | null {
  const match = repositoryUrl.match(
    /(?:github\.com[:/])([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/
  );
  return match ? match[1] : null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test mcp/src/git.test.ts`
Expected: PASS — 3 tests pass (mock-based)

- [ ] **Step 5: Commit**

```bash
git add mcp/src/git.ts mcp/src/git.test.ts
git commit -m "feat: add github git provider abstraction for source-of-truth retrieval"
```

---

### Task 6: search_documentation tool

**Files:**
- Create: `mcp/src/tools/search-documentation.ts`
- Test: `mcp/src/tools/search-documentation.test.ts`

**Interfaces:**
- Consumes: `Sql` (Task 3), `EmbeddingClient` (Task 4)
- Produces: `createSearchDocumentationTool(sql: Sql, embeddingClient: EmbeddingClient)` returning `{ name: "search_documentation"; inputSchema: ZodObject; handler: (args) => Promise<SearchResult[]> }`
- Exported schemas/types: `searchDocumentationInputSchema`, `SearchResult` shape `{ title: string | null; path: string; project: string; heading: string | null; chunk: string; similarity: number }`
- `handler` returns the raw result array (the MCP server in Task 8 wraps it into `content`/`structuredContent`)

- [ ] **Step 1: Write the test**

Create `mcp/src/tools/search-documentation.test.ts`:
```typescript
import { describe, it, expect, mock } from "bun:test";
import { createSearchDocumentationTool } from "./search-documentation";
import type { Sql } from "../db";
import type { EmbeddingClient } from "../embedding";

function createMockSql(rows: unknown[]): Sql {
  return mock(async (_strings: TemplateStringsArray, ..._values: unknown[]) => rows) as unknown as Sql;
}

function createMockEmbeddingClient(): EmbeddingClient {
  return {
    embed: mock(async (_: string): Promise<number[]> => new Array(1536).fill(0)),
  };
}

describe("search_documentation tool", () => {
  it("returns ranked results with chunk/path/project/heading/similarity", async () => {
    const rows = [
      {
        title: "Authentication Architecture",
        path: "docs/auth.md",
        project: "payments",
        heading: "Authentication",
        chunk: "All API calls must include a bearer token...",
        similarity: 0.92,
      },
    ];
    const sql = createMockSql(rows);
    const tool = createSearchDocumentationTool(sql, createMockEmbeddingClient());

    const results = await tool.handler({ project: "payments", query: "OAuth authentication", limit: 10 });

    expect(results).toBeArray();
    expect(results.length).toBe(1);
    expect(results[0]).toMatchObject({
      title: "Authentication Architecture",
      path: "docs/auth.md",
      project: "payments",
      heading: "Authentication",
      similarity: 0.92,
    });
    expect(results[0].chunk).toBe("All API calls must include a bearer token...");
  });

  it("passes the embedded query vector and project filter into the SQL query", async () => {
    const sql = createMockSql([]);
    const embeddingClient = createMockEmbeddingClient();
    const tool = createSearchDocumentationTool(sql, embeddingClient);

    await tool.handler({ project: "payments", query: "OAuth", limit: 5 });

    expect(embeddingClient.embed).toHaveBeenCalledWith("OAuth");

    const sqlMock = sql as unknown as { mock: { calls: unknown[][] } };
    const callValues = sqlMock.mock.calls[0] as unknown[];
    expect(callValues).toContain("payments");
    expect(callValues).toContain(5);
  });

  it("validates that project and query are required strings", () => {
    const tool = createSearchDocumentationTool(createMockSql([]), createMockEmbeddingClient());

    const parsed = tool.inputSchema.safeParse({ query: "OAuth", limit: 5 });
    expect(parsed.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test mcp/src/tools/search-documentation.test.ts`
Expected: FAIL — module `./search-documentation` not found

- [ ] **Step 3: Implement search-documentation.ts**

Create `mcp/src/tools/search-documentation.ts`:
```typescript
import { z } from "zod";
import type { Sql } from "../db";
import type { EmbeddingClient } from "../embedding";

export const searchDocumentationInputSchema = z.object({
  project: z.string().min(1).describe("Project name to search within"),
  query: z.string().min(1).describe("Natural-language search query"),
  limit: z.number().int().min(1).max(100).optional().describe("Max results, defaults to 10"),
});

export interface SearchResult {
  title: string | null;
  path: string;
  project: string;
  heading: string | null;
  chunk: string;
  similarity: number;
}

export interface SearchDocumentationTool {
  name: "search_documentation";
  inputSchema: typeof searchDocumentationInputSchema;
  handler: (args: z.infer<typeof searchDocumentationInputSchema>) => Promise<SearchResult[]>;
}

export function createSearchDocumentationTool(
  sql: Sql,
  embeddingClient: EmbeddingClient
): SearchDocumentationTool {
  return {
    name: "search_documentation",
    inputSchema: searchDocumentationInputSchema,
    handler: async ({ project, query, limit }) => {
      const searchText = query.trim();
      const resultLimit = limit ?? 10;

      const queryEmbedding = await embeddingClient.embed(searchText);
      const embeddingVector = `[${queryEmbedding.join(",")}]`;

      return await sql<SearchResult[]>`
        SELECT
          d.title AS title,
          d.path AS path,
          p.name AS project,
          c.heading AS heading,
          c.text AS chunk,
          1 - (c.embedding <=> ${embeddingVector}::vector) AS similarity
        FROM chunks c
        JOIN documents d ON c.document_id = d.id
        JOIN projects p ON d.project_id = p.id
        WHERE c.embedding IS NOT NULL
          AND p.name = ${project}
        ORDER BY c.embedding <=> ${embeddingVector}::vector
        LIMIT ${resultLimit}
      `;
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test mcp/src/tools/search-documentation.test.ts`
Expected: PASS — 3 tests pass (mock-based)

- [ ] **Step 5: Commit**

```bash
git add mcp/src/tools/search-documentation.ts mcp/src/tools/search-documentation.test.ts
git commit -m "feat: add search_documentation tool with pgvector semantic search"
```

---

### Task 7: get_document tool

**Files:**
- Create: `mcp/src/tools/get-document.ts`
- Test: `mcp/src/tools/get-document.test.ts`

**Interfaces:**
- Consumes: `Sql` (Task 3), `GitProvider` (Task 5)
- Produces: `createGetDocumentTool(sql: Sql, gitProvider: GitProvider)` returning `{ name: "get_document"; inputSchema: ZodObject; handler: (args) => Promise<GetDocumentResult> }`
- Exported schemas/types: `getDocumentInputSchema`, `GetDocumentResult` shape `{ project: string; path: string; commitSha: string | null; branch: string; content: string; sourceUrl: string }`
- `handler` returns the raw result object (the MCP server in Task 8 wraps it into `content`/`structuredContent`)

- [ ] **Step 1: Write the test**

Create `mcp/src/tools/get-document.test.ts`:
```typescript
import { describe, it, expect, mock } from "bun:test";
import { createGetDocumentTool } from "./get-document";
import type { Sql } from "../db";
import type { GitProvider } from "../git";

function createMockSql(rows: unknown[]): Sql {
  return mock(async (_strings: TemplateStringsArray, ..._values: unknown[]) => rows) as unknown as Sql;
}

function createMockGitProvider(content: string): GitProvider {
  return {
    getDocument: mock(async (_repositoryUrl: string, _branch: string, _path: string) => content),
  };
}

describe("get_document tool", () => {
  it("resolves the project, fetches from git, and returns content + metadata", async () => {
    const sql = createMockSql([
      {
        repositoryUrl: "https://github.com/acme/payments-docs.git",
        branch: "main",
        commitSha: "abc123",
      },
    ]);
    const gitProvider = createMockGitProvider("# Full doc content");
    const tool = createGetDocumentTool(sql, gitProvider);

    const result = await tool.handler({
      project: "payments",
      path: "docs/authentication.md",
    });

    expect(result).toMatchObject({
      project: "payments",
      path: "docs/authentication.md",
      commitSha: "abc123",
      branch: "main",
      content: "# Full doc content",
      sourceUrl: "https://github.com/acme/payments-docs",
    });
    expect(gitProvider.getDocument).toHaveBeenCalledWith(
      "https://github.com/acme/payments-docs.git",
      "main",
      "docs/authentication.md"
    );
  });

  it("throws when the project is not found", async () => {
    const sql = createMockSql([]);
    const tool = createGetDocumentTool(sql, createMockGitProvider(""));

    await expect(
      tool.handler({ project: "unknown", path: "docs/a.md" })
    ).rejects.toThrow("Project 'unknown' not found");
  });

  it("throws when the project has no repository_url set", async () => {
    const sql = createMockSql([{ repositoryUrl: null, branch: "main", commitSha: null }]);
    const tool = createGetDocumentTool(sql, createMockGitProvider(""));

    await expect(
      tool.handler({ project: "payments", path: "docs/a.md" })
    ).rejects.toThrow("repository_url is not set for project 'payments'");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test mcp/src/tools/get-document.test.ts`
Expected: FAIL — module `./get-document` not found

- [ ] **Step 3: Implement get-document.ts**

Create `mcp/src/tools/get-document.ts`:
```typescript
import { z } from "zod";
import type { Sql } from "../db";
import type { GitProvider } from "../git";

export const getDocumentInputSchema = z.object({
  project: z.string().min(1).describe("Project name"),
  path: z.string().min(1).describe("Document path within the repository, e.g. docs/authentication.md"),
});

export interface GetDocumentResult {
  project: string;
  path: string;
  commitSha: string | null;
  branch: string;
  content: string;
  sourceUrl: string;
}

export interface GetDocumentTool {
  name: "get_document";
  inputSchema: typeof getDocumentInputSchema;
  handler: (args: z.infer<typeof getDocumentInputSchema>) => Promise<GetDocumentResult>;
}

interface ProjectRow {
  repositoryUrl: string | null;
  branch: string;
  commitSha: string | null;
}

export function createGetDocumentTool(sql: Sql, gitProvider: GitProvider): GetDocumentTool {
  return {
    name: "get_document",
    inputSchema: getDocumentInputSchema,
    handler: async ({ project, path }) => {
      const rows = await sql<ProjectRow[]>`
        SELECT
          p.repository_url AS "repositoryUrl",
          p.default_branch AS branch,
          d.commit_sha AS "commitSha"
        FROM projects p
        LEFT JOIN documents d ON d.project_id = p.id AND d.path = ${path}
        WHERE p.name = ${project}
      `;

      if (rows.length === 0) {
        throw new Error(`Project '${project}' not found`);
      }

      const row = rows[0];
      if (!row.repositoryUrl) {
        throw new Error(`repository_url is not set for project '${project}'`);
      }

      const content = await gitProvider.getDocument(row.repositoryUrl, row.branch, path);

      return {
        project,
        path,
        commitSha: row.commitSha,
        branch: row.branch,
        content,
        sourceUrl: row.repositoryUrl.replace(/\.git$/, ""),
      };
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test mcp/src/tools/get-document.test.ts`
Expected: PASS — 3 tests pass (mock-based)

- [ ] **Step 5: Commit**

```bash
git add mcp/src/tools/get-document.ts mcp/src/tools/get-document.test.ts
git commit -m "feat: add get_document tool that fetches from the git source of truth"
```

---

### Task 8: MCP server entry point (McpServer + serveStdio)

**Files:**
- Create: `mcp/src/index.ts`
- Test: `mcp/src/index.test.ts`

**Interfaces:**
- Consumes: `getConfig` (Task 2), `createPool` (Task 3), `createEmbeddingClient` (Task 4), `createGitProvider` (Task 5), `createSearchDocumentationTool` (Task 6), `createGetDocumentTool` (Task 7)
- Produces: `buildMcpServer(config, sql, embeddingClient, gitProvider): McpServer` — registers both tools on a `McpServer` instance; plus a `main()` entry point that wires config + `serveStdio`

- [ ] **Step 1: Write the test**

Create `mcp/src/index.test.ts`:
```typescript
import { describe, it, expect, mock } from "bun:test";
import { buildMcpServer } from "./index";
import type { Sql } from "./db";
import type { EmbeddingClient } from "./embedding";
import type { GitProvider } from "./git";
import type { McpConfig } from "./config";

function createMockSql(): Sql {
  return mock(async (_strings: TemplateStringsArray, ..._values: unknown[]) => []) as unknown as Sql;
}

function createMockEmbeddingClient(): EmbeddingClient {
  return {
    embed: mock(async (_: string): Promise<number[]> => new Array(1536).fill(0)),
  };
}

function createMockGitProvider(): GitProvider {
  return {
    getDocument: mock(async () => "content"),
  };
}

const config: McpConfig = {
  databaseUrl: "postgres://localhost/db",
  openrouterApiKey: "sk-test",
  openrouterBaseUrl: "https://openrouter.ai/api/v1",
  embeddingModel: "openai/text-embedding-3-small",
  githubToken: "ghp-test",
  githubBaseUrl: "https://raw.githubusercontent.com",
};

describe("buildMcpServer", () => {
  it("registers both tools", async () => {
    const server = buildMcpServer(config, createMockSql(), createMockEmbeddingClient(), createMockGitProvider());

    const listResult = await server.server.request(
      { method: "tools/list", params: {} },
      {} as never
    ) as { tools: Array<{ name: string }> };

    const toolNames = listResult.tools.map((t) => t.name);
    expect(toolNames).toContain("search_documentation");
    expect(toolNames).toContain("get_document");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test mcp/src/index.test.ts`
Expected: FAIL — module `./index` not found (or `buildMcpServer` not exported)

- [ ] **Step 3: Implement index.ts**

Create `mcp/src/index.ts`:
```typescript
import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { getConfig, type McpConfig } from "./config";
import { createPool, type Sql } from "./db";
import { createEmbeddingClient, type EmbeddingClient } from "./embedding";
import { createGitProvider, type GitProvider } from "./git";
import { createSearchDocumentationTool } from "./tools/search-documentation";
import { createGetDocumentTool } from "./tools/get-document";

export function buildMcpServer(
  _config: McpConfig,
  sql: Sql,
  embeddingClient: EmbeddingClient,
  gitProvider: GitProvider
): McpServer {
  const server = new McpServer({ name: "docs-indexer", version: "0.1.0" });

  const searchTool = createSearchDocumentationTool(sql, embeddingClient);
  server.registerTool(
    searchTool.name,
    {
      description: "Semantic search over a project's indexed documentation. Returns ranked chunks with title, path, heading, chunk text, and similarity score.",
      inputSchema: searchTool.inputSchema,
    },
    async (args) => {
      const results = await searchTool.handler(args);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(results, null, 2) }],
        structuredContent: { results },
      };
    }
  );

  const getDocumentTool = createGetDocumentTool(sql, gitProvider);
  server.registerTool(
    getDocumentTool.name,
    {
      description: "Retrieve the full content of a document from the project's Git source of truth (main branch), not from the index.",
      inputSchema: getDocumentTool.inputSchema,
    },
    async (args) => {
      const result = await getDocumentTool.handler(args);
      return {
        content: [{ type: "text" as const, text: result.content }],
        structuredContent: result,
      };
    }
  );

  return server;
}

async function main() {
  const config = getConfig();
  const sql = createPool(config);
  const embeddingClient = createEmbeddingClient(config);
  const gitProvider = createGitProvider(config);

  const server = buildMcpServer(config, sql, embeddingClient, gitProvider);

  const handle = serveStdio(() => server);

  process.on("SIGINT", () => {
    handle.close();
    process.exit(0);
  });

  console.error("docs-indexer MCP server running on stdio");
}

if (import.meta.main) {
  main();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test mcp/src/index.test.ts`
Expected: PASS — 1 test passes (mock-based, no stdio/network)

- [ ] **Step 5: Commit**

```bash
git add mcp/src/index.ts mcp/src/index.test.ts
git commit -m "feat: add mcp server entry point wiring tools over stdio"
```

---

### Task 9: Integration test (end-to-end against real PostgreSQL + mocked Git)

**Files:**
- Create: `mcp/tests/mcp.integration.test.ts`

**Interfaces:**
- Consumes: `buildMcpServer` (Task 8), `getConfig` (Task 2), `createPool` (Task 3), `createEmbeddingClient` (Task 4), `createGitProvider` (Task 5); requires running PostgreSQL + pgVector via Docker and a valid `OPENROUTER_API_KEY`
- Produces: validates the full flow — seed a project/doc/chunk → call `search_documentation` and `get_document` through the MCP server's registered tool handlers → verify results

- [ ] **Step 1: Write the integration test**

Create `mcp/tests/mcp.integration.test.ts`:
```typescript
import { describe, it, expect, beforeAll, afterAll, mock } from "bun:test";
import type { McpServer } from "@modelcontextprotocol/server";
import type postgres from "postgres";
import { getConfig } from "../src/config";
import { createPool } from "../src/db";
import { createEmbeddingClient } from "../src/embedding";
import { createGitProvider } from "../src/git";
import { buildMcpServer } from "../src/index";

// Requires:
//   docker compose -f infra/docker-compose.yml up -d
//   A valid OPENROUTER_API_KEY in the environment
//   GITHUB_TOKEN set in the environment (the actual fetch is mocked, so any value works)
// The database migrates automatically on first docker compose boot.

const TEST_PROJECT = "mcp-integration-project";
const TEST_PATH = "docs/integration-test.md";
const TEST_CHUNK_TEXT = "OAuth2 authentication uses bearer tokens and refresh tokens";

let server: McpServer;

describe("MCP integration (end-to-end)", () => {
  let sql: ReturnType<typeof postgres>;

  beforeAll(async () => {
    const config = getConfig();
    sql = createPool(config);

    const projectResult = await sql`
      INSERT INTO projects (name, repository_url, default_branch)
      VALUES (${TEST_PROJECT}, 'https://github.com/acme/payments-docs.git', 'main')
      ON CONFLICT (name) DO UPDATE SET repository_url = EXCLUDED.repository_url
      RETURNING id
    `;
    const projectId = projectResult[0].id as number;

    const docResult = await sql`
      INSERT INTO documents (project_id, path, title)
      VALUES (${projectId}, ${TEST_PATH}, 'Integration Test Doc')
      ON CONFLICT (project_id, path) DO UPDATE SET title = EXCLUDED.title
      RETURNING id
    `;
    const documentId = docResult[0].id as number;

    const embeddingClient = createEmbeddingClient(config);
    const embedding = await embeddingClient.embed(TEST_CHUNK_TEXT);
    const embeddingStr = `[${embedding.join(",")}]`;

    await sql`
      INSERT INTO chunks (document_id, chunk_index, text, embedding, heading)
      VALUES (${documentId}, 0, ${TEST_CHUNK_TEXT}, ${embeddingStr}::vector, 'Authentication')
      ON CONFLICT (document_id, chunk_index)
      DO UPDATE SET text = EXCLUDED.text, embedding = EXCLUDED.embedding
    `;

    const gitProvider = createGitProvider(config);
    gitProvider.getDocument = mock(async () => "# Full document content");

    server = buildMcpServer(config, sql, embeddingClient, gitProvider);
  });

  afterAll(async () => {
    if (sql) {
      await sql`DELETE FROM projects WHERE name = ${TEST_PROJECT}`;
      await sql.end();
    }
  });

  it("search_documentation returns the seeded chunk", async () => {
    const result = await server.server.request(
      { method: "tools/call", params: { name: "search_documentation", arguments: { project: TEST_PROJECT, query: "OAuth2 authentication", limit: 5 } } },
      {} as never
    ) as { structuredContent?: { results?: Array<{ path: string; similarity: number }> } };

    const results = result.structuredContent?.results ?? [];
    expect(results.length).toBeGreaterThan(0);

    const found = results.find((r) => r.path === TEST_PATH);
    expect(found).toBeDefined();
    expect(found!.similarity).toBeGreaterThan(0.5);
  });

  it("get_document returns the mocked source-of-truth content", async () => {
    const result = await server.server.request(
      { method: "tools/call", params: { name: "get_document", arguments: { project: TEST_PROJECT, path: TEST_PATH } } },
      {} as never
    ) as { structuredContent?: { content: string; branch: string } };

    expect(result.structuredContent?.content).toBe("# Full document content");
    expect(result.structuredContent?.branch).toBe("main");
  });
});
```

- [ ] **Step 2: Start the database**

Run: `docker compose -f infra/docker-compose.yml up -d`
Expected: PostgreSQL + pgVector starts, migrations run automatically

Wait for health:
```bash
docker compose -f infra/docker-compose.yml exec db pg_isready -U docsindexer -d docsindexer
```

- [ ] **Step 3: Run the integration test**

Run: `bun test mcp/tests/mcp.integration.test.ts`
Expected: PASS — 2 tests pass (seeds data, searches, retrieves via mocked git, cleans up)

- [ ] **Step 4: Commit**

```bash
git add mcp/tests/mcp.integration.test.ts
git commit -m "test: add end-to-end integration test for mcp tools"
```

---

### Task 10: MCP onboarding README

**Files:**
- Create: `mcp/README.md`

**Interfaces:**
- Consumes: nothing
- Produces: a standalone onboarding doc for the MCP server

- [ ] **Step 1: Write mcp/README.md**

Create `mcp/README.md` with the exact content below:

````markdown
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
bun test          # unit tests (mock-based, no network)
bun test tests/   # integration test (requires Docker + OpenRouter key)
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
````

- [ ] **Step 2: Commit**

```bash
git add mcp/README.md
git commit -m "docs: add mcp onboarding readme"
```

---

## Self-Review

### Spec coverage

- **PRD §19** (MCP em TypeScript, não wrapper SQL) → Tasks 6–8: tools are semantic factories, not raw SQL passthrough; `get_document` never reads content from the DB.
- **PRD §20** (Fase 1 Discovery) → Task 6 (`search_documentation`) returns title/path/heading/chunk/similarity.
- **PRD §21** (Fase 2 Retrieval, fetch from source of truth) → Tasks 5 + 7 (`get_document` → `GitProvider` → raw.githubusercontent.com).
- **PRD §22** (two tools: `search_documentation`, `get_document`) → Tasks 6, 7, 8.
- **PRD §24 Opção B** (return results directly, no generated summaries) → Task 6 returns chunk text directly, no LLM summary.
- **PRD §25** (ranking = similarity + project filter) → Task 6 SQL orders by `<=>` and filters `p.name = ${project}`.
- **PRD §26** (projeto como unidade de isolamento) → Task 6 `project` is required, no global search in MVP.
- **PRD §27–28** (segurança / autorização) → deferred to MVP+; documented as a limitation in Task 10. Not blocked architecturally: tools are factories that can later receive an auth context.
- **PRD §42** (MVP técnico: TS, MCP SDK, PostgreSQL, Git provider, two tools) → covered by all tasks.
- **Decisão 4** (TypeScript para MCP) → `mcp/` TypeScript package.
- **RNF03** (segurança) → acknowledged in Task 10 limitation; enforcement intentionally out of MVP scope per PRD §27 ("o MVP pode começar com autenticação simples").

**Known gap:** the indexer CLI currently passes `None` for `repository_url` when upserting projects (`cli/src/db.rs:upsert_project`, callers in `commands/index.rs` and `commands/rebuild.rs`). `get_document` therefore requires the operator to set `repository_url` manually (documented in Task 10). Populating `repository_url` from the CLI is a separate Indexer CLI concern, out of scope for this MCP plan.

### Placeholder scan

No "TBD", "TODO", "implement later", or "add error handling" placeholders. Every task has concrete code, exact test assertions, and a commit step. Task 10 includes the full README content inline.

### Type consistency

- `McpConfig` fields (`databaseUrl`, `openrouterApiKey`, `openrouterBaseUrl`, `embeddingModel`, `githubToken`, `githubBaseUrl`) are defined in Task 2 and used identically in Tasks 3, 4, 5, 8.
- `Sql` type (`ReturnType<typeof postgres>`) is defined in Task 3 and consumed consistently in Tasks 6, 7, 8.
- `EmbeddingClient.embed(text: string): Promise<number[]>` defined in Task 4, consumed in Task 6.
- `GitProvider.getDocument(repositoryUrl, branch, path): Promise<string>` defined in Task 5, consumed in Task 7.
- Tool shapes: `SearchDocumentationTool.handler` returns `SearchResult[]` (Task 6) and `GetDocumentTool.handler` returns `GetDocumentResult` (Task 7); both are wired in Task 8 via `searchTool.handler` / `getDocumentTool.handler`.
- Tool names `search_documentation` / `get_document` are consistent across Tasks 6, 7, 8, 9, 10.
