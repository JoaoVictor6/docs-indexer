import { describe, it, expect, afterEach, mock } from "bun:test";
import { createEmbeddingClient } from "./embedding";
import type { AppConfig } from "./config";
import { embeddingDurationSeconds, embeddingRequestsTotal } from "./metrics";

const originalFetch = globalThis.fetch;

describe("EmbeddingClient", () => {
  const config: AppConfig = {
    databaseUrl: "postgres://localhost/db",
    openrouterApiKey: "sk-test",
    openrouterBaseUrl: "https://openrouter.ai/api/v1",
    embeddingModel: "openai/text-embedding-3-small",
    port: 3000,
    dbCollectorIntervalMs: 60000,
  };

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("calls OpenRouter and returns an embedding vector", async () => {
    const client = createEmbeddingClient(config);

    const fetchMock = mock(() =>
      Promise.resolve(new Response(
        JSON.stringify({ data: [{ embedding: [0.1, 0.2, 0.3] }] }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      ))
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

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
        body: JSON.stringify({ model: "openai/text-embedding-3-small", input: ["hello world"] }),
      })
    );
  });

  it("throws when OpenRouter returns a non-2xx status", async () => {
    const client = createEmbeddingClient(config);

    globalThis.fetch = mock(() =>
      Promise.resolve(new Response("unauthorized", { status: 401 }))
    ) as unknown as typeof fetch;

    await expect(client.embed("hello")).rejects.toThrow("OpenRouter returned 401");
  });

  it("throws when OpenRouter returns no embeddings", async () => {
    const client = createEmbeddingClient(config);

    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(
        JSON.stringify({ data: [] }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      ))
    ) as unknown as typeof fetch;

    await expect(client.embed("hello")).rejects.toThrow("no embeddings");
  });

  it("increments the embedding request counter with provider and model labels", async () => {
    const client = createEmbeddingClient(config);

    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(
        JSON.stringify({ data: [{ embedding: [0.1, 0.2, 0.3] }] }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      ))
    ) as unknown as typeof fetch;

    await client.embed("hello world");

    const snapshot = await embeddingRequestsTotal.get();
    const entry = snapshot.values.find(
      (v) => v.labels.provider === "openrouter" && v.labels.model === config.embeddingModel
    );
    expect(entry).toBeDefined();
    expect(entry!.value).toBeGreaterThan(0);
  });

  it("observes duration even when embed throws", async () => {
    const client = createEmbeddingClient(config);

    globalThis.fetch = mock(() =>
      Promise.resolve(new Response("unauthorized", { status: 401 }))
    ) as unknown as typeof fetch;

    const before = await embeddingDurationSeconds.get();
    const beforeCount =
      before.values.find(
        (v) => v.metricName === "docs_indexer_embedding_duration_seconds_count"
      )?.value ?? 0;

    await expect(client.embed("hello")).rejects.toThrow("OpenRouter returned 401");

    const after = await embeddingDurationSeconds.get();
    const afterCount =
      after.values.find(
        (v) => v.metricName === "docs_indexer_embedding_duration_seconds_count"
      )?.value ?? 0;

    expect(afterCount).toBe(beforeCount + 1);
  });
});
