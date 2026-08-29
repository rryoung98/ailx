# Database

Platform schema per spec §11/§14. Applied to Cloud SQL Postgres in the hosted deployment; the static showcase mirrors these shapes in localStorage.

Invariants:
- `responses` and `transcripts` are append-only.
- Re-scores are inserts linked via `scores.superseded_by`.
- Judgment idempotency = DB uniqueness constraint, not queue de-dup.
- One T1 site submission per attempt = the same rule: `responses_one_t1_site_per_attempt`.
- Stored T1 snapshot bytes are servable only while a `responses` row points at
  their digest (the serve path checks; the upload path records the row BEFORE
  it stores bytes). No row = nothing to serve.

## Migrations

There is no migration tool yet. `schema.sql` is the source of truth; an
existing deployment adopts a change by running the new statements once, by
hand, against its database.

### 2026-09 — T1 submission uniqueness + serve reachability

```sql
-- Fails if an attempt already carries two site rows; delete the extra rows
-- (keep the lowest seq — the one scoring already treats as authoritative)
-- and re-run.
CREATE UNIQUE INDEX responses_one_t1_site_per_attempt
  ON responses (attempt_id) WHERE payload->>'kind' = 't1-site-snapshot';

CREATE INDEX responses_t1_site_digest
  ON responses ((payload->>'digest')) WHERE payload->>'kind' = 't1-site-snapshot';
```

Snapshots stored before this change may have no `responses` row at all (an
upload whose append was rejected still wrote its bytes). They stop being
servable the moment the serve path starts checking; deleting them from the
snapshot store is optional housekeeping:

```sql
SELECT DISTINCT payload->>'digest' FROM responses WHERE payload->>'kind' = 't1-site-snapshot';
```

Any `manifests/<hex>.json` whose digest is not in that list is unreachable and
safe to delete (with its now-unreferenced blobs).

### 2026-09 — recoverable share tokens and refusal stamps

`share_links.token_sha256` became `token`: the capability token is now stored so
a candidate can recover their own share URL and a gallery tile can link to its
share view (rationale and the trigger to reopen it: `docs/SHARING.md` §2).

**Existing rows cannot be migrated.** Only the hash was ever stored, so the
token is unrecoverable by construction — those links must be dropped, not
converted. Warn holders before running this on a database whose links matter.

```sql
BEGIN;
DELETE FROM share_views;   -- view rows reference links that cannot survive
DELETE FROM share_links;

ALTER TABLE share_links DROP COLUMN token_sha256;
ALTER TABLE share_links ADD COLUMN token text NOT NULL UNIQUE;

-- Refusal stamps: never anonymous, never silent, never both decisions.
ALTER TABLE share_links ADD COLUMN rejected_at   timestamptz;
ALTER TABLE share_links ADD COLUMN rejected_by   text;
ALTER TABLE share_links ADD COLUMN reject_reason text;
ALTER TABLE share_links ADD CONSTRAINT share_links_rejection_recorded
  CHECK (num_nonnulls(rejected_at, rejected_by, reject_reason) IN (0, 3));
ALTER TABLE share_links ADD CONSTRAINT share_links_one_decision
  CHECK (approved_at IS NULL OR rejected_at IS NULL);
COMMIT;
```

Rollback is destructive in the same way (the hash cannot be rebuilt from rows
that no longer exist); recreate the table from `schema.sql` instead.

### 2026-09 — practice sessions and streaks

Adds the progression loop's two tables. Nothing existing changes, so this is
additive and safe to run on a live database. There is **no streak table**: the
streak is recomputed from these rows on every read (`@ailx/report`
`streakSummary`), so a stored counter can never drift from the evidence.

```sql
CREATE TABLE practice_sessions (
  id             uuid PRIMARY KEY,
  participant_id uuid NOT NULL REFERENCES participants(id),
  drill          text NOT NULL,
  bank_version   text NOT NULL,
  item_ids       jsonb NOT NULL,
  started_at     timestamptz NOT NULL DEFAULT now(),
  completed_at   timestamptz,
  answered       int,
  correct        int,
  tz_offset_min  int,
  CONSTRAINT practice_sessions_completion_recorded
    CHECK (num_nonnulls(completed_at, answered, correct, tz_offset_min) IN (0, 4))
);

CREATE INDEX practice_sessions_by_participant
  ON practice_sessions (participant_id, completed_at DESC)
  WHERE completed_at IS NOT NULL;

CREATE TABLE practice_answers (
  id         bigserial PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES practice_sessions(id),
  seq        int  NOT NULL,
  item_id    text NOT NULL,
  choice     int  NOT NULL,
  correct    boolean NOT NULL,
  latency_ms int,
  client_ts  timestamptz NOT NULL,
  server_ts  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, seq)
);
```

Rolling back is a plain drop, in this order (the answers reference the
sessions), and costs nothing but the practice history:

```sql
DROP TABLE practice_answers;
DROP TABLE practice_sessions;
```

Invariants these tables carry:
- `practice_answers` is append-only, like `responses`. `correct` is the
  SERVER's verdict from `(item_id, choice)`; a client-asserted grade is never
  read and never stored.
- `completed_at` is a monotone one-way stamp, like `attempts.finalized_at`,
  and is set ONLY when the session qualified for the streak (whole deck
  answered, elapsed time measured between `started_at` and the server clock
  at submit). An abandoned or scripted session simply never gets one.
- `item_ids` only ever holds practice-corpus ids (`practice:*`). The scored
  item bank is never dealt here — asserted in
  `packages/report/test/practice.test.ts` against the real bank on disk.

### 2026-09 — the moderation trail

`moderation_comments` is new; nothing existing changes. Apply the table, its
constraints and its two indexes from `schema.sql` verbatim:

```sql
CREATE TABLE moderation_comments (
  id            bigserial PRIMARY KEY,
  share_id      uuid NOT NULL REFERENCES share_links(id),
  author_ref    text NOT NULL,
  author_role   text NOT NULL,
  visibility    text NOT NULL,
  body          text NOT NULL,
  supersedes_id bigint REFERENCES moderation_comments(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT moderation_comments_role
    CHECK (author_role IN ('reviewer', 'candidate')),
  CONSTRAINT moderation_comments_visibility
    CHECK (visibility IN ('internal', 'shared')),
  CONSTRAINT moderation_comments_candidate_is_shared
    CHECK (author_role = 'reviewer' OR visibility = 'shared'),
  CONSTRAINT moderation_comments_retraction
    CHECK (body <> '' OR supersedes_id IS NOT NULL)
);

CREATE UNIQUE INDEX moderation_comments_one_supersede
  ON moderation_comments (supersedes_id) WHERE supersedes_id IS NOT NULL;

CREATE INDEX moderation_comments_by_share
  ON moderation_comments (share_id, id);
```

The table is append-only by the same rule as `responses`: no code path issues
`UPDATE` or `DELETE` against it (asserted in
`packages/backend/test/moderation.test.ts`), an edit inserts a row naming the
row it replaces, and a retraction inserts an empty one. If a deployment ever
needs a row gone for a legal reason, that is a deliberate, recorded admin
action — not something the application can do.

### 2026-09 — credentials

`credentials` is new; nothing existing changes. Apply the table and its
partial unique index from `schema.sql` verbatim:

```sql
CREATE TABLE credentials (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id    uuid NOT NULL REFERENCES attempts(id),
  code          text NOT NULL UNIQUE,
  claim         jsonb NOT NULL,
  issued_at     timestamptz NOT NULL DEFAULT now(),
  revoked_at    timestamptz,
  revoke_reason text,
  CONSTRAINT credentials_revocation_recorded
    CHECK ((revoked_at IS NULL) = (revoke_reason IS NULL))
);

CREATE UNIQUE INDEX credentials_one_live
  ON credentials (attempt_id) WHERE revoked_at IS NULL;
```

Rollback is a plain drop. It destroys every issued credential, which means
every `/verify/<code>` URL a holder has already published — on a CV, on
LinkedIn — stops resolving. Prefer revoking the rows (which keeps the URL
answering, honestly) over dropping the table:

```sql
-- Reversible: the credential keeps verifying, and says it was revoked.
UPDATE credentials
   SET revoked_at = now(), revoke_reason = 'withdrawn by AILX'
 WHERE revoked_at IS NULL;

-- Irreversible.
DROP TABLE credentials;
```

Invariants this table carries:
- The stored `claim` is FROZEN at issue and never updated, like
  `share_links.payload`. The served document is derived from it at read time,
  so a revocation is visible immediately and the judged upgrade (spec Phase 4)
  adds a result to existing credentials without reissuing a code.
- `revoked_at` is a monotone one-way stamp and never travels without
  `revoke_reason`: the reason is shown verbatim to whoever is verifying.
- A revoked code KEEPS RESOLVING, unlike a revoked share token. A credential
  code is published on a CV, so the honest answer to a stranger is "revoked on
  <date>, because <reason>", never a 404.
