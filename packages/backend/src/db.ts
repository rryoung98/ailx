/**
 * Minimal database seam. Both `pg` (a dedicated client/pool-checkout, NOT a
 * pool proxy — transactions need a single session) and `@electric-sql/pglite`
 * satisfy this structurally, so the store runs unchanged against Cloud SQL in
 * production and in-process Postgres in tests.
 */

export interface QueryResultRow {
  [column: string]: unknown;
}

export interface Queryable {
  query(text: string, params?: unknown[]): Promise<{ rows: QueryResultRow[] }>;
}

/**
 * Run `fn` inside a transaction on `db`. `db` MUST be a single session
 * (pg Client / pglite instance) — BEGIN on a pool proxy is meaningless.
 */
export async function withTransaction<T>(
  db: Queryable,
  fn: (tx: Queryable) => Promise<T>,
): Promise<T> {
  await db.query("BEGIN");
  try {
    const result = await fn(db);
    await db.query("COMMIT");
    return result;
  } catch (err) {
    try {
      await db.query("ROLLBACK");
    } catch {
      // The original error is the one that matters.
    }
    throw err;
  }
}
