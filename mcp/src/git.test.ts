import { describe, it, expect, afterEach, mock } from "bun:test";
import { createGitProvider, parseRepositoryUrl, BitbucketGitProvider } from "./git";

const originalFetch = globalThis.fetch;

describe("parseRepositoryUrl", () => {
  it("parses a GitHub HTTPS URL with .git suffix", () => {
    const result = parseRepositoryUrl("https://github.com/acme/payments-docs.git");
    expect(result).toEqual({ provider: "github", owner: "acme", repo: "payments-docs" });
  });

  it("parses a GitHub HTTPS URL without .git suffix", () => {
    const result = parseRepositoryUrl("https://github.com/acme/payments-docs");
    expect(result).toEqual({ provider: "github", owner: "acme", repo: "payments-docs" });
  });

  it("parses a GitHub HTTPS URL with trailing slash", () => {
    const result = parseRepositoryUrl("https://github.com/acme/payments-docs/");
    expect(result).toEqual({ provider: "github", owner: "acme", repo: "payments-docs" });
  });

  it("parses a Bitbucket HTTPS URL with .git suffix", () => {
    const result = parseRepositoryUrl("https://bitbucket.org/acme/payments-docs.git");
    expect(result).toEqual({ provider: "bitbucket", owner: "acme", repo: "payments-docs" });
  });

  it("parses a Bitbucket HTTPS URL without .git suffix", () => {
    const result = parseRepositoryUrl("https://bitbucket.org/acme/payments-docs");
    expect(result).toEqual({ provider: "bitbucket", owner: "acme", repo: "payments-docs" });
  });

  it("parses a Bitbucket HTTPS URL with trailing slash", () => {
    const result = parseRepositoryUrl("https://bitbucket.org/acme/payments-docs/");
    expect(result).toEqual({ provider: "bitbucket", owner: "acme", repo: "payments-docs" });
  });

  it("parses a GitHub SSH URL with .git suffix", () => {
    const result = parseRepositoryUrl("git@github.com:acme/payments-docs.git");
    expect(result).toEqual({ provider: "github", owner: "acme", repo: "payments-docs" });
  });

  it("parses a GitHub SSH URL without .git suffix", () => {
    const result = parseRepositoryUrl("git@github.com:acme/payments-docs");
    expect(result).toEqual({ provider: "github", owner: "acme", repo: "payments-docs" });
  });

  it("parses a Bitbucket SSH URL with .git suffix", () => {
    const result = parseRepositoryUrl("git@bitbucket.org:acme/payments-docs.git");
    expect(result).toEqual({ provider: "bitbucket", owner: "acme", repo: "payments-docs" });
  });

  it("parses a Bitbucket SSH URL without .git suffix", () => {
    const result = parseRepositoryUrl("git@bitbucket.org:acme/payments-docs");
    expect(result).toEqual({ provider: "bitbucket", owner: "acme", repo: "payments-docs" });
  });

  it("parses owners with hyphens and dots", () => {
    const result = parseRepositoryUrl("https://github.com/my-org.prefix/payments-docs.git");
    expect(result).toEqual({ provider: "github", owner: "my-org.prefix", repo: "payments-docs" });
  });

  it("throws for unsupported domain (gitlab)", () => {
    expect(() => parseRepositoryUrl("https://gitlab.com/acme/payments-docs.git")).toThrow(
      "Only github.com and bitbucket.org repositories are supported"
    );
  });

  it("throws for unsupported domain (custom)", () => {
    expect(() => parseRepositoryUrl("https://example.com/acme/payments-docs.git")).toThrow(
      "Only github.com and bitbucket.org repositories are supported"
    );
  });

  it("throws for invalid URL format (no owner/repo)", () => {
    expect(() => parseRepositoryUrl("https://github.com")).toThrow(
      "Only github.com and bitbucket.org repositories are supported"
    );
  });

  it("throws for empty string", () => {
    expect(() => parseRepositoryUrl("")).toThrow(
      "Only github.com and bitbucket.org repositories are supported"
    );
  });
});

describe("GitProvider (GitHub)", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("fetches a file from a GitHub https repository URL", async () => {
    const provider = createGitProvider("ghp-test");

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
          Authorization: "Basic Z2hwLXRlc3Q=",
        }),
      })
    );
  });

  it("throws when the repository URL is not GitHub (unsupported domain)", async () => {
    const provider = createGitProvider("ghp-test");

    await expect(
      provider.getDocument("https://gitlab.com/acme/payments-docs.git", "main", "docs/auth.md")
    ).rejects.toThrow("Only github.com and bitbucket.org repositories are supported");
  });

  it("routes Bitbucket URLs to BitbucketGitProvider", async () => {
    const provider = createGitProvider("bbp-test");

    const fetchMock = mock(() =>
      Promise.resolve(new Response("# Bitbucket docs", {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      }))
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const content = await provider.getDocument(
      "https://bitbucket.org/acme/payments-docs.git",
      "main",
      "docs/auth.md"
    );

    expect(content).toBe("# Bitbucket docs");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://bitbucket.org/acme/payments-docs/raw/main/docs/auth.md",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Basic YmJwLXRlc3Q=",
        }),
      })
    );
  });

  it("throws when the fetch returns non-2xx", async () => {
    const provider = createGitProvider("ghp-test");

    globalThis.fetch = mock(() =>
      Promise.resolve(new Response("Not Found", { status: 404 }))
    ) as unknown as typeof fetch;

    await expect(
      provider.getDocument("https://github.com/acme/payments-docs.git", "main", "docs/missing.md")
    ).rejects.toThrow("404");
  });
});

describe("createGitProvider factory dispatch", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("routes GitHub URL to GitHub provider (raw.githubusercontent.com)", async () => {
    const provider = createGitProvider("ghp-test");

    const fetchMock = mock(() =>
      Promise.resolve(new Response("# GitHub routed", {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      }))
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const content = await provider.getDocument(
      "https://github.com/acme/payments-docs.git",
      "main",
      "docs/readme.md"
    );

    expect(content).toBe("# GitHub routed");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://raw.githubusercontent.com/acme/payments-docs/main/docs/readme.md",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Basic Z2hwLXRlc3Q=",
        }),
      })
    );
  });

  it("routes Bitbucket URL to Bitbucket provider (bitbucket.org/.../raw/...)", async () => {
    const provider = createGitProvider("bbp-test");

    const fetchMock = mock(() =>
      Promise.resolve(new Response("# Bitbucket routed", {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      }))
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const content = await provider.getDocument(
      "https://bitbucket.org/acme/payments-docs.git",
      "main",
      "docs/readme.md"
    );

    expect(content).toBe("# Bitbucket routed");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://bitbucket.org/acme/payments-docs/raw/main/docs/readme.md",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Basic YmJwLXRlc3Q=",
        }),
      })
    );
  });

  it("throws for unknown domain listing github.com and bitbucket.org as supported", async () => {
    const provider = createGitProvider("token");

    await expect(
      provider.getDocument("https://gitlab.com/acme/payments-docs.git", "main", "docs/auth.md")
    ).rejects.toThrow("Only github.com and bitbucket.org repositories are supported");
  });

  it("throws for custom domain listing github.com and bitbucket.org", async () => {
    const provider = createGitProvider("token");

    await expect(
      provider.getDocument("https://example.com/acme/payments-docs.git", "main", "docs/auth.md")
    ).rejects.toThrow("Only github.com and bitbucket.org repositories are supported");
  });
});

describe("BitbucketGitProvider", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("fetches a file from a Bitbucket repository URL with Basic auth", async () => {
    const provider = new BitbucketGitProvider("bbp-test");

    const fetchMock = mock(() =>
      Promise.resolve(new Response("# Auth docs\n\nSample content", {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      }))
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const content = await provider.getDocument(
      "https://bitbucket.org/acme/payments-docs.git",
      "main",
      "docs/auth.md"
    );

    expect(content).toBe("# Auth docs\n\nSample content");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://bitbucket.org/acme/payments-docs/raw/main/docs/auth.md",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Basic YmJwLXRlc3Q=",
        }),
      })
    );
  });

  it("throws when the fetch returns non-2xx", async () => {
    const provider = new BitbucketGitProvider("bbp-test");

    globalThis.fetch = mock(() =>
      Promise.resolve(new Response("Not Found", { status: 404 }))
    ) as unknown as typeof fetch;

    await expect(
      provider.getDocument("https://bitbucket.org/acme/payments-docs.git", "main", "docs/missing.md")
    ).rejects.toThrow("Bitbucket returned 404");
  });

  it("throws when the repository URL is not a Bitbucket URL", async () => {
    const provider = new BitbucketGitProvider("bbp-test");

    await expect(
      provider.getDocument("https://github.com/acme/payments-docs.git", "main", "docs/auth.md")
    ).rejects.toThrow("Only Bitbucket repositories are supported");
  });
});
