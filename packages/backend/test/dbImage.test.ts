/**
 * The cached PGlite cluster image (test/helpers.ts). The speedup is only
 * legitimate if a database booted FROM the cache is indistinguishable from one
 * built by running `db/schema.sql` on a cold cluster, so that is what this
 * asserts — on the cold-build path and the cache-load path, in that order.
 */
import { existsSync, rmSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { IMAGE_PATH, closeDb, freshDb } from "./helpers.js";
import { ensureParticipant } from "../src/store.js";

/** Every table `db/schema.sql` declares must survive the dump/load round trip. */
async function tables(db: Awaited<ReturnType<typeof freshDb>>): Promise<string[]> {
  const { rows } = await db.query<{ tablename: string }>(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename",
  );
  return rows.map((r) => r.tablename);
}

let cold: string[];
let warm: string[];
let builtImage = false;

beforeAll(async () => {
  // Force the cold path even on a machine that has run the suite before.
  await closeDb();
  rmSync(IMAGE_PATH, { force: true });
  cold = await tables(await freshDb());
  builtImage = existsSync(IMAGE_PATH);

  // Force the cache path: a brand new PGlite, loaded from what we just wrote.
  await closeDb();
  warm = await tables(await freshDb());
});

describe("cached cluster image", () => {
  it("writes the image on the cold path so later files can skip initdb", () => {
    expect(builtImage).toBe(true);
  });

  it("gives the cache-loaded database the identical schema", () => {
    expect(cold.length).toBeGreaterThan(0);
    expect(warm).toEqual(cold);
  });

  it("carries the constraints, not just the table names", async () => {
    const db = await freshDb();
    // A duplicate ref must still be rejected by the real unique index, which
    // only exists if the DDL survived the round trip.
    const a = await ensureParticipant(db, "dev:image-check");
    const b = await ensureParticipant(db, "dev:image-check");
    expect(b.id).toBe(a.id);
  });

  it("hands every file a database with no rows left by the last one", async () => {
    const db = await freshDb();
    const { rows } = await db.query<{ n: string }>("SELECT count(*) AS n FROM participants");
    expect(Number(rows[0]!.n)).toBe(0);
  });
});
