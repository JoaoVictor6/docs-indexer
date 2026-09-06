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
  inputSchema: ReturnType<typeof z.object>;
  handler: (args: { path: string; project?: string }) => Promise<GetDocumentResult>;
}

export function createGetDocumentTool(
  apiClient: ApiClient,
  gitProvider: GitProvider,
  localRepos: Record<string, string>,
  defaultProject?: string
): GetDocumentTool {
  const inputSchema = defaultProject
    ? getDocumentInputSchema.omit({ project: true })
    : getDocumentInputSchema;

  return {
    name: "get_document",
    inputSchema,
    handler: async ({ path, ...rest }) => {
      const args = inputSchema.parse({ path, ...rest });
      const effectiveProject = defaultProject ?? (args as any).project as string;

      const localDir = localRepos[effectiveProject];
      if (localDir) {
        const localPath = `${localDir}/${path}`;
        const file = Bun.file(localPath);
        if (await file.exists()) {
          const content = await file.text();
          return {
            project: effectiveProject,
            path,
            commitSha: null,
            branch: "main",
            content,
            sourceUrl: localPath,
          };
        }
      }

      const metadata = await apiClient.getDocumentMetadata(effectiveProject, path);
      if (!metadata) {
        throw new Error(`Project '${effectiveProject}' not found`);
      }
      if (!metadata.repositoryUrl) {
        throw new Error(`repository_url is not set for project '${effectiveProject}'`);
      }
      const content = await gitProvider.getDocument(metadata.repositoryUrl, metadata.branch, path);

      return {
        project: effectiveProject,
        path,
        commitSha: metadata.commitSha,
        branch: metadata.branch,
        content,
        sourceUrl: metadata.repositoryUrl.replace(/\.git$/, ""),
      };
    },
  };
}