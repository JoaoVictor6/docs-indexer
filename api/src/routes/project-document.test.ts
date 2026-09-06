import { describe, it, expect, mock, beforeEach } from "bun:test";
import { Elysia } from "elysia";
import { createProjectDocumentRoute } from "./project-document";
import type { Sql } from "../db";

function createMockSql(rows: unknown[]) {
  const sqlMock = mock(async (_strings: TemplateStringsArray, ..._values: unknown[]) => rows) as unknown as Sql;
  return sqlMock as unknown as Sql;
}

describe("GET /projects/:name/document", () => {
  it("returns project metadata when project and document exist", async () => {
    const sql = createMockSql([
      {
        project: "my-project",
        repositoryUrl: "https://github.com/acme/docs.git",
        branch: "main",
        commitSha: "abc123",
      },
    ]);
    const route = createProjectDocumentRoute(sql);
    const app = new Elysia().use(route) as unknown as Elysia;

    const response = await app.handle(
      new Request("http://localhost/projects/my-project/document?path=docs/auth.md")
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      project: "my-project",
      path: "docs/auth.md",
      repositoryUrl: "https://github.com/acme/docs.git",
      branch: "main",
      commitSha: "abc123",
    });
  });

  it("returns 404 when project does not exist", async () => {
    const sql = createMockSql([]);
    const route = createProjectDocumentRoute(sql);
    const app = new Elysia().use(route) as unknown as Elysia;

    const response = await app.handle(
      new Request("http://localhost/projects/nonexistent/document?path=docs/auth.md")
    );

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error).toContain("not found");
  });

  it("returns 200 with repositoryUrl: null when repository_url is NULL", async () => {
    const sql = createMockSql([
      {
        project: "my-project",
        repositoryUrl: null,
        branch: "main",
        commitSha: null,
      },
    ]);
    const route = createProjectDocumentRoute(sql);
    const app = new Elysia().use(route) as unknown as Elysia;

    const response = await app.handle(
      new Request("http://localhost/projects/my-project/document?path=docs/auth.md")
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.repositoryUrl).toBeNull();
  });

  it("returns 422 when path query param is missing", async () => {
    const sql = createMockSql([]);
    const route = createProjectDocumentRoute(sql);
    const app = new Elysia().use(route) as unknown as Elysia;

    const response = await app.handle(
      new Request("http://localhost/projects/my-project/document")
    );

    expect(response.status).toBe(422);
  });
});