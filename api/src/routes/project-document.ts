import { Elysia } from "elysia";
import { z } from "zod";
import type { Sql } from "../db";

const documentParamsSchema = z.object({ name: z.string().min(1) });
const documentQuerySchema = z.object({ path: z.string().min(1) });

const documentResponseSchema = z.object({
  project: z.string(),
  path: z.string(),
  repositoryUrl: z.string().nullable(),
  branch: z.string(),
  commitSha: z.string().nullable(),
});

export function createProjectDocumentRoute(sql: Sql) {
  return new Elysia({ name: "project-document" }).get(
    "/projects/:name/document",
    async ({ params, query }) => {
      const rows = await sql`
        SELECT
          p.name AS project,
          p.repository_url AS "repositoryUrl",
          p.default_branch AS branch,
          d.commit_sha AS "commitSha"
        FROM projects p
        LEFT JOIN documents d ON d.project_id = p.id AND d.path = ${query.path}
        WHERE p.name = ${params.name}
      `;

      if (rows.length === 0) {
        return new Response(
          JSON.stringify({ error: `Project '${params.name}' not found` }),
          { status: 404, headers: { "Content-Type": "application/json" } }
        );
      }

      return {
        project: params.name,
        path: query.path,
        repositoryUrl: rows[0].repositoryUrl,
        branch: rows[0].branch,
        commitSha: rows[0].commitSha,
      };
    },
    {
      params: documentParamsSchema,
      query: documentQuerySchema,
      response: z.union([
        documentResponseSchema,
        z.object({ error: z.string() }),
      ]),
    }
  );
}