import { Elysia } from "elysia";
import { openapi } from "@elysia/openapi";
import { getConfig, type AppConfig } from "./config";
import { createPool, type Sql } from "./db";
import { createEmbeddingClient, type EmbeddingClient } from "./embedding";
import { createSearchRoute } from "./routes/search";
import { authPlugin } from "./auth";

export function buildApp(config: AppConfig, sql: Sql, embeddingClient: EmbeddingClient): Elysia {
  const searchRoute = createSearchRoute(sql, embeddingClient);

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
    .use(searchRoute) as unknown as Elysia;
}

const config = getConfig();
const sql = createPool(config);
const embeddingClient = createEmbeddingClient(config);

buildApp(config, sql, embeddingClient).listen(config.port);

console.log(`docs-indexer API listening on port ${config.port}`);