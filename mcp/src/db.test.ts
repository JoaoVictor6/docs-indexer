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
