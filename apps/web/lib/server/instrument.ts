/**
 * The mounted instrument, opened ONCE per server process.
 *
 * This is the only module in `apps/web` that may reach the operational item
 * bank, and it is under `lib/server/**` so the repo's existing server-only
 * rule covers it (FRONTEND.md §2, `test/serverOnlyPages.test.ts`). Nothing
 * here is importable from a client component: `@ailx/instrument` reads the
 * snapshot with `node:fs`, so a bundler cannot inline a bank even by mistake.
 *
 * Clean-clone fallback (docs/ARCHITECTURE.md §12): when the operational
 * snapshot is not present — a contributor without the private content, or a
 * preview deploy — hosted mode opens the PUBLIC released-practice tier
 * instead of refusing to boot. It is marked `released`, so every caller can
 * tell the difference between an exam and a practice run.
 */
import { openDemoInstrument, openInstrument, type Instrument } from "@ailx/instrument";
import { assetUrl } from "../mode";

let mounted: Promise<Instrument> | undefined;

export function instrument(): Promise<Instrument> {
  mounted ??= openInstrument(process.env, { assetUrl }).catch((err) => {
    console.warn(
      "[ailx instrument] operational snapshot unavailable, serving the public " +
        "released-practice tier instead:",
      err instanceof Error ? err.message : err,
    );
    return openDemoInstrument({ assetUrl });
  });
  return mounted;
}

/** Testing only: force the next call to re-open. */
export function resetMountedInstrument(): void {
  mounted = undefined;
}
