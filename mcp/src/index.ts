import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { getConfig, type McpConfig } from "./config";
import { createApiClient, type ApiClient } from "./api-client";
import { createGitProvider, type GitProvider } from "./git";
import { createSearchDocumentationTool } from "./tools/search-documentation";
import { createGetDocumentTool } from "./tools/get-document";

export function buildMcpServer(
  _config: McpConfig,
  apiClient: ApiClient,
  gitProvider: GitProvider
): McpServer {
  const server = new McpServer({ name: "docs-indexer", version: "0.1.0" });

  const searchTool = createSearchDocumentationTool(apiClient);
  const searchDocumentToolDescription = `
Search the project's indexed documentation to discover and disambiguate concepts,
terminology, components, APIs, workflows, and implementation details.

Use this tool when the user's request is ambiguous, when a name or concept is unfamiliar,
or when you need to identify which internal system, service, API, configuration, or workflow
the user is referring to.

The search is semantic, so queries should describe the user's intent or concept rather than
rely only on exact keywords.

Results are ranked by semantic similarity and include the document title, path, heading,
chunk text, and similarity score.

IMPORTANT:
- Treat results as evidence for resolving ambiguity, not as assumptions.
- Prefer results from the most specific matching project/documentation context.
- Inspect the path, heading, and surrounding chunk content together; the same term may have
  different meanings in different parts of the documentation.
- When several interpretations are plausible, search again with a more specific query rather
  than choosing an interpretation arbitrarily.
- Use the returned path and heading as canonical identifiers for subsequent document retrieval.
- A high similarity score indicates semantic relevance, not factual certainty.
- Do not assume that the highest-ranked result is necessarily the correct interpretation when
  multiple systems or concepts share similar terminology.
  `;
  server.registerTool(
    searchTool.name,
    {
      description: searchDocumentToolDescription,
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

  const getDocumentTool = createGetDocumentTool(apiClient, gitProvider);
  const getDocumentToolDescription = `
Retrieve the complete content of a specific documentation file from the project's Git
source of truth on the main branch.

Use this tool after semantic search when you need to inspect the authoritative document
rather than relying on an individual indexed chunk.

This tool is especially useful for resolving ambiguity, verifying terminology, understanding
the broader context around a search result, or obtaining details that may exist outside the
matched chunk.

IMPORTANT:
- Use the exact project and document path returned by search_documentation whenever possible.
- Treat the Git document as the authoritative source for the current main branch.
- Do not infer that two documents refer to the same system merely because they contain similar
  terminology.
- Inspect the document's headings and surrounding context before making a conclusion when
  the user's request is ambiguous.
- The indexed search result identifies relevant content; this tool verifies that interpretation
  against the complete document.
  `;
  server.registerTool(
    getDocumentTool.name,
    {
      description: getDocumentToolDescription,
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
  const apiClient = createApiClient(config.apiUrl);
  const gitProvider = createGitProvider(config.scmToken);

  const server = buildMcpServer(config, apiClient, gitProvider);

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