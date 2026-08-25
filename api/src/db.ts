import postgres from "postgres";
import type { AppConfig } from "./config";

export type Sql = ReturnType<typeof postgres>;

export function createPool(config: AppConfig): Sql {
  return postgres(config.databaseUrl, {
    max: 10,
    idle_timeout: 30,
    connect_timeout: 10,
  });
}
