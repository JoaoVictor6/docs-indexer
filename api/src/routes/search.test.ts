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
    app = new Elysia().use(searchRoute) as unknown as Elysia;
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