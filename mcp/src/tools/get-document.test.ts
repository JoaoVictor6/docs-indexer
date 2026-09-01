import { describe, it, expect, mock } from "bun:test";
import { createGetDocumentTool } from "./get-document";
import type { ApiClient, DocumentMetadata } from "../api-client";
import type { GitProvider } from "../git";

function createMocks(metadata: DocumentMetadata | null, gitContent: string) {
  const gitProvider: GitProvider = {
    getDocument: mock(async () => gitContent),
  };
  const apiClient: ApiClient = {
    getDocumentMetadata: mock(async () => metadata),
    search: mock(async () => []),
  };
  return { apiClient, gitProvider };
}

describe("get_document tool", () => {
  it("resolves the project, fetches from git, and returns content + metadata", async () => {
    const { apiClient, gitProvider } = createMocks(
      {
        project: "payments",
        path: "docs/authentication.md",
        repositoryUrl: "https://github.com/acme/payments-docs.git",
        branch: "main",
        commitSha: "abc123",
      },
      "# Full doc content"
    );
    const tool = createGetDocumentTool(apiClient, gitProvider);

    const result = await tool.handler({
      project: "payments",
      path: "docs/authentication.md",
    });

    expect(apiClient.getDocumentMetadata).toHaveBeenCalledWith("payments", "docs/authentication.md");
    expect(gitProvider.getDocument).toHaveBeenCalledWith(
      "https://github.com/acme/payments-docs.git",
      "main",
      "docs/authentication.md"
    );
    expect(result).toMatchObject({
      project: "payments",
      path: "docs/authentication.md",
      commitSha: "abc123",
      branch: "main",
      content: "# Full doc content",
      sourceUrl: "https://github.com/acme/payments-docs",
    });
  });

  it("throws when the project is not found", async () => {
    const { apiClient, gitProvider } = createMocks(null, "");
    const tool = createGetDocumentTool(apiClient, gitProvider);

    await expect(
      tool.handler({ project: "unknown", path: "docs/a.md" })
    ).rejects.toThrow("Project 'unknown' not found");
  });

  it("throws when the project has no repository_url set", async () => {
    const { apiClient, gitProvider } = createMocks(
      {
        project: "payments",
        path: "docs/a.md",
        repositoryUrl: null,
        branch: "main",
        commitSha: null,
      },
      ""
    );
    const tool = createGetDocumentTool(apiClient, gitProvider);

    await expect(
      tool.handler({ project: "payments", path: "docs/a.md" })
    ).rejects.toThrow("repository_url is not set for project 'payments'");
  });
});