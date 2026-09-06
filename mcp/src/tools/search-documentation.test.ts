import { describe, it, expect, mock } from "bun:test";
import { createSearchDocumentationTool } from "./search-documentation";
import type { ApiClient, ApiSearchResult } from "../api-client";

function createMockApiClient(rows: ApiSearchResult[]): ApiClient {
  return {
    search: mock(async () => rows),
    getDocumentMetadata: mock(async () => null),
  };
}

describe("search_documentation tool", () => {
  it("returns ranked results with chunk/path/project/heading/similarity", async () => {
    const rows: ApiSearchResult[] = [
      {
        title: "Authentication Architecture",
        path: "docs/auth.md",
        project: "payments",
        heading: "Authentication",
        chunk: "All API calls must include a bearer token...",
        similarity: 0.92,
        repositoryUrl: "https://github.com/acme/docs.git",
      },
    ];
    const apiClient = createMockApiClient(rows);
    const tool = createSearchDocumentationTool(apiClient, undefined);

    const results = await tool.handler({ project: "payments", query: "OAuth authentication", limit: 10 });

    expect(results).toBeArray();
    expect(results.length).toBe(1);
    expect(results[0]).toMatchObject({
      title: "Authentication Architecture",
      path: "docs/auth.md",
      project: "payments",
      heading: "Authentication",
      similarity: 0.92,
    });
    expect(results[0].chunk).toBe("All API calls must include a bearer token...");
    expect(results[0].repositoryUrl).toBe("https://github.com/acme/docs.git");
  });

  it("passes the query, project, and limit to the API client", async () => {
    const apiClient = createMockApiClient([]);
    const tool = createSearchDocumentationTool(apiClient, undefined);

    await tool.handler({ project: "payments", query: "OAuth", limit: 5 });

    expect(apiClient.search).toHaveBeenCalledWith({ query: "OAuth", project: "payments", limit: 5 });
  });

  it("validates that project and query are required strings", () => {
    const apiClient = createMockApiClient([]);
    const tool = createSearchDocumentationTool(apiClient, undefined);

    const parsed = tool.inputSchema.safeParse({ query: "OAuth", limit: 5 });
    expect(parsed.success).toBe(false);
  });

  it("omits project from schema when defaultProject is set", () => {
    const apiClient = createMockApiClient([]);
    const tool = createSearchDocumentationTool(apiClient, "default-proj");

    const withoutProject = tool.inputSchema.safeParse({ query: "test" });
    expect(withoutProject.success).toBe(true);

    const withProject = tool.inputSchema.safeParse({ project: "other", query: "test" });
    expect(withProject.success).toBe(true);
    expect((withProject as any).data).not.toHaveProperty("project");
  });

  it("handler uses defaultProject when set", async () => {
    const apiClient = createMockApiClient([]);
    const tool = createSearchDocumentationTool(apiClient, "my-project");

    await tool.handler({ query: "test", limit: 5 });

    expect(apiClient.search).toHaveBeenCalledWith({ query: "test", project: "my-project", limit: 5 });
  });
});