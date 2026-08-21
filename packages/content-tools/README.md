# @ailx/content-tools

Tooling for AILX instrument packages (`instruments/<version>/`, spec §14).

- **Loader** — `loadInstrument(dir)` parses and validates `manifest.yaml`,
  per-track `track.yaml` / `rubric.yaml` / `prompts/*.md` / `items/bank.jsonl`
  into a typed `InstrumentPackage`. Validation enforces: criteria points sum to
  `total_points`, four band anchors, `plugin` as `<id>@<apiVersion>`, judge
  prompts present for judged criteria, prompt front matter with
  `translation_provenance`, content-addressed item ids
  (`id = sha256(canonical_json(item))` via `@ailx/core`), canonical JSON lines,
  and a matching `bank.sha256`.
- **CLIs** (after `pnpm build`):
  - `pnpm hash-bank [--write] <bank.jsonl>` — verify or rewrite item ids,
    canonical lines, and `bank.sha256`. Verify mode exits 1 when stale (CI gate).
  - `pnpm rubric-version <instrument-dir>` — print
    `rubric_version = hash(rubric.yaml + prompts)` per track.
  - `pnpm build-snapshot <instrument-dir> [out.json]` — validate and write the
    whole instrument as one JSON file (`snapshot.json`) so the static web app
    imports it without YAML parsing at runtime.
- **Tests** — loader validation failures, hash round-trips, and a CI gate that
  the committed `instruments/2026.1` (item ids, `bank.sha256`,
  `snapshot.json`) is byte-consistent with a fresh build.
