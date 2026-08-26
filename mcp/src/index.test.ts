import { describe, it, expect, mock } from "bun:test";
import { InMemoryTransport } from "@modelcontextprotocol/server";
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
  scmToken: "ghp-test",
};

describe("buildMcpServer", () => {
  it("registers both tools", async () => {
    const server = buildMcpServer(config, createMockSql(), createMockEmbeddingClient(), createMockGitProvider());

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);

    const responsePromise = new Promise<{ result?: { tools: Array<{ name: string }> } }>((resolve) => {
      clientTransport.onmessage = (msg) => resolve(msg as { result?: { tools: Array<{ name: string }> } });
    });

    await clientTransport.send({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });
    const response = await responsePromise;

    const toolNames = response.result?.tools.map((t) => t.name) ?? [];
    expect(toolNames).toContain("search_documentation");
    expect(toolNames).toContain("get_document");

    await server.close();
  });
});
