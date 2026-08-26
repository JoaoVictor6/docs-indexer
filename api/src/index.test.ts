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