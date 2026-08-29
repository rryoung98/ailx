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
