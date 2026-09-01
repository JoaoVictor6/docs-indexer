import { describe, it, expect, mock } from "bun:test";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { buildMcpServer } from "./index";
import type { ApiClient } from "./api-client";
import type { GitProvider } from "./git";
import type { McpConfig } from "./config";

function createMockApiClient(): ApiClient {
  return {
    search: mock(async () => []),
    getDocumentMetadata: mock(async () => null),
  } as unknown as ApiClient;
}

function createMockGitProvider(): GitProvider {
  return {
    getDocument: mock(async () => "content"),
  };
}

const config: McpConfig = {
  apiUrl: "http://localhost:3001",
  scmToken: "ghp-test",
};

describe("buildMcpServer", () => {
  it("registers both tools", async () => {
    const server = buildMcpServer(config, createMockApiClient(), createMockGitProvider());

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