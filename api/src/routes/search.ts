import { Elysia } from "elysia";
import { z } from "zod";
import type { Sql } from "../db";
import type { EmbeddingClient } from "../embedding";

export const searchQuerySchema = z.object({
  q: z.string().min(1),
  project: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(10),
});

export const searchResultSchema = z.object({
  chunk: z.string(),
  path: z.string(),
  project: z.string(),
  similarity: z.number(),
});

export type SearchResult = z.infer<typeof searchResultSchema>;

export function createSearchRoute(sql: Sql, embeddingClient: EmbeddingClient) {
  return new Elysia({ name: "search" }).get(
    "/search",
    async ({ query }) => {
      const searchText = query.q.trim();
      const limit = query.limit;
      const projectFilter = query.project?.trim() || null;

      const queryEmbedding = await embeddingClient.embed(searchText);
      const embeddingVector = `[${queryEmbedding.join(",")}]`;

      return await sql<SearchResult[]>`
        SELECT
          c.text AS chunk,
          d.path AS path,
          p.name AS project,
          1 - (c.embedding <=> ${embeddingVector}::vector) AS similarity
        FROM chunks c
        JOIN documents d ON c.document_id = d.id
        JOIN projects p ON d.project_id = p.id
        WHERE c.embedding IS NOT NULL
          AND (${projectFilter}::text IS NULL OR p.name = ${projectFilter})
        ORDER BY c.embedding <=> ${embeddingVector}::vector
        LIMIT ${limit}
      `;
    },
    {
      query: searchQuerySchema,
      response: z.array(searchResultSchema),
    }
  );
}