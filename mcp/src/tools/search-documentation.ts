import { z } from "zod";
import type { Sql } from "../db";
import type { EmbeddingClient } from "../embedding";

export const searchDocumentationInputSchema = z.object({
  project: z.string().min(1).describe("Project name to search within"),
  query: z.string().min(1).describe("Natural-language search query"),
  limit: z.number().int().min(1).max(100).optional().describe("Max results, defaults to 10"),
});

export interface SearchResult {
  title: string | null;
  path: string;
  project: string;
  heading: string | null;
  chunk: string;
  similarity: number;
}

export interface SearchDocumentationTool {
  name: "search_documentation";
  inputSchema: typeof searchDocumentationInputSchema;
  handler: (args: z.infer<typeof searchDocumentationInputSchema>) => Promise<SearchResult[]>;
}

export function createSearchDocumentationTool(
  sql: Sql,
  embeddingClient: EmbeddingClient
): SearchDocumentationTool {
  return {
    name: "search_documentation",
    inputSchema: searchDocumentationInputSchema,
    handler: async ({ project, query, limit }) => {
      const searchText = query.trim();
      const resultLimit = limit ?? 10;

      const queryEmbedding = await embeddingClient.embed(searchText);
      const embeddingVector = `[${queryEmbedding.join(",")}]`;

      return await sql<SearchResult[]>`
        SELECT
          d.title AS title,
          d.path AS path,
          p.name AS project,
          c.heading AS heading,
          c.text AS chunk,
          1 - (c.embedding <=> ${embeddingVector}::vector) AS similarity
        FROM chunks c
        JOIN documents d ON c.document_id = d.id
        JOIN projects p ON d.project_id = p.id
        WHERE c.embedding IS NOT NULL
          AND p.name = ${project}
        ORDER BY c.embedding <=> ${embeddingVector}::vector
        LIMIT ${resultLimit}
      `;
    },
  };
}
