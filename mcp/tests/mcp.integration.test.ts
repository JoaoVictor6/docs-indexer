import { describe, it, expect, beforeAll, afterAll, mock } from "bun:test";
import { InMemoryTransport, type McpServer } from "@modelcontextprotocol/server";
import { getConfig } from "../src/config";
import { createApiClient } from "../src/api-client";
import { createGitProvider } from "../src/git";
import { buildMcpServer } from "../src/index";

// Requires:
//   Running API at API_URL (./api with "bun run dev")
//   Pre-seeded database with project 'mcp-integration-project' and document 'docs/integration-test.md'
//   A valid SCM_TOKEN in the environment
//   docker compose -f infra/docker-compose.yml up -d
// The database migrates automatically on first docker compose boot.

const TEST_PROJECT = "mcp-integration-project";
const TEST_PATH = "docs/integration-test.md";

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
      const message = msg as { id?: number; result?: ToolCallResult; error?: { message: string } };
      if (message.id !== id) return;
      if (message.error) { reject(new Error(message.error.message)); return; }
      resolve(message.result ?? {});
    };
    void clientTransport.send({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } });
  });
}

describe("MCP integration (end-to-end)", () => {
  beforeAll(async () => {
    const config = getConfig();
    const apiClient = createApiClient(config.apiUrl);
    const gitProvider = createGitProvider(config.scmToken);
    gitProvider.getDocument = mock(async () => "# Full document content");

    server = buildMcpServer(config, apiClient, gitProvider);
    const transports = InMemoryTransport.createLinkedPair();
    clientTransport = transports[0];
    await server.connect(transports[1]);
  });

  afterAll(async () => {
    if (server) await server.close();
  });

  it("search_documentation returns results from the API", async () => {
    const result = await callTool("search_documentation", { project: TEST_PROJECT, query: "OAuth2 authentication", limit: 5 });
    const results = result.structuredContent?.results ?? [];
    expect(results.length).toBeGreaterThan(0);
    const found = results.find((r) => r.path === TEST_PATH);
    expect(found).toBeDefined();
    expect(found!.similarity).toBeGreaterThan(0.5);
  });

  it("get_document returns the mocked source-of-truth content", async () => {
    const result = await callTool("get_document", { project: TEST_PROJECT, path: TEST_PATH });
    expect(result.structuredContent?.content).toBe("# Full document content");
    expect(result.structuredContent?.branch).toBe("main");
  });
});