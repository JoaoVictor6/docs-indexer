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

describe("app with OpenAPI", () => {
  it("serves the OpenAPI JSON spec at /openapi/json", async () => {
    const app = buildApp(createMockSql(), createMockEmbeddingClient());
    const response = await app.handle(new Request("http://localhost/openapi/json"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.paths).toHaveProperty("/search");
    expect(body.info.title).toBeDefined();
  });

  it("documents the /search query parameters", async () => {
    const app = buildApp(createMockSql(), createMockEmbeddingClient());
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
    const app = buildApp(createMockSql(), createMockEmbeddingClient());
    const response = await app.handle(new Request("http://localhost/openapi"));
    expect(response.status).toBe(200);
  });
});

describe("metrics", () => {
  it("serves Prometheus metrics at /metrics containing both HTTP and domain metrics", async () => {
    const app = buildApp(createMockSql(), createMockEmbeddingClient());
    const response = await app.handle(new Request("http://localhost/metrics"));
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain("docs_indexer_http_requests_total");
    expect(body).toContain("docs_indexer_db_queries_total");
  });

  it("labels the source as mcp when the X-Docs-Indexer-Source header is set", async () => {
    const app = buildApp(createMockSql(), createMockEmbeddingClient());
    await app.handle(
      new Request("http://localhost/search?q=x&project=p", {
        headers: { "X-Docs-Indexer-Source": "mcp" },
      })
    );
    const response = await app.handle(new Request("http://localhost/metrics"));
    const body = await response.text();
    const mcpLine = body
      .split("\n")
      .find(
        (l) =>
          l.startsWith("docs_indexer_http_requests_total{") &&
          l.includes("source=\"mcp\"")
      );
    expect(mcpLine).toBeDefined();
    expect(mcpLine).toMatch(/source="mcp"/);
  });

  it("labels the source as http when no X-Docs-Indexer-Source header is set", async () => {
    const app = buildApp(createMockSql(), createMockEmbeddingClient());
    await app.handle(new Request("http://localhost/search?q=x&project=p"));
    const response = await app.handle(new Request("http://localhost/metrics"));
    const body = await response.text();
    const httpLine = body
      .split("\n")
      .find(
        (l) =>
          l.startsWith("docs_indexer_http_requests_total{") &&
          l.includes("source=\"http\"")
      );
    expect(httpLine).toBeDefined();
    expect(httpLine).toMatch(/source="http"/);
  });

  it("labels path with the normalized route pattern, not the concrete URL", async () => {
    const app = buildApp(createMockSql(), createMockEmbeddingClient());
    await app.handle(
      new Request("http://localhost/projects/some-project/document?path=x")
    );
    const response = await app.handle(new Request("http://localhost/metrics"));
    const body = await response.text();
    const line = body
      .split("\n")
      .find(
        (l) =>
          l.startsWith("docs_indexer_http_requests_total{") &&
          l.includes("path=\"/projects/:name/document\"")
      );
    expect(line).toBeDefined();
    expect(line).toMatch(/status="404"/);
    expect(line).not.toContain("some-project");
  });
});
