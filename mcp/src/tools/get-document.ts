import { z } from "zod";
import type { Sql } from "../db";
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

interface ProjectRow {
  repositoryUrl: string | null;
  branch: string;
  commitSha: string | null;
}

export function createGetDocumentTool(sql: Sql, gitProvider: GitProvider): GetDocumentTool {
  return {
    name: "get_document",
    inputSchema: getDocumentInputSchema,
    handler: async ({ project, path }) => {
      const rows = await sql<ProjectRow[]>`
        SELECT
          p.repository_url AS "repositoryUrl",
          p.default_branch AS branch,
          d.commit_sha AS "commitSha"
        FROM projects p
        LEFT JOIN documents d ON d.project_id = p.id AND d.path = ${path}
        WHERE p.name = ${project}
      `;

      if (rows.length === 0) {
        throw new Error(`Project '${project}' not found`);
      }

      const row = rows[0];
      if (!row.repositoryUrl) {
        throw new Error(`repository_url is not set for project '${project}'`);
      }

      const content = await gitProvider.getDocument(row.repositoryUrl, row.branch, path);

      return {
        project,
        path,
        commitSha: row.commitSha,
        branch: row.branch,
        content,
        sourceUrl: row.repositoryUrl.replace(/\.git$/, ""),
      };
    },
  };
}
