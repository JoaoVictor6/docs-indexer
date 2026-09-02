import { describe, it, expect, mock, spyOn } from "bun:test";
import { createGetDocumentTool } from "./get-document";
import type { ApiClient, DocumentMetadata } from "../api-client";
import type { GitProvider } from "../git";

function mockBunFile(exists: boolean, content: string) {
  const fileMock = {
    exists: mock(async () => exists),
    text: mock(async () => content),
  };
  spyOn(Bun as any, "file").mockImplementation(() => fileMock as any);
  return fileMock;
}

function createMocks(metadata: DocumentMetadata | null, gitContent: string, localRepos: Record<string, string> = {}) {
  const gitProvider: GitProvider = {
    getDocument: mock(async () => gitContent),
  };
  const apiClient: ApiClient = {
    getDocumentMetadata: mock(async () => metadata),
    search: mock(async () => []),
  };
  return { apiClient, gitProvider, localRepos };
}

describe("get_document tool", () => {
  it("resolves the project, fetches from git, and returns content + metadata", async () => {
    const { apiClient, gitProvider, localRepos } = createMocks(
      {
        project: "payments",
        path: "docs/authentication.md",
        repositoryUrl: "https://github.com/acme/payments-docs.git",
        branch: "main",
        commitSha: "abc123",
      },
      "# Full doc content"
    );
    const tool = createGetDocumentTool(apiClient, gitProvider, localRepos, undefined);

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
    const { apiClient, gitProvider, localRepos } = createMocks(null, "");
    const tool = createGetDocumentTool(apiClient, gitProvider, localRepos, undefined);

    await expect(
      tool.handler({ project: "unknown", path: "docs/a.md" })
    ).rejects.toThrow("Project 'unknown' not found");
  });

  it("throws when the project has no repository_url set", async () => {
    const { apiClient, gitProvider, localRepos } = createMocks(
      {
        project: "payments",
        path: "docs/a.md",
        repositoryUrl: null,
        branch: "main",
        commitSha: null,
      },
      ""
    );
    const tool = createGetDocumentTool(apiClient, gitProvider, localRepos, undefined);

    await expect(
      tool.handler({ project: "payments", path: "docs/a.md" })
    ).rejects.toThrow("repository_url is not set for project 'payments'");
  });

  it("serves file from local clone when project is in localRepos", async () => {
    const { apiClient, gitProvider, localRepos } = createMocks(
      {
        project: "payments",
        path: "docs/authentication.md",
        repositoryUrl: "https://github.com/acme/payments-docs.git",
        branch: "main",
        commitSha: "abc123",
      },
      "# Full doc content",
      { payments: "/local/payments-docs" }
    );
    mockBunFile(true, "# Local file content");
    const tool = createGetDocumentTool(apiClient, gitProvider, localRepos, undefined);

    const result = await tool.handler({
      project: "payments",
      path: "docs/authentication.md",
    });

    expect(apiClient.getDocumentMetadata).not.toHaveBeenCalled();
    expect(gitProvider.getDocument).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      project: "payments",
      path: "docs/authentication.md",
      commitSha: null,
      branch: "main",
      content: "# Local file content",
      sourceUrl: "/local/payments-docs/docs/authentication.md",
    });
  });

  it("falls through to HTTP when local file does not exist", async () => {
    const { apiClient, gitProvider, localRepos } = createMocks(
      {
        project: "payments",
        path: "docs/authentication.md",
        repositoryUrl: "https://github.com/acme/payments-docs.git",
        branch: "main",
        commitSha: "abc123",
      },
      "# Full doc content",
      { payments: "/local/payments-docs" }
    );
    mockBunFile(false, "");
    const tool = createGetDocumentTool(apiClient, gitProvider, localRepos, undefined);

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

  it("omits project from schema when defaultProject is set", () => {
    const { apiClient, gitProvider, localRepos } = createMocks(null, "");
    const tool = createGetDocumentTool(apiClient, gitProvider, {}, "default-proj");

    const withoutProject = tool.inputSchema.safeParse({ path: "docs/a.md" });
    expect(withoutProject.success).toBe(true);

    const withProject = tool.inputSchema.safeParse({ project: "other", path: "docs/a.md" });
    expect(withProject.success).toBe(true);
    expect((withProject as any).data).not.toHaveProperty("project");
  });

  it("handler uses defaultProject when set", async () => {
    const { apiClient, gitProvider, localRepos } = createMocks(
      {
        project: "default-proj",
        path: "docs/a.md",
        repositoryUrl: null,
        branch: "main",
        commitSha: null,
      },
      "",
      { "default-proj": "/local/default-docs" }
    );
    mockBunFile(true, "# Local content");
    const tool = createGetDocumentTool(apiClient, gitProvider, localRepos, "default-proj");

    const result = await tool.handler({ path: "docs/a.md" });

    expect(apiClient.getDocumentMetadata).not.toHaveBeenCalled();
    expect(result.project).toBe("default-proj");
  });
});