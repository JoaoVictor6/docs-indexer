import { Counter, Gauge, Histogram, Registry } from "prom-client";
import type { Sql } from "./db";

export const domainRegistry = new Registry();

export const dbQueriesTotal = new Counter({
  name: "docs_indexer_db_queries_total",
  help: "Total number of database queries executed.",
  registers: [domainRegistry],
});

export const dbQueryDurationSeconds = new Histogram({
  name: "docs_indexer_db_query_duration_seconds",
  help: "Duration of database queries in seconds.",
  registers: [domainRegistry],
});

export const dbSizeBytes = new Gauge({
  name: "docs_indexer_db_size_bytes",
  help: "Size of the database in bytes.",
  registers: [domainRegistry],
});

export const documents = new Gauge({
  name: "docs_indexer_documents",
  help: "Number of indexed documents.",
  registers: [domainRegistry],
});

export const chunks = new Gauge({
  name: "docs_indexer_chunks",
  help: "Number of indexed chunks.",
  registers: [domainRegistry],
});

export const embeddingRequestsTotal = new Counter({
  name: "docs_indexer_embedding_requests_total",
  help: "Total number of embedding requests.",
  labelNames: ["provider", "model"],
  registers: [domainRegistry],
});

export const embeddingDurationSeconds = new Histogram({
  name: "docs_indexer_embedding_duration_seconds",
  help: "Duration of embedding requests in seconds.",
  labelNames: ["provider", "model"],
  registers: [domainRegistry],
});

export const httpRequestsTotal = new Counter({
  name: "docs_indexer_http_requests_total",
  help: "Total number of HTTP requests.",
  labelNames: ["method", "path", "status", "service", "source"],
  registers: [domainRegistry],
});

export const httpRequestDurationSeconds = new Histogram({
  name: "docs_indexer_http_request_duration_seconds",
  help: "Duration of HTTP requests in seconds.",
  labelNames: ["method", "path", "status", "service", "source"],
  registers: [domainRegistry],
});

const httpTimers = new WeakMap<Request, number>();

export function startHttpTimer(ctx: { request: Request }): void {
  if (!ctx.request) return;
  httpTimers.set(ctx.request, process.hrtime.bigint());
}

export function recordHttpMetric(
  ctx: { request: Request; route?: string; path?: string; set: { status?: number } },
  status: number
): void {
  const { request } = ctx;
  const path = (ctx.route ?? ctx.path ?? new URL(request.url).pathname).replace(
    /:\d+([/?]|$)/g,
    "/:id$1"
  );
  const defaults = {
    method: request.method.toUpperCase(),
    path,
    status: String(status ?? ctx.set.status ?? 0),
    service: "docs-indexer",
    source: request.headers.get("x-docs-indexer-source") ?? "http",
  };

  httpRequestsTotal.inc(defaults);

  const start = httpTimers.get(request);
  if (start !== undefined) {
    const durationSeconds =
      Number(process.hrtime.bigint() - start) / 1_000_000_000;
    httpRequestDurationSeconds.observe(defaults, durationSeconds);
  }
}

export function domainMetricsText(): Promise<string> {
  return domainRegistry.metrics();
}

export function startDbCollector(sql: Sql, intervalMs: number): () => void {
  async function collect(): Promise<void> {
    try {
      const [sizeRow] = await sql`SELECT pg_database_size(current_database()) AS size`;
      dbSizeBytes.set(Number(sizeRow?.size ?? 0));

      const [documentsRow] = await sql`SELECT count(*) AS n FROM documents`;
      documents.set(Number(documentsRow?.n ?? 0));

      const [chunksRow] = await sql`SELECT count(*) AS n FROM chunks`;
      chunks.set(Number(chunksRow?.n ?? 0));
    } catch (err) {
      console.error("db collector failed", err);
    }
  }

  void collect();
  const interval = setInterval(() => void collect(), intervalMs);

  return () => clearInterval(interval);
}
