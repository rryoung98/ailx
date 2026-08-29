-- AILX platform schema — spec §11 (judging pipeline) + §14 (versioning schema).
-- Postgres 15+. Responses are append-only; scores are superseded, never updated.

CREATE TABLE instruments (
  id             text NOT NULL,          -- 'ailx'
  version        text NOT NULL,          -- '2026.1'
  package_digest text NOT NULL,          -- immutable OCI digest
  effective_from date NOT NULL,
  effective_to   date,
  PRIMARY KEY (id, version)
);

CREATE TABLE track_versions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instrument_id  text NOT NULL,
  instrument_ver text NOT NULL,
  track_id       text NOT NULL,          -- 't1-creative-build'
  plugin_id      text NOT NULL,          -- 'artifact-hosting@2'
  config_digest  text NOT NULL,
  rubric_version text NOT NULL,          -- hash(rubric + prompts)
  scoring_digest text NOT NULL,          -- hash of score.ts build output
  UNIQUE (instrument_id, instrument_ver, track_id),
  FOREIGN KEY (instrument_id, instrument_ver) REFERENCES instruments (id, version)
);

CREATE TABLE participants (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_ref   text UNIQUE,                -- Clerk user id behind AuthProvider
  locale     text NOT NULL DEFAULT 'en',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE attempts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id uuid NOT NULL REFERENCES participants(id),
  instrument_id  text NOT NULL,
  instrument_ver text NOT NULL,
  started_at     timestamptz NOT NULL DEFAULT now(),
  finalized_at   timestamptz,
  FOREIGN KEY (instrument_id, instrument_ver) REFERENCES instruments (id, version)
);

-- Append-only. Never UPDATEd.
CREATE TABLE responses (
  id         bigserial PRIMARY KEY,
  attempt_id uuid NOT NULL REFERENCES attempts(id),
  item_id    text,                       -- content-addressed; NULL for open tracks
  seq        int  NOT NULL,
  payload    jsonb NOT NULL,
  client_ts  timestamptz NOT NULL,
  server_ts  timestamptz NOT NULL DEFAULT now(),
  latency_ms int,
  UNIQUE (attempt_id, seq)
);

-- ONE T1 site submission per attempt, enforced HERE and not by an application
-- pre-check: idempotency is a DB uniqueness constraint, not a best-effort
-- SELECT (spec §11, and the rule this file's README states). Two concurrent
-- uploads at DIFFERENT seqs both pass a pre-check and would otherwise both
-- insert, leaving scoring to pick one silently — and a later insert with a
-- LOWER seq would retroactively change which digest is "first".
CREATE UNIQUE INDEX responses_one_t1_site_per_attempt
  ON responses (attempt_id) WHERE payload->>'kind' = 't1-site-snapshot';

-- Reachability lookup for the site serve path: stored snapshot bytes are
-- servable only while a response row still points at their digest (see
-- packages/backend/src/t1/handlers.ts). Per-asset request, so it is indexed.
CREATE INDEX responses_t1_site_digest
  ON responses ((payload->>'digest')) WHERE payload->>'kind' = 't1-site-snapshot';

-- Exposure log: which items each attempt was SHOWN (spec §11 — per-item
-- stats / IRT need presented-but-unanswered items too). Insert-once per
-- (attempt, track) at attempt creation; never UPDATEd. The ids are also
-- recomputable from stored inputs alone (attempt id + content-addressed
-- bank) — this row is the recorded audit copy of that derivation.
CREATE TABLE attempt_decks (
  id          bigserial PRIMARY KEY,
  attempt_id  uuid NOT NULL REFERENCES attempts(id),
  track_id    text NOT NULL,
  bank_sha256 text NOT NULL,             -- content-addressed bank the ids index into
  item_ids    jsonb NOT NULL,            -- presented order, JSON array of item ids
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (attempt_id, track_id)
);

-- T3 transcript is the audit artefact; revision_of measures prompt iteration.
CREATE TABLE transcripts (
  id          bigserial PRIMARY KEY,
  attempt_id  uuid NOT NULL REFERENCES attempts(id),
  track_id    text NOT NULL,
  seq         int  NOT NULL,
  verb        text NOT NULL,             -- prompted | revised | regenerated | submitted
  body        jsonb NOT NULL,
  revision_of bigint REFERENCES transcripts(id),
  client_ts   timestamptz NOT NULL,
  server_ts   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (attempt_id, track_id, seq)
);

-- Idempotency lives here, not in Cloud Tasks de-duplication (spec §11).
CREATE TABLE judgments (
  id              bigserial PRIMARY KEY,
  submission_id   uuid NOT NULL,
  attempt_id      uuid NOT NULL REFERENCES attempts(id),
  track_id        text NOT NULL,
  dimension       text NOT NULL,
  sample          int  NOT NULL,         -- ensemble sample index (x3)
  rubric_version  text NOT NULL,
  model_id        text NOT NULL,         -- 'gemini-3.1-pro@20260801'
  value           numeric(6,3) NOT NULL,
  evidence        text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (submission_id, dimension, sample, rubric_version, model_id)
);

-- Scores record exactly which code and which model produced them.
CREATE TABLE scores (
  id             bigserial PRIMARY KEY,
  attempt_id     uuid NOT NULL REFERENCES attempts(id),
  rubric_version text NOT NULL,
  scoring_digest text NOT NULL,
  model_manifest jsonb NOT NULL,
  raw            jsonb NOT NULL,         -- subscores, evidence, ensemble spread
  scaled         numeric(6,3) NOT NULL,
  computed_at    timestamptz NOT NULL DEFAULT now(),
  superseded_by  bigint REFERENCES scores(id),
  UNIQUE (attempt_id, rubric_version, scoring_digest)
);

-- ---------------------------------------------------------------------------
-- Sharing (growth loop) — spec §12 + docs/SHARING.md.
--
-- A share link is an UNLISTED CAPABILITY: a 256-bit token, unguessable, and
-- served `noindex`. It is NOT a public-gallery entry — the spec's
-- approval-required gallery gate (T4 "Gallery governance") still applies to
-- anything that becomes publicly listed, which is what `submitted_at` /
-- `approved_at` record.
--
-- The token itself is stored (docs/SHARING.md §2). The deliberate trade: a
-- share link must be RECOVERABLE by its owner — a candidate who lost the URL
-- can re-copy it instead of revoking, and a published gallery card can link
-- to the view it came from. The token stays 256 unguessable bits, the view
-- stays `noindex`, ownership is re-checked on every owner read, and
-- revocation still fully works, which is what actually bounds the exposure.
-- The shared payload is FROZEN at creation (an allowlist built by
-- @ailx/report `buildSharePayload`, only the SECTIONS the candidate opted
-- into), so a later code change cannot widen what an already-issued link
-- exposes.
--
-- Lifecycle is monotone one-way stamps, never a destructive edit (same
-- pattern as attempts.finalized_at):
--   created_at            -> unlisted
--   + submitted_at        -> submitted for the public gallery
--   + approved_at         -> published in the public gallery
--   + rejected_at         -> refused by a named human, with a reason the
--                            candidate is shown; never publicly served again
--   + revoked_at          -> revoked; nothing is served at any stage
--
-- The approval policy is HYBRID and derived from `site_digest`, which is a
-- stored column, never a client-supplied field:
--   site_digest IS NULL     — a derived player-type card. Low risk, high
--                             volume, the viral engine: submit and approve
--                             stamp together (auto-publish, no human queue).
--   site_digest IS NOT NULL — candidate-authored HTML hosted at our origin.
--                             Spec §12 / "Gallery governance" stands: a HUMAN
--                             stamps approved_at (+ approved_by) before it is
--                             publicly listed.
-- Re-sharing after a revoke inserts a NEW row with a NEW token; the revoked
-- row stays as the audit record.
CREATE TABLE share_links (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id    uuid NOT NULL REFERENCES attempts(id),
  token         text NOT NULL UNIQUE,     -- the capability token, recoverable
  payload       jsonb NOT NULL,           -- frozen allowlisted share payload
  site_digest   text,                     -- set only on explicit site opt-in
  created_at    timestamptz NOT NULL DEFAULT now(),
  submitted_at  timestamptz,
  approved_at   timestamptz,
  approved_by   text,                     -- 'auto:card' or the human approver
  rejected_at   timestamptz,
  rejected_by   text,                     -- the human who refused it
  reject_reason text,                     -- shown to the candidate, verbatim
  revoked_at    timestamptz,
  -- An approved row must always say who approved it (auto or human).
  CONSTRAINT share_links_approval_recorded
    CHECK ((approved_at IS NULL) = (approved_by IS NULL)),
  -- A refusal is never anonymous and never silent: all three stamps or none.
  CONSTRAINT share_links_rejection_recorded
    CHECK (num_nonnulls(rejected_at, rejected_by, reject_reason) IN (0, 3)),
  -- Approved and rejected are mutually exclusive terminal decisions.
  CONSTRAINT share_links_one_decision
    CHECK (approved_at IS NULL OR rejected_at IS NULL)
);

-- At most one live link per attempt; revoked rows accumulate as the trail.
CREATE UNIQUE INDEX share_links_one_active
  ON share_links (attempt_id) WHERE revoked_at IS NULL;

-- Loop measurement, deliberately anonymous: one row per served view, day
-- granularity, no IP, no user agent, no referrer, no visitor id. Enough to
-- answer "does the loop work", incapable of tracking a person.
CREATE TABLE share_views (
  id        bigserial PRIMARY KEY,
  share_id  uuid NOT NULL REFERENCES share_links(id),
  viewed_on date NOT NULL DEFAULT current_date
);
CREATE INDEX share_views_by_share ON share_views (share_id);

-- ---------------------------------------------------------------------------
-- Practice and streaks (progression loop) — packages/report `practice.ts` /
-- `progress.ts`, and db/README.md for the migration statements.
--
-- Practice is the SHORT, UNSCORED training drill (spec §13 "Mastery"). It is
-- deliberately a separate pair of tables from `attempts`/`responses`, because
-- it is a separate thing: it draws from the practice-only corpus, never from
-- the scored item bank, it reaches no `score()`, and it must never be
-- mistaken for a sitting of the instrument. Nothing here is referenced by
-- `scores`, `judgments` or `attempt_decks`.
--
-- A STREAK IS DERIVED, NEVER STORED. There is no streak column and no streak
-- table on purpose: a stored counter is a number the server must trust itself
-- to have maintained, and every bug in it is unfalsifiable afterwards. The
-- streak is recomputed from these rows on every read (@ailx/report
-- `streakSummary`), so it is always exactly what the stored evidence says.
CREATE TABLE practice_sessions (
  id             uuid PRIMARY KEY,       -- assigned by the app: it seeds the deck
  participant_id uuid NOT NULL REFERENCES participants(id),
  drill          text NOT NULL,          -- 'artefact-families'
  bank_version   text NOT NULL,          -- practice corpus version at deal time
  item_ids       jsonb NOT NULL,         -- the dealt deck, in presented order
  started_at     timestamptz NOT NULL DEFAULT now(),
  -- Monotone one-way completion stamp, exactly like attempts.finalized_at:
  -- set once, by the server, and ONLY when the session qualified (whole deck
  -- answered, and slower than the anti-gaming floor measured between
  -- started_at and the submit). An abandoned or instant session simply never
  -- gets one, so it can never buy a streak day.
  completed_at   timestamptz,
  answered       int,                    -- answers accepted (server-counted)
  correct        int,                    -- answers graded correct SERVER-side
  -- The participant's UTC offset in minutes at completion, clamped to a real
  -- civil offset by the app. The streak day is derived from completed_at (a
  -- server clock) plus this offset — a client can move its own day boundary,
  -- which travelling would do anyway, but cannot manufacture a day.
  tz_offset_min  int,
  CONSTRAINT practice_sessions_completion_recorded
    CHECK (num_nonnulls(completed_at, answered, correct, tz_offset_min) IN (0, 4))
);

-- Streak reads are always "this participant, completed only, newest first".
CREATE INDEX practice_sessions_by_participant
  ON practice_sessions (participant_id, completed_at DESC)
  WHERE completed_at IS NOT NULL;

-- Append-only, same rule as `responses`: never UPDATEd, never DELETEd, and a
-- retried submit collides on (session_id, seq) instead of overwriting.
-- `correct` is the SERVER's verdict from (item_id, choice) — the client's own
-- opinion of its answer is not stored and is not read (FRONTEND.md §4.7).
CREATE TABLE practice_answers (
  id         bigserial PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES practice_sessions(id),
  seq        int  NOT NULL,
  item_id    text NOT NULL,              -- always a practice: id, never a bank id
  choice     int  NOT NULL,
  correct    boolean NOT NULL,
  latency_ms int,
  client_ts  timestamptz NOT NULL,
  server_ts  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, seq)
);

-- ---------------------------------------------------------------------------
-- Moderation trail — docs/SHARING.md §7.6.
--
-- The queue (share_links.submitted_at/approved_at/rejected_at) records WHAT
-- was decided. This table records the CONVERSATION around it: an internal
-- note a moderator leaves for the next moderator, and the messages exchanged
-- with the candidate whose submission was decided.
--
-- Append-only, in the same sense as `responses`: nothing here is ever UPDATEd
-- or DELETEd. An edit inserts a new row pointing at the row it replaces
-- (`supersedes_id`), a retraction inserts a new EMPTY row the same way, and
-- the superseded row stays exactly as it was written. The trail is the
-- accountability artifact; a trail that can be rewritten is not one.
--
-- Two audiences, one table, one column that separates them:
--   visibility = 'internal' — moderator-only. Never serialized to a
--                             candidate-reachable payload, filtered in SQL
--                             (not in the renderer), and a candidate can
--                             never write one (CHECK below).
--   visibility = 'shared'   — exchanged WITH the candidate. The candidate
--                             sees the body and the ROLE, never `author_ref`:
--                             the same privacy posture as a refusal, whose
--                             reason is shown and whose reviewer is not.
CREATE TABLE moderation_comments (
  id            bigserial PRIMARY KEY,
  share_id      uuid NOT NULL REFERENCES share_links(id),
  -- The VERIFIED caller (participants.auth_ref shape), never a body field.
  author_ref    text NOT NULL,
  author_role   text NOT NULL,
  visibility    text NOT NULL,
  body          text NOT NULL,           -- '' only for a retraction
  supersedes_id bigint REFERENCES moderation_comments(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT moderation_comments_role
    CHECK (author_role IN ('reviewer', 'candidate')),
  CONSTRAINT moderation_comments_visibility
    CHECK (visibility IN ('internal', 'shared')),
  -- A candidate cannot write an internal note, at any layer.
  CONSTRAINT moderation_comments_candidate_is_shared
    CHECK (author_role = 'reviewer' OR visibility = 'shared'),
  -- An empty body is exactly a retraction, and a retraction always replaces
  -- something: no anonymous blank rows, no silent deletions.
  CONSTRAINT moderation_comments_retraction
    CHECK (body <> '' OR supersedes_id IS NOT NULL)
);

-- A row may be replaced at most once: the trail is a chain, never a fork.
CREATE UNIQUE INDEX moderation_comments_one_supersede
  ON moderation_comments (supersedes_id) WHERE supersedes_id IS NOT NULL;

-- Every read is "this case, oldest first".
CREATE INDEX moderation_comments_by_share
  ON moderation_comments (share_id, id);
