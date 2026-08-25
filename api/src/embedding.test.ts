import { describe, it, expect, mock } from "bun:test";
import { createEmbeddingClient } from "./embedding";
import type { AppConfig } from "./config";

describe("EmbeddingClient", () => {
  const config: AppConfig = {
    databaseUrl: "postgres://localhost/db",
    openrouterApiKey: "sk-test",
    openrouterBaseUrl: "https://openrouter.ai/api/v1",
    embeddingModel: "openai/text-embedding-3-small",
    port: 3000,
  };

  it("calls OpenRouter and returns an embedding vector", async () => {
    const client = createEmbeddingClient(config);

    const fetchMock = mock(() =>
      Promise.resolve(new Response(
        JSON.stringify({ data: [{ embedding: [0.1, 0.2, 0.3] }] }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      ))
    );
    globalThis.fetch = fetchMock;

    const embedding = await client.embed("hello world");
    expect(embedding).toEqual([0.1, 0.2, 0.3]);

    expect(fetchMock).toHaveBeenCalledWith(
      "https://openrouter.ai/api/v1/embeddings",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer sk-test",
          "Content-Type": "application/json",
        }),
      })
    );
  });

  it("throws when OpenRouter returns a non-2xx status", async () => {
    const client = createEmbeddingClient(config);

    globalThis.fetch = mock(() =>
      Promise.resolve(new Response("unauthorized", { status: 401 }))
    );

    await expect(client.embed("hello")).rejects.toThrow("OpenRouter returned 401");
  });

  it("throws when OpenRouter returns no embeddings", async () => {
    const client = createEmbeddingClient(config);

    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(
        JSON.stringify({ data: [] }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      ))
    );

    await expect(client.embed("hello")).rejects.toThrow("no embeddings");
  });
});
