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
  inputSchema: ReturnType<typeof z.object>;
  handler: (args: { query: string; project?: string; limit?: number }) => Promise<SearchResult[]>;
}

export function createSearchDocumentationTool(
  apiClient: ApiClient,
  defaultProject?: string
): SearchDocumentationTool {
  const inputSchema = defaultProject
    ? searchDocumentationInputSchema.omit({ project: true })
    : searchDocumentationInputSchema;

  return {
    name: "search_documentation",
    inputSchema,
    handler: async ({ query, limit, ...rest }) => {
      const args = inputSchema.parse({ query, limit, ...rest });
      const effectiveProject = defaultProject ?? (args as any).project as string;
      const results = await apiClient.search({ query: query.trim(), project: effectiveProject, limit: limit ?? 10 });
      return results;
    },
  };
}