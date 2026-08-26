import { describe, it, expect, afterEach, mock } from "bun:test";
import { createGitProvider } from "./git";
import type { McpConfig } from "./config";

const originalFetch = globalThis.fetch;

describe("GitProvider (GitHub)", () => {
  const config: McpConfig = {
    databaseUrl: "postgres://localhost/db",
    openrouterApiKey: "sk-test",
    openrouterBaseUrl: "https://openrouter.ai/api/v1",
    embeddingModel: "openai/text-embedding-3-small",
    githubToken: "ghp-test",
    githubBaseUrl: "https://raw.githubusercontent.com",
  };

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("fetches a file from a GitHub https repository URL", async () => {
    const provider = createGitProvider(config);

    const fetchMock = mock(() =>
      Promise.resolve(new Response("# Authentication\n\nFull document content", {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      }))
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const content = await provider.getDocument(
      "https://github.com/acme/payments-docs.git",
      "main",
      "docs/authentication.md"
    );

    expect(content).toBe("# Authentication\n\nFull document content");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://raw.githubusercontent.com/acme/payments-docs/main/docs/authentication.md",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer ghp-test",
        }),
      })
    );
  });

  it("throws when the repository URL is not GitHub", async () => {
    const provider = createGitProvider(config);

    await expect(
      provider.getDocument("https://gitlab.com/acme/payments-docs.git", "main", "docs/auth.md")
    ).rejects.toThrow("Only GitHub repositories are supported");
  });

  it("throws when the fetch returns non-2xx", async () => {
    const provider = createGitProvider(config);

    globalThis.fetch = mock(() =>
      Promise.resolve(new Response("Not Found", { status: 404 }))
    ) as unknown as typeof fetch;

    await expect(
      provider.getDocument("https://github.com/acme/payments-docs.git", "main", "docs/missing.md")
    ).rejects.toThrow("404");
  });
});
