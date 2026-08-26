import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { getConfig, type McpConfig } from "./config";
import { createPool, type Sql } from "./db";
import { createEmbeddingClient, type EmbeddingClient } from "./embedding";
import { createGitProvider, type GitProvider } from "./git";
import { createSearchDocumentationTool } from "./tools/search-documentation";
import { createGetDocumentTool } from "./tools/get-document";

export function buildMcpServer(
  _config: McpConfig,
  sql: Sql,
  embeddingClient: EmbeddingClient,
  gitProvider: GitProvider
): McpServer {
  const server = new McpServer({ name: "docs-indexer", version: "0.1.0" });

  const searchTool = createSearchDocumentationTool(sql, embeddingClient);
  server.registerTool(
    searchTool.name,
    {
      description: "Semantic search over a project's indexed documentation. Returns ranked chunks with title, path, heading, chunk text, and similarity score.",
      inputSchema: searchTool.inputSchema,
    },
    async (args) => {
      const results = await searchTool.handler(args);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(results, null, 2) }],
        structuredContent: { results },
      };
    }
  );

  const getDocumentTool = createGetDocumentTool(sql, gitProvider);
  server.registerTool(
    getDocumentTool.name,
    {
      description: "Retrieve the full content of a document from the project's Git source of truth (main branch), not from the index.",
      inputSchema: getDocumentTool.inputSchema,
    },
    async (args) => {
      const result = await getDocumentTool.handler(args);
      return {
        content: [{ type: "text" as const, text: result.content }],
        structuredContent: result,
      };
    }
  );

  return server;
}

async function main() {
  const config = getConfig();
  const sql = createPool(config);
  const embeddingClient = createEmbeddingClient(config);
  const gitProvider = createGitProvider(config);

  const server = buildMcpServer(config, sql, embeddingClient, gitProvider);

  const handle = serveStdio(() => server);

  process.on("SIGINT", () => {
    handle.close();
    process.exit(0);
  });

  console.error("docs-indexer MCP server running on stdio");
}

if (import.meta.main) {
  main();
}
