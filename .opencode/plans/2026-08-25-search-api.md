# Search API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a REST API (Bun + Elysia + TypeScript) that accepts a search query, embeds it via OpenRouter, performs cosine-similarity search against pgVector, and returns ranked results with chunk text, document path, and project name.

**Architecture:** The API sits alongside the existing Rust CLI — both share the same PostgreSQL + pgVector database. The API is a thin serving layer: it embeds the query text via OpenRouter, executes a pgVector `<=>` cosine-distance join across `chunks → documents → projects`, and returns the top-k results sorted by similarity. Configuration is validated with Zod at startup (fail-fast on missing/empty env). Request validation uses Zod (Standard Schema) with Elysia returning HTTP 422 on invalid input. Auth is designed as an Elysia plugin that currently passes through but accepts an `Authorization` header — swapping in real auth later requires changes only in the plugin file. API docs are auto-generated via the OpenAPI plugin (Scalar UI).

**Tech Stack:** Bun 1.x, TypeScript 5.x, Elysia 1.x, postgres.js, Zod, `@elysia/openapi`, OpenRouter embeddings API

**Spec:** `PRD.md` sections 19–26 (MCP Server / Search API) and `README.md` database schema

## Global Constraints

- Use `bun` as the runtime and package manager (`bun run`, `bun test`)
- Use `elysia` for HTTP framework, `postgres` (postgres.js) for database, `zod` for validation, `@elysia/openapi` for API docs
- Environment variables for all secrets and configuration — never hardcode credentials
- Database URL: `postgres://docsindexer:docsindexer@localhost:5432/docsindexer` (dev default, overridden via `DATABASE_URL`)
- Config must fail fast: `getConfig()` throws on missing OR empty `DATABASE_URL` / `OPENROUTER_API_KEY`
- Auth is a no-op Elysia plugin that threads an `auth` context object through routes; changing auth later must not require route changes
- API listens on port `3000` by default (overridden via `PORT`)
- Response format: JSON array of `{ chunk, path, project, similarity }` ordered by similarity descending
- Invalid query params return HTTP 422 via Elysia's native Zod validation (no manual status codes in the handler)
- Tests use `bun:test` — native test runner, no Jest/Vitest
- Commit after every task

---

### Task 1: Scaffold the api/ project

**Files:**
- Create: `api/package.json`
- Create: `api/tsconfig.json`
- Create: `api/.env.example`
- Modify: `.gitignore` (add `node_modules/` and `api/.env`)

**Interfaces:**
- Consumes: nothing
- Produces: installable project with deps: `elysia`, `postgres`, `zod`, `@elysia/openapi`

- [ ] **Step 1: Create api/package.json**

Create `api/package.json`:
```json
{
  "name": "docs-indexer-api",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "bun run --watch src/index.ts",
    "start": "bun run src/index.ts",
    "test": "bun test"
  }
}
```

- [ ] **Step 2: Create api/tsconfig.json**

Create `api/tsconfig.json`:
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

- [ ] **Step 3: Create api/.env.example**

Create `api/.env.example`:
```
DATABASE_URL=postgres://docsindexer:docsindexer@localhost:5432/docsindexer
OPENROUTER_API_KEY=sk-or-v1-your-key-here
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
EMBEDDING_MODEL=openai/text-embedding-3-small
PORT=3000
```

- [ ] **Step 4: Add node_modules to .gitignore**

Read `/home/joao/projects/docs-indexer/.gitignore` first, then append two lines at the end:
```
node_modules/
api/.env
```

- [ ] **Step 5: Install dependencies**

Run: `bun install && bun add elysia postgres zod @elysia/openapi && bun add -d @types/bun typescript`
Expected: installs elysia, postgres, zod, @elysia/openapi, and dev deps without errors

- [ ] **Step 6: Commit**

```bash
git add api/package.json api/tsconfig.json api/.env.example .gitignore api/bun.lock api/bun.lockb
git commit -m "feat: scaffold api project with bun + elysia + postgres.js + zod + openapi"
```

---

### Task 2: Configuration module with Zod (fail-fast)

**Files:**
- Create: `api/src/config.ts`
- Test: inline test file `api/src/config.test.ts`

**Interfaces:**
- Consumes: environment variables (`DATABASE_URL`, `OPENROUTER_API_KEY`, `OPENROUTER_BASE_URL`, `EMBEDDING_MODEL`, `PORT`)
- Produces: `getConfig(): AppConfig` — returns typed config object with fields `databaseUrl`, `openrouterApiKey`, `openrouterBaseUrl`, `embeddingModel`, `port`; throws on missing/empty required vars

- [ ] **Step 1: Write the test file**

Create `api/src/config.test.ts`:
```typescript
import { describe, it, expect, beforeEach, afterEach } from "bun:test";

function saveEnv(): Record<string, string | undefined> {
  return {
    DATABASE_URL: process.env.DATABASE_URL,
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
    OPENROUTER_BASE_URL: process.env.OPENROUTER_BASE_URL,
    EMBEDDING_MODEL: process.env.EMBEDDING_MODEL,
    PORT: process.env.PORT,
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
  delete process.env.PORT;
}

describe("getConfig", () => {
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    savedEnv = saveEnv();
    clearEnv();
  });

  afterEach(() => restoreEnv(savedEnv));

  it("reads DATABASE_URL and OPENROUTER_API_KEY from env", async () => {
    process.env.DATABASE_URL = "postgres://user:pass@localhost:5432/db";
    process.env.OPENROUTER_API_KEY = "sk-test-key";
    const { getConfig } = await import("./config");
    const config = getConfig();
    expect(config.databaseUrl).toBe("postgres://user:pass@localhost:5432/db");
    expect(config.openrouterApiKey).toBe("sk-test-key");
  });

  it("applies defaults for optional vars", async () => {
    process.env.DATABASE_URL = "postgres://user:pass@localhost:5432/db";
    process.env.OPENROUTER_API_KEY = "sk-test-key";
    const { getConfig } = await import("./config");
    const config = getConfig();
    expect(config.openrouterBaseUrl).toBe("https://openrouter.ai/api/v1");
    expect(config.embeddingModel).toBe("openai/text-embedding-3-small");
    expect(config.port).toBe(3000);
  });

  it("reads overridden optional vars", async () => {
    process.env.DATABASE_URL = "postgres://user:pass@localhost:5432/db";
    process.env.OPENROUTER_API_KEY = "sk-test-key";
    process.env.OPENROUTER_BASE_URL = "https://custom.api/v1";
    process.env.EMBEDDING_MODEL = "custom-model";
    process.env.PORT = "8080";
    const { getConfig } = await import("./config");
    const config = getConfig();
    expect(config.openrouterBaseUrl).toBe("https://custom.api/v1");
    expect(config.embeddingModel).toBe("custom-model");
    expect(config.port).toBe(8080);
  });

  it("throws if DATABASE_URL is missing", async () => {
    process.env.OPENROUTER_API_KEY = "sk-test-key";
    const { getConfig } = await import("./config");
    expect(() => getConfig()).toThrow("DATABASE_URL");
  });

  it("throws if DATABASE_URL is empty", async () => {
    process.env.DATABASE_URL = "";
    process.env.OPENROUTER_API_KEY = "sk-test-key";
    const { getConfig } = await import("./config");
    expect(() => getConfig()).toThrow("DATABASE_URL");
  });

  it("throws if OPENROUTER_API_KEY is missing", async () => {
    process.env.DATABASE_URL = "postgres://user:pass@localhost:5432/db";
    const { getConfig } = await import("./config");
    expect(() => getConfig()).toThrow("OPENROUTER_API_KEY");
  });

  it("throws if OPENROUTER_API_KEY is empty", async () => {
    process.env.DATABASE_URL = "postgres://user:pass@localhost:5432/db";
    process.env.OPENROUTER_API_KEY = "";
    const { getConfig } = await import("./config");
    expect(() => getConfig()).toThrow("OPENROUTER_API_KEY");
  });

  it("coerces PORT to a number", async () => {
    process.env.DATABASE_URL = "postgres://user:pass@localhost:5432/db";
    process.env.OPENROUTER_API_KEY = "sk-test-key";
    process.env.PORT = "8080";
    const { getConfig } = await import("./config");
    const config = getConfig();
    expect(config.port).toBe(8080);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test api/src/config.test.ts`
Expected: FAIL — module `./config` not found

- [ ] **Step 3: Implement config.ts**

Create `api/src/config.ts`:
```typescript
import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  OPENROUTER_API_KEY: z.string().min(1),
  OPENROUTER_BASE_URL: z.string().url().default("https://openrouter.ai/api/v1"),
  EMBEDDING_MODEL: z.string().min(1).default("openai/text-embedding-3-small"),
  PORT: z.coerce.number().int().positive().default(3000),
});

export interface AppConfig {
  databaseUrl: string;
  openrouterApiKey: string;
  openrouterBaseUrl: string;
  embeddingModel: string;
  port: number;
}

export function getConfig(): AppConfig {
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
    port: env.PORT,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test api/src/config.test.ts`
Expected: PASS — 8 tests pass

- [ ] **Step 5: Commit**

```bash
git add api/src/config.ts api/src/config.test.ts
git commit -m "feat: add zod-validated config with fail-fast on missing env"
```

---

### Task 3: Database connection pool

**Files:**
- Create: `api/src/db.ts`
- Test: inline test file `api/src/db.test.ts`

**Interfaces:**
- Consumes: `AppConfig.databaseUrl` from Task 2
- Produces: `createPool(config: AppConfig): Sql` — returns a postgres.js `Sql` instance (typed via `ReturnType<typeof postgres>`)

- [ ] **Step 1: Write the test**

Create `api/src/db.test.ts`:
```typescript
import { describe, it, expect } from "bun:test";
import { createPool } from "./db";

describe("createPool", () => {
  const config = {
    databaseUrl: process.env.DATABASE_URL || "postgres://docsindexer:docsindexer@localhost:5432/docsindexer",
    openrouterApiKey: "sk-test",
    openrouterBaseUrl: "https://openrouter.ai/api/v1",
    embeddingModel: "openai/text-embedding-3-small",
    port: 3000,
  };

  it("returns a sql instance when given a valid config", () => {
    const sql = createPool(config);
    expect(sql).toBeDefined();
    expect(typeof sql).toBe("function");
    sql.end();
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

Run: `bun test api/src/db.test.ts`
Expected: FAIL — `createPool` not defined

- [ ] **Step 3: Implement db.ts**

Create `api/src/db.ts`:
```typescript
import postgres from "postgres";
import type { AppConfig } from "./config";

export type Sql = ReturnType<typeof postgres>;

export function createPool(config: AppConfig): Sql {
  return postgres(config.databaseUrl, {
    max: 10,
    idle_timeout: 30,
    connect_timeout: 10,
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test api/src/db.test.ts`
Expected: PASS (requires PostgreSQL running on localhost — start with `docker compose -f infra/docker-compose.yml up -d` if not running)

- [ ] **Step 5: Commit**

```bash
git add api/src/db.ts api/src/db.test.ts
git commit -m "feat: add postgres.js connection pool module"
```

---

### Task 4: Embedding client (OpenRouter)

**Files:**
- Create: `api/src/embedding.ts`
- Test: inline test file `api/src/embedding.test.ts`

**Interfaces:**
- Consumes: `AppConfig.openrouterApiKey`, `AppConfig.openrouterBaseUrl`, `AppConfig.embeddingModel` from Task 2
- Produces: `createEmbeddingClient(config: AppConfig): EmbeddingClient` where `EmbeddingClient` has `.embed(text: string): Promise<number[]>`

- [ ] **Step 1: Write the test**

Create `api/src/embedding.test.ts`:
```typescript
import { describe, it, expect, mock } from "bun:test";
import { createEmbeddingClient } from "./embedding";
import type { AppConfig } from "./config";

describe("EmbeddingClient", () => {
  const config: AppConfig = {
    databaseUrl: "postgres://localhost/db",
    openrouterApiKey: "sk-test",
    openrouterBaseUrl: "https://openrouter.ai/api/v1",
    embeddingModel: "openai/text-embedding-3-small",
    port: 3000,
  };

  it("calls OpenRouter and returns an embedding vector", async () => {
    const client = createEmbeddingClient(config);

    const fetchMock = mock(() =>
      Promise.resolve(new Response(
        JSON.stringify({ data: [{ embedding: [0.1, 0.2, 0.3] }] }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      ))
    );
    globalThis.fetch = fetchMock;

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
      })
    );
  });

  it("throws when OpenRouter returns a non-2xx status", async () => {
    const client = createEmbeddingClient(config);

    globalThis.fetch = mock(() =>
      Promise.resolve(new Response("unauthorized", { status: 401 }))
    );

    await expect(client.embed("hello")).rejects.toThrow("OpenRouter returned 401");
  });

  it("throws when OpenRouter returns no embeddings", async () => {
    const client = createEmbeddingClient(config);

    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(
        JSON.stringify({ data: [] }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      ))
    );

    await expect(client.embed("hello")).rejects.toThrow("no embeddings");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test api/src/embedding.test.ts`
Expected: FAIL — module `./embedding` not found

- [ ] **Step 3: Implement embedding.ts**

Create `api/src/embedding.ts`:
```typescript
import type { AppConfig } from "./config";

export interface EmbeddingClient {
  embed(text: string): Promise<number[]>;
}

export function createEmbeddingClient(config: AppConfig): EmbeddingClient {
  return new OpenRouterEmbeddingClient(config);
}

class OpenRouterEmbeddingClient implements EmbeddingClient {
  private apiKey: string;
  private baseUrl: string;
  private model: string;

  constructor(config: AppConfig) {
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

Run: `bun test api/src/embedding.test.ts`
Expected: PASS — 3 tests pass (mock-based, no OpenRouter call)

- [ ] **Step 5: Commit**

```bash
git add api/src/embedding.ts api/src/embedding.test.ts
git commit -m "feat: add OpenRouter embedding client"
```

---

### Task 5: Auth plugin (no-op, decoupled for future)

**Files:**
- Create: `api/src/auth.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `authPlugin` — Elysia plugin that derives `{ auth: Record<string, unknown> }` from request context

- [ ] **Step 1: Implement auth.ts**

Create `api/src/auth.ts`:
```typescript
import { Elysia } from "elysia";

export const authPlugin = new Elysia({ name: "auth" }).derive(({ headers }) => {
  const authorization = headers["authorization"];

  return {
    auth: {
      authenticated: authorization !== undefined,
      // When real auth is implemented, parse the JWT/bearer token here
      // and populate: userId, projectPermissions, roles, etc.
    } as Record<string, unknown>,
  };
});
```

- [ ] **Step 2: Commit**

```bash
git add api/src/auth.ts
git commit -m "feat: add auth plugin with no-op pass-through"
```

---

### Task 6: Search route with Zod validation

**Files:**
- Create: `api/src/routes/search.ts`
- Test: inline test file `api/src/routes/search.test.ts`

**Interfaces:**
- Consumes: `Sql` (Task 3), `EmbeddingClient` (Task 4)
- Produces: `createSearchRoute(sql: Sql, embeddingClient: EmbeddingClient): Elysia` exposing `GET /search?q=<text>&project=<optional>&limit=<optional>`
- Exported schemas: `searchQuerySchema` (Zod), `searchResultSchema` (Zod)
- `SearchResult` shape: `{ chunk: string; path: string; project: string; similarity: number }`

- [ ] **Step 1: Write the test**

Create `api/src/routes/search.test.ts`:
```typescript
import { describe, it, expect, mock, beforeEach } from "bun:test";
import { Elysia } from "elysia";
import { createSearchRoute } from "./search";
import type { EmbeddingClient } from "../embedding";
import type { Sql } from "../db";

function createMockSql(): Sql {
  const sqlMock = mock(async (_strings: TemplateStringsArray, ..._values: unknown[]) => [
    {
      chunk: "This is a test chunk about authentication",
      path: "docs/auth.md",
      project: "test-project",
      similarity: 0.95,
    },
    {
      chunk: "Another chunk about payments",
      path: "docs/payments.md",
      project: "test-project",
      similarity: 0.82,
    },
  ]) as unknown as Sql;
  return sqlMock as unknown as Sql;
}

function createMockEmbeddingClient(): EmbeddingClient {
  return {
    embed: mock(async (_: string): Promise<number[]> => {
      const v = new Array(1536).fill(0);
      v[0] = 0.5;
      return v;
    }),
  };
}

describe("GET /search", () => {
  let app: Elysia;

  beforeEach(() => {
    const sql = createMockSql();
    const embeddingClient = createMockEmbeddingClient();
    const searchRoute = createSearchRoute(sql, embeddingClient);
    app = new Elysia().use(searchRoute);
  });

  it("returns search results for a valid query", async () => {
    const response = await app.handle(new Request("http://localhost/search?q=authentication"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toBeArray();
    expect(body.length).toBe(2);
    expect(body[0]).toHaveProperty("chunk");
    expect(body[0]).toHaveProperty("path");
    expect(body[0]).toHaveProperty("project");
    expect(body[0]).toHaveProperty("similarity");
  });

  it("returns 422 when query parameter is missing", async () => {
    const response = await app.handle(new Request("http://localhost/search"));
    expect(response.status).toBe(422);
  });

  it("returns 422 when query parameter is empty", async () => {
    const response = await app.handle(new Request("http://localhost/search?q="));
    expect(response.status).toBe(422);
  });

  it("returns 422 when limit is not a valid integer", async () => {
    const response = await app.handle(new Request("http://localhost/search?q=auth&limit=abc"));
    expect(response.status).toBe(422);
  });

  it("passes optional project and limit parameters", async () => {
    const response = await app.handle(
      new Request("http://localhost/search?q=auth&project=payments&limit=5")
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toBeArray();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test api/src/routes/search.test.ts`
Expected: FAIL — module `./search` not found

- [ ] **Step 3: Implement routes/search.ts**

Create `api/src/routes/search.ts`:
```typescript
import { Elysia } from "elysia";
import { z } from "zod";
import type { Sql } from "../db";
import type { EmbeddingClient } from "../embedding";

export const searchQuerySchema = z.object({
  q: z.string().min(1),
  project: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(10),
});

export const searchResultSchema = z.object({
  chunk: z.string(),
  path: z.string(),
  project: z.string(),
  similarity: z.number(),
});

export type SearchResult = z.infer<typeof searchResultSchema>;

export function createSearchRoute(sql: Sql, embeddingClient: EmbeddingClient) {
  return new Elysia({ name: "search" }).get(
    "/search",
    async ({ query }) => {
      const searchText = query.q.trim();
      const limit = query.limit;
      const projectFilter = query.project?.trim() || null;

      const queryEmbedding = await embeddingClient.embed(searchText);
      const embeddingVector = `[${queryEmbedding.join(",")}]`;

      return await sql<SearchResult[]>`
        SELECT
          c.text AS chunk,
          d.path AS path,
          p.name AS project,
          1 - (c.embedding <=> ${embeddingVector}::vector) AS similarity
        FROM chunks c
        JOIN documents d ON c.document_id = d.id
        JOIN projects p ON d.project_id = p.id
        WHERE c.embedding IS NOT NULL
          AND (${projectFilter}::text IS NULL OR p.name = ${projectFilter})
        ORDER BY c.embedding <=> ${embeddingVector}::vector
        LIMIT ${limit}
      `;
    },
    {
      query: searchQuerySchema,
      response: z.array(searchResultSchema),
    }
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test api/src/routes/search.test.ts`
Expected: PASS — 5 tests pass (mock-based, no real DB or OpenRouter needed)

- [ ] **Step 5: Commit**

```bash
git add api/src/routes/search.ts api/src/routes/search.test.ts
git commit -m "feat: add zod-validated search route with pgvector cosine similarity"
```

---

### Task 7: App entry point with OpenAPI plugin

**Files:**
- Create: `api/src/index.ts`
- Test: inline test file `api/src/index.test.ts`

**Interfaces:**
- Consumes: `getConfig` (Task 2), `createPool` (Task 3), `createEmbeddingClient` (Task 4), `createSearchRoute` (Task 6), `authPlugin` (Task 5), `openapi` from `@elysia/openapi`
- Produces: a runnable Elysia app listening on `config.port`; `buildApp(config, sql, embeddingClient): Elysia` exported for testability; auto-generated OpenAPI docs at `/openapi` (UI) and `/openapi/json` (spec)

- [ ] **Step 1: Write the test**

Create `api/src/index.test.ts`:
```typescript
import { describe, it, expect, mock } from "bun:test";
import { buildApp } from "./index";
import type { Sql } from "./db";
import type { EmbeddingClient } from "./embedding";

function createMockSql(): Sql {
  const sqlMock = mock(async (_strings: TemplateStringsArray, ..._values: unknown[]) => []) as unknown as Sql;
  return sqlMock as unknown as Sql;
}

function createMockEmbeddingClient(): EmbeddingClient {
  return {
    embed: mock(async (_: string): Promise<number[]> => new Array(1536).fill(0)),
  };
}

const config = {
  databaseUrl: "postgres://localhost/db",
  openrouterApiKey: "sk-test",
  openrouterBaseUrl: "https://openrouter.ai/api/v1",
  embeddingModel: "openai/text-embedding-3-small",
  port: 3000,
};

describe("app with OpenAPI", () => {
  it("serves the OpenAPI JSON spec at /openapi/json", async () => {
    const app = buildApp(config, createMockSql(), createMockEmbeddingClient());
    const response = await app.handle(new Request("http://localhost/openapi/json"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.paths).toHaveProperty("/search");
    expect(body.info.title).toBeDefined();
  });

  it("documents the /search query parameters", async () => {
    const app = buildApp(config, createMockSql(), createMockEmbeddingClient());
    const response = await app.handle(new Request("http://localhost/openapi/json"));
    const body = await response.json();
    const searchOp = body.paths["/search"].get;
    expect(searchOp).toBeDefined();
    const queryParams = (searchOp.parameters || []).map((p: { name: string }) => p.name);
    expect(queryParams).toContain("q");
    expect(queryParams).toContain("project");
    expect(queryParams).toContain("limit");
  });

  it("serves the OpenAPI UI at /openapi", async () => {
    const app = buildApp(config, createMockSql(), createMockEmbeddingClient());
    const response = await app.handle(new Request("http://localhost/openapi"));
    expect(response.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test api/src/index.test.ts`
Expected: FAIL — module `./index` not found (or `buildApp` not exported)

- [ ] **Step 3: Implement index.ts**

Create `api/src/index.ts`:
```typescript
import { Elysia } from "elysia";
import { openapi } from "@elysia/openapi";
import { getConfig, type AppConfig } from "./config";
import { createPool, type Sql } from "./db";
import { createEmbeddingClient, type EmbeddingClient } from "./embedding";
import { createSearchRoute } from "./routes/search";
import { authPlugin } from "./auth";

export function buildApp(config: AppConfig, sql: Sql, embeddingClient: EmbeddingClient): Elysia {
  const searchRoute = createSearchRoute(sql, embeddingClient);

  return new Elysia()
    .use(openapi({
      documentation: {
        info: {
          title: "docs-indexer API",
          version: "0.1.0",
          description: "Semantic search over indexed documentation.",
        },
      },
    }))
    .use(authPlugin)
    .use(searchRoute);
}

const config = getConfig();
const sql = createPool(config);
const embeddingClient = createEmbeddingClient(config);

buildApp(config, sql, embeddingClient).listen(config.port);

console.log(`docs-indexer API listening on port ${config.port}`);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test api/src/index.test.ts`
Expected: PASS — 3 tests pass

- [ ] **Step 5: Commit**

```bash
git add api/src/index.ts api/src/index.test.ts
git commit -m "feat: add app entry point with OpenAPI documentation"
```

---

### Task 8: Integration test (end-to-end with real PostgreSQL)

**Files:**
- Create: `api/tests/search.integration.test.ts`

**Interfaces:**
- Consumes: `buildApp` (Task 7), `getConfig` (Task 2), `createPool` (Task 3), `createEmbeddingClient` (Task 4); requires running PostgreSQL + pgVector via Docker and a valid `OPENROUTER_API_KEY`
- Produces: Validates the full flow: seed data → route handler → verify results

- [ ] **Step 1: Write the integration test**

Create `api/tests/search.integration.test.ts`:
```typescript
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import type { Elysia } from "elysia";
import type postgres from "postgres";
import { getConfig } from "../src/config";
import { createPool } from "../src/db";
import { createEmbeddingClient } from "../src/embedding";
import { buildApp } from "../src/index";

// Requires:
//   docker compose -f infra/docker-compose.yml up -d
//   A valid OPENROUTER_API_KEY in the environment
// The database migrates automatically on first docker compose boot.

const TEST_PROJECT = "integration-test-project";
const TEST_PATH = "docs/integration-test.md";
const TEST_CHUNK_TEXT = "This is a chunk about OAuth2 authentication flows and token refresh strategies";

let app: Elysia;

describe("search integration (end-to-end)", () => {
  let sql: ReturnType<typeof postgres>;

  beforeAll(async () => {
    const config = getConfig();
    sql = createPool(config);

    const projectResult = await sql`
      INSERT INTO projects (name)
      VALUES (${TEST_PROJECT})
      ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
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
      VALUES (${documentId}, 0, ${TEST_CHUNK_TEXT}, ${sql.unsafe(embeddingStr)}::vector, 'Authentication')
      ON CONFLICT (document_id, chunk_index)
      DO UPDATE SET text = EXCLUDED.text, embedding = EXCLUDED.embedding
    `;

    app = buildApp(config, sql, embeddingClient);
  });

  afterAll(async () => {
    await sql`DELETE FROM projects WHERE name = ${TEST_PROJECT}`;
    await sql.end();
  });

  it("returns the seeded document when searching for related terms", async () => {
    const response = await app.handle(
      new Request("http://localhost/search?q=OAuth2 authentication&limit=5")
    );
    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body).toBeArray();
    expect(body.length).toBeGreaterThan(0);

    const found = body.find((r: { path: string }) => r.path === TEST_PATH);
    expect(found).toBeDefined();
    expect(found.project).toBe(TEST_PROJECT);
    expect(found.chunk).toBe(TEST_CHUNK_TEXT);
    expect(found.similarity).toBeGreaterThan(0.5);
  });

  it("filters by project when project param is provided", async () => {
    const response = await app.handle(
      new Request(`http://localhost/search?q=auth&project=${TEST_PROJECT}&limit=10`)
    );
    expect(response.status).toBe(200);
    const body = await response.json();

    for (const result of body) {
      expect(result.project).toBe(TEST_PROJECT);
    }
  });

  it("returns a JSON array for a non-matching query", async () => {
    const response = await app.handle(
      new Request("http://localhost/search?q=zzzxyznonexistentphrase999&limit=5")
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toBeArray();
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

Run: `bun test api/tests/search.integration.test.ts`
Expected: PASS — 3 tests pass (seeds data, searches, verifies results, cleans up)

- [ ] **Step 4: Commit**

```bash
git add api/tests/search.integration.test.ts
git commit -m "test: add end-to-end integration test for search route"
```

---

### Task 9: Documentation

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: nothing
- Produces: usage docs for the API

- [ ] **Step 1: Add API section to README**

Add a new section to `README.md` after the "Quick Start" section, documenting:

```markdown
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
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: document the search API"
```
