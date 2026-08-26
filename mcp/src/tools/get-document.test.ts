import { describe, it, expect, mock } from "bun:test";
import { createGetDocumentTool } from "./get-document";
import type { Sql } from "../db";
import type { GitProvider } from "../git";

function createMockSql(rows: unknown[]): Sql {
  return mock(async (_strings: TemplateStringsArray, ..._values: unknown[]) => rows) as unknown as Sql;
}

function createMockGitProvider(content: string): GitProvider {
  return {
    getDocument: mock(async (_repositoryUrl: string, _branch: string, _path: string) => content),
  };
}

describe("get_document tool", () => {
  it("resolves the project, fetches from git, and returns content + metadata", async () => {
    const sql = createMockSql([
      {
        repositoryUrl: "https://github.com/acme/payments-docs.git",
        branch: "main",
        commitSha: "abc123",
      },
    ]);
    const gitProvider = createMockGitProvider("# Full doc content");
    const tool = createGetDocumentTool(sql, gitProvider);

    const result = await tool.handler({
      project: "payments",
      path: "docs/authentication.md",
    });

    expect(result).toMatchObject({
      project: "payments",
      path: "docs/authentication.md",
      commitSha: "abc123",
      branch: "main",
      content: "# Full doc content",
      sourceUrl: "https://github.com/acme/payments-docs",
    });
    expect(gitProvider.getDocument).toHaveBeenCalledWith(
      "https://github.com/acme/payments-docs.git",
      "main",
      "docs/authentication.md"
    );
  });

  it("throws when the project is not found", async () => {
    const sql = createMockSql([]);
    const tool = createGetDocumentTool(sql, createMockGitProvider(""));

    await expect(
      tool.handler({ project: "unknown", path: "docs/a.md" })
    ).rejects.toThrow("Project 'unknown' not found");
  });

  it("throws when the project has no repository_url set", async () => {
    const sql = createMockSql([{ repositoryUrl: null, branch: "main", commitSha: null }]);
    const tool = createGetDocumentTool(sql, createMockGitProvider(""));

    await expect(
      tool.handler({ project: "payments", path: "docs/a.md" })
    ).rejects.toThrow("repository_url is not set for project 'payments'");
  });
});
