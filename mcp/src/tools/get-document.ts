import { z } from "zod";
import type { ApiClient } from "../api-client";
import type { GitProvider } from "../git";

export const getDocumentInputSchema = z.object({
  project: z.string().min(1).describe("Project name"),
  path: z.string().min(1).describe("Document path within the repository, e.g. docs/authentication.md"),
});

export interface GetDocumentResult {
  project: string;
  path: string;
  commitSha: string | null;
  branch: string;
  content: string;
  sourceUrl: string;
}

export interface GetDocumentTool {
  name: "get_document";
  inputSchema: typeof getDocumentInputSchema;
  handler: (args: z.infer<typeof getDocumentInputSchema>) => Promise<GetDocumentResult>;
}

export function createGetDocumentTool(apiClient: ApiClient, gitProvider: GitProvider): GetDocumentTool {
  return {
    name: "get_document",
    inputSchema: getDocumentInputSchema,
    handler: async ({ project, path }) => {
      const metadata = await apiClient.getDocumentMetadata(project, path);
      if (!metadata) {
        throw new Error(`Project '${project}' not found`);
      }
      if (!metadata.repositoryUrl) {
        throw new Error(`repository_url is not set for project '${project}'`);
      }
      const content = await gitProvider.getDocument(metadata.repositoryUrl, metadata.branch, path);

      return {
        project,
        path,
        commitSha: metadata.commitSha,
        branch: metadata.branch,
        content,
        sourceUrl: metadata.repositoryUrl.replace(/\.git$/, ""),
      };
    },
  };
}