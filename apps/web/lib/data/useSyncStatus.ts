"use client";

/**
 * The mirror's status, as React state.
 *
 * A surface that has to tell a candidate their sitting is not scored yet
 * needs three things: the status now, a subscription so it changes when the
 * mirror's own bounded retries change it, and the one action left when those
 * run out. All three are here so the completion screen and the report cannot
 * disagree about any of them.
 *
 * `resumeOnMount` is the report's half of TEN-206. The report reads the
 * stored log directly and fired NO sync pass, so a sitting whose finalize
 * failed reached the one screen that is meant to show a score and asked the
 * service for nothing. A resume pass is cheap when there is nothing to do:
 * the mirror returns early on an attempt the service has already finalized.
 */
import { useCallback, useEffect, useState } from "react";
import { getAttemptPersistence, type AttemptPersistence, type SyncStatus } from "./persistence";

const IDLE: SyncStatus = { phase: "idle", finalized: false, finalizePending: false, failures: 0 };

export function useSyncStatus(opts: { resumeOnMount?: boolean } = {}): {
  status: SyncStatus;
  busy: boolean;
  retry: () => void;
} {
  const { resumeOnMount = false } = opts;
  const [status, setStatus] = useState<SyncStatus>(IDLE);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // Browser only: `getAttemptPersistence` reads `window.localStorage`, and
    // a server render has neither a store nor a mirror.
    if (typeof window === "undefined") return;
    let persistence: AttemptPersistence;
    try {
      persistence = getAttemptPersistence();
    } catch {
      return;
    }
    const unsubscribe = persistence.subscribe(setStatus);
    setStatus(persistence.status());
    if (resumeOnMount) void persistence.resume().then(setStatus);
    return unsubscribe;
  }, [resumeOnMount]);

  const retry = useCallback(() => {
    setBusy(true);
    void getAttemptPersistence()
      .resume()
      .then(setStatus)
      .finally(() => setBusy(false));
  }, []);

  return { status, busy, retry };
}
