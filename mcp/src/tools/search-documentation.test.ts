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
