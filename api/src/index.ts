import { Elysia } from "elysia";
import { openapi } from "@elysia/openapi";
import { getConfig } from "./config";
import { createPool, type Sql } from "./db";
import { createEmbeddingClient, type EmbeddingClient } from "./embedding";
import { createSearchRoute } from "./routes/search";
import { createProjectDocumentRoute } from "./routes/project-document";
import { authPlugin } from "./auth";
import {
  domainRegistry,
  domainMetricsText,
  startHttpTimer,
  recordHttpMetric,
  startDbCollector,
} from "./metrics";

export function buildApp(sql: Sql, embeddingClient: EmbeddingClient): Elysia {
  const searchRoute = createSearchRoute(sql, embeddingClient);
  const projectDocumentRoute = createProjectDocumentRoute(sql);

  return new Elysia()
    .use(openapi({
      documentation: {
        info: {
          title: "docs-indexer API",
          version: "0.1.0",
          description: "Semantic search over indexed documentation.",
        },
      },
    }))
    .use(authPlugin)
    .get('/metrics', async () => {
      return new Response(await domainMetricsText(), {
        headers: { 'Content-Type': domainRegistry.contentType },
      });
    })
    .onRequest(({ request, set }) => {
      (set as any).__start = Date.now();
      startHttpTimer({ request });
    })
    .onAfterHandle(({ request, set }) => {
      const start = (set as any).__start;
      const duration = start ? Date.now() - start : 0;
      console.log(`${request.method} ${new URL(request.url).pathname} ${set.status} ${duration}ms`);
      recordHttpMetric({ request, set }, set.status);
    })
    .onError(({ request, code, set }) => {
      console.log(`${request.method} ${new URL(request.url).pathname} ${set.status} error=${code}`);
      recordHttpMetric({ request, set }, set.status);
    })
    .use(searchRoute)
    .use(projectDocumentRoute) as unknown as Elysia;
}

if (import.meta.main) {
  const config = getConfig();
  const sql = createPool(config);
  const embeddingClient = createEmbeddingClient(config);

  const stopDbCollector = startDbCollector(sql, config.dbCollectorIntervalMs);

  const shutdown = () => {
    stopDbCollector();
    sql.end().catch(() => {});
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  buildApp(sql, embeddingClient).listen(config.port);

  console.log(`docs-indexer API listening on port ${config.port}`);
}