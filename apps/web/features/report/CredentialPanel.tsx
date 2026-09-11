"use client";

/**
 * Issue, publish and revoke the holder's AILX credential.
 *
 * WHAT THIS PANEL IS CAREFUL ABOUT. A credential is the one artefact a
 * stranger will act on, so the copy here must never promise more than
 * /verify will confirm: it says "completed", never "passed", and it prints
 * the same `CREDENTIAL_LIMITS` the verification page prints. Every field a
 * holder pastes into LinkedIn is computed SERVER-side from the stored claim
 * (name, organisation, issue date, credential id, credential URL), so the two
 * can never drift.
 *
 * The code is public and idempotent: pressing the button twice returns the
 * same credential, because a published code must never be silently orphaned.
 * Revoking keeps the URL alive and makes it say "revoked" — the honest answer
 * to anyone already holding it.
 *
 * NOTHING IS ISSUED UNTIL THE CANDIDATE ASKS. `GET` answering 404 is the
 * honest state before a credential exists, so it is the OFFER and never an
 * error (dogfood 2026-09-06, D2: the service issued a credential on the first
 * ask, and no screen ever asked). A credential is a public claim published
 * under a person's own name — minting one unasked would put a verification
 * URL for their sitting into the world before they decided they wanted it,
 * and `docs/CREDENTIAL.md` §1 is explicit that the holder is the one making
 * the assertion. So the sitting ends, the offer appears, and the button is
 * the consent.
 *
 * A PARTIAL SITTING IS NAMED AS ONE, HERE AND ON /verify. The stored claim
 * decides: `tracksAttempted` shorter than the instrument means the name reads
 * "Partial Sitting (T2, T3)", and there is no four-letter code and no
 * character to show, because one axis is read per track (TEN-149,
 * docs/CREDENTIAL.md §6).
 *
 * Static export: `isServerMode()` is false, there is nothing to issue against
 * and this component renders nothing (FRONTEND.md §2.3.4).
 */
import { useCallback, useEffect, useState } from "react";
import { API_ROUTES, apiPath, type OwnerCredential } from "@ailx/contract";
import type { TrackId } from "@ailx/session";
import { useIdentity } from "../../lib/auth/identityState";
import { serviceHeaders } from "../../lib/data/traceparent";
import { deadline } from "../../lib/data/deadline";
import { mayRetry, refusedBy, threwAs, UNREADABLE, writeFailureCopy, type WriteFailure } from "./writeFailure";
import { CREDENTIAL_LIMITS, isFullSitting, linkedInAddUrl, TRACK_META } from "@ailx/report";
import { basePath, isServerMode } from "../../lib/mode";
import { browserApiOptions, getServerAttemptId } from "../../lib/data/persistence";

type Phase = "loading" | "none" | "live" | "busy" | "error";

/** The three manifest routes this panel drives — one path, three methods. */
type CredentialRoute = "issueCredential" | "getCredential" | "revokeCredential";

/**
 * The credential off the wire, or null when the body is not one.
 *
 * A 200 with nothing in it is not a credential, and rendering one anyway
 * threw on the first field this panel reads. Checked rather than cast, for
 * the same reason `scoresOfRecord.ts` checks: this body decides what a
 * candidate is told they can publish.
 */
function ownerCredential(body: unknown): OwnerCredential | null {
  const record = body as { credential?: unknown } | null;
  const credential = record?.credential as OwnerCredential | undefined;
  return credential !== null &&
    typeof credential === "object" &&
    typeof credential?.verifyPath === "string" &&
    typeof credential.claim === "object"
    ? credential
    : null;
}

export function CredentialPanel({
  attemptId,
  sat,
}: {
  attemptId: string;
  /**
   * Which tracks this sitting covered, when the page knows. It only shapes
   * the copy BEFORE anything is issued; once a credential exists its own
   * stored claim is the authority and this is not read.
   */
  sat?: readonly TrackId[];
}) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [credential, setCredential] = useState<OwnerCredential | null>(null);
  const [copied, setCopied] = useState(false);
  /**
   * WHAT THE LAST FAILURE WAS, not merely that there was one (TEN-234). A
   * refusal carries its status and the service's own sentence, and decides
   * whether the button is offered again at all.
   */
  const [failure, setFailure] = useState<WriteFailure | null>(null);

  const request = useCallback(
    async (route: CredentialRoute): Promise<Response> => {
      const opts = browserApiOptions();
      const id = getServerAttemptId(window.localStorage, attemptId) ?? attemptId;
      /* BOUNDED, by what the route is FOR: reading whether a credential
         exists is a `read`, and issuing or revoking one is a `write`. Before
         TEN-210 this helper passed no signal at all, so a service that
         accepted the socket and never answered left this panel on
         "Checking…" for as long as the report was open. The bound goes
         through `opts.fetchFn`, which is the injected fetch the tests
         drive. */
      const bound = deadline(route === "getCredential" ? "read" : "write");
      try {
        return await opts.fetchFn(`${opts.baseUrl}${apiPath(route, { id })}`, {
          method: API_ROUTES[route].method,
          headers: {
            "content-type": "application/json",
            ...(await serviceHeaders(window.localStorage)),
          },
          signal: bound.signal,
        });
      } finally {
        bound.settle();
      }
    },
    [attemptId],
  );

  /**
   * THE READ MAY NOT FIRE WHILE THE IDENTITY IS PENDING (TEN-215).
   *
   * `ClerkTokenBridge` registers the token source in an effect, so a read
   * fired on mount carries no Bearer token. The service answers 401, `held`
   * becomes null, and 404 and 401 are the same answer to the code below —
   * so a candidate who ALREADY HOLDS a credential was offered a fresh one
   * and shown no Revoke control. The sibling read states the same rule
   * (`useScoresOfRecord`, TEN-152).
   *
   * `pending` is BOUNDED elsewhere, so this is a wait and not a dead end: a
   * Clerk that never publishes is resolved to the asserted dev identity
   * after `IDENTITY_DEADLINE_MS` (`lib/auth/identityState.ts`, TEN-214), and
   * the read fires then. This panel needs no latch of its own.
   */
  const identityStatus = useIdentity().status;

  useEffect(() => {
    if (!isServerMode() || identityStatus === "pending") return;
    let live = true;
    void (async () => {
      try {
        const res = await request("getCredential");
        if (!live) return;
        /* 404 IS THE ORDINARY ANSWER, NOT A FAILURE: no credential has been
           issued for this sitting yet, which is exactly the state the offer
           below exists for. A 200 carrying no credential means the same
           thing to a candidate. */
        const held = res.ok ? ownerCredential(await res.json()) : null;
        if (held === null) {
          setPhase("none");
          return;
        }
        setCredential(held);
        setPhase("live");
      } catch (err) {
        if (!live) return;
        setFailure(threwAs(err));
        setPhase("error");
      }
    })();
    return () => {
      live = false;
    };
  }, [request, identityStatus]);

  if (!isServerMode()) return null;

  const url =
    credential === null
      ? null
      : `${window.location.origin}${basePath()}${credential.verifyPath}`;

  /* WHICH SITTING THIS IS, FROM THE BEST SOURCE AVAILABLE. The stored claim
     once one exists — it is what /verify will print — and the page's own
     view of the run before that. */
  const satCodes =
    credential !== null
      ? credential.claim.tracksAttempted
      : (sat ?? []).map((t) => TRACK_META[t].code);
  const partialSitting = satCodes.length > 0 && !isFullSitting(satCodes);
  /* A partial claim carries the pair EMPTY rather than absent, and a service
     that later drops the key entirely means the same thing (dogfood D8). Both
     read as "no type" here, and neither prints a blank. */
  const typeCode = credential?.claim.playerType?.code ?? "";
  const typeName = credential?.claim.playerType?.name ?? "";

  const act = async (route: "issueCredential" | "revokeCredential") => {
    setPhase("busy");
    setFailure(null);
    try {
      const res = await request(route);
      /* A REFUSAL IS AN ANSWER, AND IT IS READ HERE RATHER THAN THROWN
         (TEN-234). `throw new Error(String(res.status))` put the status into
         a message nobody read and landed in the same catch as an offline
         fetch, so the panel could only ever say one thing. */
      if (!res.ok) {
        setFailure(await refusedBy(res));
        setPhase("error");
        return;
      }
      if (route === "revokeCredential") {
        setCredential(null);
        setPhase("none");
        return;
      }
      const issued = ownerCredential(await res.json());
      /* A 2xx WITH NO CREDENTIAL IN IT IS OUR BUG, NOT THE NETWORK'S. It
         used to be thrown into the same catch as an offline fetch, so the
         panel told the candidate to check their connection about a call that
         landed (the same confusion TEN-229 fixed for reads). */
      if (issued === null) {
        setFailure(UNREADABLE);
        setPhase("error");
        return;
      }
      setCredential(issued);
      setPhase("live");
    } catch (err) {
      setFailure(threwAs(err));
      setPhase("error");
    }
  };

  const copy = () => {
    if (url === null) return;
    void navigator.clipboard?.writeText(url).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <section className="card" aria-labelledby="credential-heading" style={{ marginBottom: "2rem" }}>
      <p className="eyebrow" style={{ margin: 0 }}>credential · checkable by anyone</p>
      <h2 id="credential-heading" style={{ margin: "0.2rem 0 0.4rem" }}>
        Put this sitting on your profile
      </h2>
      <p className="muted small" style={{ maxWidth: "62ch" }}>
        A credential states that you sat and completed Foray on a date, on a stated instrument
        version, and gives a link anyone can check. It carries no score, and no Foray credential
        claims one: a credential asserts a sitting, never a result. When a scored claim exists,
        this same credential id gains it, with no reissue.
      </p>
      {partialSitting ? (
        <p className="small" style={{ maxWidth: "62ch" }} data-testid="credential-partial-notice">
          This sitting covered {satCodes.join(" · ")}, so the credential names itself a{" "}
          <strong>partial sitting</strong> and lists those tracks. It carries no four-letter code
          and no character: one axis is read per track, and a track that was not sat has no
          reading on its axis.
        </p>
      ) : null}
      <ul className="verify-list verify-limits small">
        {CREDENTIAL_LIMITS.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>

      {phase === "loading" ? <p className="faint small" role="status">Checking…</p> : null}

      {phase === "none" || phase === "busy" || phase === "error" ? (
        /* THE 404 LANDS HERE, AND IT IS THE OFFER. "No credential yet" is the
           true state of a sitting nobody has asked about, so this branch
           carries the action rather than an error message. */
        <div data-testid="credential-offer">
          <p style={{ marginBottom: "0.4rem" }}>
            <button
              type="button"
              className="btn primary"
              onClick={() => act("issueCredential")}
              /* A REFUSAL THAT WILL NOT CHANGE IS NOT OFFERED AGAIN
                 (TEN-234). A 403 or a 409 answers the same way every time,
                 and a live button beside a sentence saying so is still an
                 invitation to press it. */
              disabled={phase === "busy" || (failure !== null && !mayRetry(failure))}
            >
              {phase === "busy" ? "Working…" : "Issue my credential"}
            </button>
            {phase === "error" && failure !== null ? (
              <span className="small" style={{ marginLeft: "0.6rem", color: "var(--bad)" }} role="alert">
                {writeFailureCopy(failure, "Your sitting is saved.", "the exam service")}
              </span>
            ) : null}
          </p>
          <p className="faint small" style={{ marginBottom: 0 }}>
            Nothing exists until you press this, and you can revoke it afterwards.
          </p>
        </div>
      ) : null}

      {phase === "live" && credential !== null && url !== null ? (
        <div style={{ display: "grid", gap: "0.6rem" }}>
          <label className="small muted" htmlFor="credential-url">Verification link</label>
          <input
            id="credential-url"
            className="mono"
            readOnly
            value={url}
            onFocus={(e) => e.currentTarget.select()}
            style={{
              width: "100%", padding: "0.5rem 0.6rem", borderRadius: 8,
              border: "1px solid var(--border-strong)", background: "var(--bg)", color: "var(--fg)",
            }}
          />
          <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap", alignItems: "center" }}>
            <button type="button" className="btn small-btn" onClick={copy}>
              {copied ? "copied ✓" : "Copy link"}
            </button>
            <a
              className="btn small-btn"
              href={linkedInAddUrl(credential.linkedIn)}
              target="_blank"
              rel="noreferrer"
            >
              Add to LinkedIn <span aria-hidden>↗</span>
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
            <a className="btn small-btn" href={url} target="_blank" rel="noreferrer">
              See what a stranger sees <span aria-hidden>↗</span>
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
            <button type="button" className="btn small-btn" onClick={() => act("revokeCredential")}>
              Revoke
            </button>
          </div>
          <dl className="verify-facts">
            <div>
              <dt>Name</dt>
              <dd style={{ fontSize: "1rem" }}>{credential.linkedIn.name}</dd>
            </div>
            <div>
              <dt>Issuing organisation</dt>
              <dd style={{ fontSize: "1rem" }}>{credential.linkedIn.organizationName}</dd>
            </div>
            <div>
              <dt>Issue date</dt>
              <dd className="mono" style={{ fontSize: "1rem" }}>
                {credential.linkedIn.issueMonth}/{credential.linkedIn.issueYear}
              </dd>
            </div>
            <div>
              <dt>Credential id</dt>
              <dd className="mono" style={{ fontSize: "0.9rem" }}>{credential.linkedIn.credentialId}</dd>
            </div>
            <div>
              <dt>Tracks attempted</dt>
              <dd className="mono" style={{ fontSize: "1rem" }} data-testid="credential-tracks">
                {credential.claim.tracksAttempted.join(" · ")}
              </dd>
            </div>
            <div>
              <dt>Player type</dt>
              {/* The same branch /verify draws, from the same stored claim
                  (VerifyView.tsx): a partial sitting has no four-letter code
                  and no character, and this says why instead of printing the
                  blank pair the row carries (dogfood D8). The two screens
                  must not disagree about one claim. */}
              <dd style={{ fontSize: "1rem" }} data-testid="credential-player-type">
                {typeCode === "" ? (
                  <span className="faint small">
                    Not derived — this sitting covered{" "}
                    {credential.claim.tracksAttempted.join(" · ")}, and one axis is read per
                    track.
                  </span>
                ) : (
                  <>
                    <span className="mono">{typeCode}</span> — {typeName}
                  </>
                )}
              </dd>
            </div>
          </dl>
          <p className="small muted" style={{ margin: 0 }}>
            Those are the four fields LinkedIn asks for. The link above is the credential URL.
            Revoking keeps the link working and makes it say <strong>revoked</strong>, so a holder
            learns the truth instead of hitting a dead page.
          </p>
        </div>
      ) : null}
    </section>
  );
}
