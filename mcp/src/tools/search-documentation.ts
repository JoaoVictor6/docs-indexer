import { z } from "zod";
import type { ApiClient } from "../api-client";

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
  repositoryUrl: string | null;
}

export interface SearchDocumentationTool {
  name: "search_documentation";
  inputSchema: typeof searchDocumentationInputSchema;
  handler: (args: z.infer<typeof searchDocumentationInputSchema>) => Promise<SearchResult[]>;
}

export function createSearchDocumentationTool(
  apiClient: ApiClient
): SearchDocumentationTool {
  return {
    name: "search_documentation",
    inputSchema: searchDocumentationInputSchema,
    handler: async ({ project, query, limit }) => {
      const results = await apiClient.search({ query: query.trim(), project, limit: limit ?? 10 });
      return results;
    },
  };
}