"use client";
/**
 * "Forget this browser" — the only way to drop a dev identity now that it is
 * mirrored into a cookie as well as localStorage. It must clear BOTH: a
 * cookie left behind would keep handing the server an id this tab no longer
 * believes in, and the next server-rendered page would show a stranger their
 * predecessor's history.
 *
 * Nothing on the server is deleted (responses are append-only, spec §6); the
 * browser simply stops claiming that identity, and the next round of practice
 * mints a new one.
 */
import { clearDevUser } from "../../lib/data/persistence";

export function ForgetBrowser() {
  return (
    <p className="small faint" style={{ maxWidth: "62ch" }}>
      This history belongs to this browser, not to an account. Nothing already recorded is
      deleted — you would just stop being the person it belongs to.{" "}
      <button
        type="button"
        className="btn small-btn"
        onClick={() => {
          clearDevUser(window.localStorage);
          window.location.reload();
        }}
      >
        Forget this browser
      </button>
    </p>
  );
}
