import { describe, it, expect, beforeAll, afterAll, mock } from "bun:test";
import { InMemoryTransport, type McpServer } from "@modelcontextprotocol/server";
import { getConfig } from "../src/config";
import { createPool, type Sql } from "../src/db";
import { createEmbeddingClient } from "../src/embedding";
import { createGitProvider } from "../src/git";
import { buildMcpServer } from "../src/index";

// Requires:
//   docker compose -f infra/docker-compose.yml up -d
//   A valid OPENROUTER_API_KEY in the environment (mcp/.env)
//   GITHUB_TOKEN set in the environment (the actual fetch is mocked, so any value works)
// The database migrates automatically on first docker compose boot.

const TEST_PROJECT = "mcp-integration-project";
const TEST_PATH = "docs/integration-test.md";
const TEST_CHUNK_TEXT = "OAuth2 authentication uses bearer tokens and refresh tokens";

let server: McpServer;
let clientTransport: InMemoryTransport;
let callId = 0;

interface ToolCallResult {
  structuredContent?: {
    results?: Array<{ path: string; similarity: number }>;
    content?: string;
    branch?: string;
  };
}

function callTool(name: string, args: Record<string, unknown>): Promise<ToolCallResult> {
  const id = ++callId;
  return new Promise<ToolCallResult>((resolve, reject) => {
    clientTransport.onmessage = (msg) => {
      const message = msg as {
        id?: number;
        result?: ToolCallResult;
        error?: { message: string };
      };
      if (message.id !== id) return;
      if (message.error) {
        reject(new Error(`tool ${name} error: ${message.error.message}`));
        return;
      }
      resolve(message.result ?? {});
    };
    void clientTransport.send({
      jsonrpc: "2.0",
      id,
      method: "tools/call",
      params: { name, arguments: args },
    });
  });
}

describe("MCP integration (end-to-end)", () => {
  let sql: Sql;

  beforeAll(async () => {
    const config = getConfig();
    sql = createPool(config);

    const projectResult = await sql<{ id: number }[]>`
      INSERT INTO projects (name, repository_url, default_branch)
      VALUES (${TEST_PROJECT}, 'https://github.com/acme/payments-docs.git', 'main')
      ON CONFLICT (name) DO UPDATE SET repository_url = EXCLUDED.repository_url
      RETURNING id
    `;
    const projectId = projectResult[0].id;

    const docResult = await sql<{ id: number }[]>`
      INSERT INTO documents (project_id, path, title)
      VALUES (${projectId}, ${TEST_PATH}, 'Integration Test Doc')
      ON CONFLICT (project_id, path) DO UPDATE SET title = EXCLUDED.title
      RETURNING id
    `;
    const documentId = docResult[0].id;

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

    const transports = InMemoryTransport.createLinkedPair();
    clientTransport = transports[0];
    await server.connect(transports[1]);
  });

  afterAll(async () => {
    if (server) {
      await server.close();
    }
    if (sql) {
      await sql`DELETE FROM projects WHERE name = ${TEST_PROJECT}`;
      await sql.end();
    }
  });

  it("search_documentation returns the seeded chunk", async () => {
    const result = await callTool("search_documentation", {
      project: TEST_PROJECT,
      query: "OAuth2 authentication",
      limit: 5,
    });

    const results = result.structuredContent?.results ?? [];
    expect(results.length).toBeGreaterThan(0);

    const found = results.find((r) => r.path === TEST_PATH);
    expect(found).toBeDefined();
    expect(found!.similarity).toBeGreaterThan(0.5);
  });

  it("get_document returns the mocked source-of-truth content", async () => {
    const result = await callTool("get_document", {
      project: TEST_PROJECT,
      path: TEST_PATH,
    });

    expect(result.structuredContent?.content).toBe("# Full document content");
    expect(result.structuredContent?.branch).toBe("main");
  });
});
