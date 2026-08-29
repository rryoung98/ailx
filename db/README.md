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
