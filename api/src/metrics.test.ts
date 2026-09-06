import { describe, it, expect, mock } from "bun:test";
import {
  chunks,
  dbSizeBytes,
  documents,
  domainMetricsText,
  startDbCollector,
} from "./metrics";
import type { Sql } from "./db";

function createCollectorSql() {
  const handler = mock(async (strings: TemplateStringsArray) => {
    const query = strings.join("?");
    if (query.includes("pg_database_size")) return [{ size: "123456" }];
    if (query.includes("FROM documents")) return [{ n: "42" }];
    if (query.includes("FROM chunks")) return [{ n: "7" }];
    return [];
  });
  return { sql: handler as unknown as Sql, handler };
}

describe("domainMetricsText", () => {
  it("contains the db query and embedding request metric names", async () => {
    const text = await domainMetricsText();
    expect(text).toContain("docs_indexer_db_queries_total");
    expect(text).toContain("docs_indexer_embedding_requests_total");
  });
});

describe("startDbCollector", () => {
  it("sets the db_size_bytes, documents, and chunks gauges", async () => {
    const { sql } = createCollectorSql();
    const stop = startDbCollector(sql, 60000);

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect((await dbSizeBytes.get()).values[0].value).toBe(123456);
    expect((await documents.get()).values[0].value).toBe(42);
    expect((await chunks.get()).values[0].value).toBe(7);

    stop();
  });

  it("returns a stop function that prevents further collection", async () => {
    const { sql, handler } = createCollectorSql();
    const stop = startDbCollector(sql, 10);

    await new Promise((resolve) => setTimeout(resolve, 0));
    stop();

    const callsAfterStop = handler.mock.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(handler.mock.calls.length).toBe(callsAfterStop);
  });
});
