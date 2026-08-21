# Database

Platform schema per spec §11/§14. Applied to Cloud SQL Postgres in the hosted deployment; the static showcase mirrors these shapes in localStorage.

Invariants:
- `responses` and `transcripts` are append-only.
- Re-scores are inserts linked via `scores.superseded_by`.
- Judgment idempotency = DB uniqueness constraint, not queue de-dup.
