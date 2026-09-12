import postgres from "postgres";
import type { AppConfig } from "./config";
import { dbQueriesTotal, dbQueryDurationSeconds } from "./metrics";

export type Sql = ReturnType<typeof postgres>;

export function wrapSql(pool: Sql): Sql {
  return new Proxy(pool, {
    apply(target, thisArg, args) {
      dbQueriesTotal.inc();
      const observe = dbQueryDurationSeconds.startTimer();

      let result: unknown;
      try {
        result = Reflect.apply(target, thisArg, args);
      } catch (err) {
        observe();
        throw err;
      }

      if (result instanceof Promise) {
        result.then(
          () => observe(),
          () => observe()
        );
      } else {
        observe();
      }

      return result;
    },
    get(target, prop, receiver) {
      return Reflect.get(target, prop, receiver);
    },
  }) as Sql;
}

export function createPool(config: AppConfig): Sql {
  const pool = postgres(config.databaseUrl, {
    max: 10,
    idle_timeout: 30,
    connect_timeout: 10,
  });

  return wrapSql(pool);
}
