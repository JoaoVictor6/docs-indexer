import { describe, it, expect, mock } from "bun:test";
import { wrapSql } from "./db";
import type { Sql } from "./db";
import { dbQueriesTotal, dbQueryDurationSeconds } from "./metrics";

function createMockSql() {
  const fn = mock(async () => [{ one: 1 }]);
  (fn as unknown as { end: unknown }).end = mock(async () => {});
  return fn as unknown as Sql;
}

async function queriesTotal(): Promise<number> {
  const snapshot = await dbQueriesTotal.get();
  return snapshot.values[0]?.value ?? 0;
}

async function queryDurationCount(): Promise<number> {
  const snapshot = await dbQueryDurationSeconds.get();
  return (
    snapshot.values.find(
      (v) => v.metricName === "docs_indexer_db_query_duration_seconds_count"
    )?.value ?? 0
  );
}

describe("wrapSql", () => {
  it("returns query results unchanged", async () => {
    const sql = wrapSql(createMockSql());
    const result = await sql`SELECT 1 AS one`;
    expect(result[0].one).toBe(1);
  });

  it("increments the query counter and observes the duration histogram", async () => {
    const sql = wrapSql(createMockSql());
    const beforeTotal = await queriesTotal();
    const beforeCount = await queryDurationCount();

    await sql`SELECT 1 AS one`;

    expect(await queriesTotal()).toBe(beforeTotal + 1);
    expect(await queryDurationCount()).toBe(beforeCount + 1);
  });

  it("forwards property access so .end() still works", async () => {
    const mockSql = createMockSql();
    const sql = wrapSql(mockSql);
    await sql.end();
    expect((mockSql as unknown as { end: ReturnType<typeof mock> }).end).toHaveBeenCalled();
  });
});
