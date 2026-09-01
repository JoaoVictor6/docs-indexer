import { describe, it, expect, afterEach, mock } from "bun:test";
import { createApiClient } from "./api-client";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch as typeof fetch;
});

describe("createApiClient", () => {
  describe("getDocumentMetadata", () => {
    it("encodes dots in project name path segment", async () => {
      const fetchMock = mock(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              project: "compras-e.doc",
              path: "docs/auth.md",
              repositoryUrl: "https://github.com/example/repo",
              branch: "main",
              commitSha: "abc123",
            }),
            { status: 200 }
          )
        )
      );
      globalThis.fetch = fetchMock as unknown as typeof fetch;

      const client = createApiClient("http://localhost:3000");
      await client.getDocumentMetadata("compras-e.doc", "docs/auth.md");

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const urlCalled = fetchMock.mock.calls[0][0] as string;
      expect(urlCalled).toContain("/projects/compras-e%2Edoc/document");
      expect(urlCalled).not.toContain("/projects/compras-e.doc/document");
    });

    it("leaves normal characters unencoded", async () => {
      const fetchMock = mock(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              project: "payments",
              path: "docs/auth.md",
              repositoryUrl: "https://github.com/example/repo",
              branch: "main",
              commitSha: "abc123",
            }),
            { status: 200 }
          )
        )
      );
      globalThis.fetch = fetchMock as unknown as typeof fetch;

      const client = createApiClient("http://localhost:3000");
      await client.getDocumentMetadata("payments", "docs/auth.md");

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const urlCalled = fetchMock.mock.calls[0][0] as string;
      expect(urlCalled).toContain("/projects/payments/document");
    });

    it("returns null on 404", async () => {
      const fetchMock = mock(() =>
        Promise.resolve(new Response("Not found", { status: 404 }))
      );
      globalThis.fetch = fetchMock as unknown as typeof fetch;

      const client = createApiClient("http://localhost:3000");
      const result = await client.getDocumentMetadata("unknown-project", "docs/x.md");

      expect(result).toBeNull();
    });

    it("throws on non-404 error", async () => {
      const fetchMock = mock(() =>
        Promise.resolve(new Response("Internal error", { status: 500 }))
      );
      globalThis.fetch = fetchMock as unknown as typeof fetch;

      const client = createApiClient("http://localhost:3000");

      await expect(
        client.getDocumentMetadata("bad-project", "docs/x.md")
      ).rejects.toThrow("API document returned 500");
    });
  });

  describe("search", () => {
    it("encodes query parameters correctly", async () => {
      const fetchMock = mock(() =>
        Promise.resolve(
          new Response(
            JSON.stringify([
              {
                chunk: "some text",
                path: "docs/a.md",
                project: "my-project",
                similarity: 0.9,
                repositoryUrl: null,
                title: null,
                heading: null,
              },
            ]),
            { status: 200 }
          )
        )
      );
      globalThis.fetch = fetchMock as unknown as typeof fetch;

      const client = createApiClient("http://localhost:3000");
      await client.search({ query: "hello world", project: "my-project", limit: 5 });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const urlCalled = fetchMock.mock.calls[0][0] as string;
      expect(urlCalled).toContain("?q=hello+world&project=my-project&limit=5");
    });
  });
});