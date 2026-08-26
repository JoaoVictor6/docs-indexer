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
      VALUES (${documentId}, 0, ${TEST_CHUNK_TEXT}, ${embeddingStr}::vector, 'Authentication')
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