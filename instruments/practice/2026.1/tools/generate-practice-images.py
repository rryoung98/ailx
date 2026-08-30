#!/usr/bin/env python3
"""generate-practice-images.py — make the synthetic half of the practice corpus.

The corpus is shallow because every synthetic item in it was FOUND: somebody
else generated it and published it under a free licence. Found generations are
mostly landscape, architecture and food, so the sociocultural family is nearly
empty — a picture has to be culturally SPECIFIC before it can be culturally
wrong. This script closes that gap by generating images ourselves, and it is
built around the three things that keep it honest:

  MODEL MIX. The prompts are spread across both provider families and across
  model generations on purpose (see `instruments/tools/openrouter_images.py`).
  One generator's output teaches one generator's fingerprint.

  A HUMAN LOOKS AT EVERY IMAGE. A prompt that asks for an artefact does not
  reliably produce one: models silently "fix" impossible scenes, garble text,
  or answer in an illustration. So generation only ever produces a PENDING
  attempt. A person opens the file, and accepts or rejects it with a reason,
  which is recorded. `build-practice-corpus.py` refuses anything not accepted.

  THE LEDGER IS THE PROVENANCE. Model, full prompt, date, route, generation id
  and the redistribution basis are recorded per attempt, which is a stronger
  provenance record than a scavenged Commons page can offer.

Usage:
  generate-practice-images.py [--only SLUG ...] [--force] [--proxy-cap N]
  generate-practice-images.py --accept SLUG
  generate-practice-images.py --reject SLUG --reason "what is wrong with it"
  generate-practice-images.py --status

Raw generations are staged in `.ailx-generated/` at the repository root, which
is git-ignored: they are megabyte originals, and the SHIPPED asset is the
budgeted re-encode that `build-practice-corpus.py` writes next to the Commons
ones. The ledger, not the staging directory, is the record that survives.
"""
import argparse
import hashlib
import json
import pathlib
import sys

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parents[3]
sys.path.insert(0, str(ROOT / "instruments" / "tools"))

import generation_ledger as gl  # noqa: E402
import openrouter_images as oi  # noqa: E402

CURATION = HERE.parent / "curation.json"
LEDGER = HERE.parent / "generated.json"
STAGING = ROOT / ".ailx-generated"


def generated_rows(curation):
    return [r for r in curation["items"] if r.get("source") == "generated"]


def vet(ledger, slug, status, reason=None):
    if gl.vet(LEDGER, ledger, slug, status, reason) is None:
        sys.exit(f"no pending attempt for {slug}")
    print(f"{slug}: {status}" + (f" - {reason}" if reason else ""))


def status_report(curation, ledger):
    for row in generated_rows(curation):
        attempt = gl.latest(ledger, row["slug"])
        state = attempt["status"] if attempt else "not generated"
        model = attempt["model"] if attempt else row["model"]
        print(f"  {row['slug']:<28} {state:<9} {model}")
    kept = [a for a in ledger["attempts"] if a["status"] == gl.ACCEPTED]
    per_model = {}
    for a in kept:
        per_model[a["model"]] = per_model.get(a["model"], 0) + 1
    print(f"\naccepted: {len(kept)}  models: {per_model}")
    print(f"attempts: {len(ledger['attempts'])}  "
          f"measured spend: ${gl.spend(ledger):.4f}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", nargs="*", default=None, help="slugs to generate")
    ap.add_argument("--force", action="store_true",
                    help="regenerate even if an attempt already exists")
    ap.add_argument("--proxy-cap", type=int, default=oi.PROXY_CALL_CAP,
                    help="most shared-budget calls this run may make")
    ap.add_argument("--accept", metavar="SLUG")
    ap.add_argument("--reject", metavar="SLUG")
    ap.add_argument("--reason", default=None)
    ap.add_argument("--status", action="store_true")
    args = ap.parse_args()

    curation = json.loads(CURATION.read_text(encoding="utf8"))
    ledger = gl.load(LEDGER)

    if args.status:
        return status_report(curation, ledger)
    if args.accept:
        return vet(ledger, args.accept, gl.ACCEPTED, args.reason)
    if args.reject:
        if not args.reason:
            sys.exit("--reject needs --reason: a rejection nobody explained "
                     "teaches the next run nothing")
        return vet(ledger, args.reject, gl.REJECTED, args.reason)

    rows = generated_rows(curation)
    if args.only:
        wanted = set(args.only)
        rows = [r for r in rows if r["slug"] in wanted]
        missing = wanted - {r["slug"] for r in rows}
        if missing:
            sys.exit(f"no generated curation row for {sorted(missing)}")
    if not rows:
        sys.exit("nothing to generate")

    client = oi.ImageClient(proxy_cap=args.proxy_cap)
    if client.mode == "proxy":
        print(f"WARNING: no {oi.KEY_ENV} - falling back to the SHARED CANDIDATE "
              f"budget, capped at {args.proxy_cap} calls this run.")
    STAGING.mkdir(parents=True, exist_ok=True)

    for row in rows:
        slug, model = row["slug"], row["model"]
        if not args.force and gl.latest(ledger, slug) is not None:
            print(f"  {slug}: attempt exists (--force to redo)")
            continue
        print(f"  {slug}: {model} ...", flush=True)
        result = client.generate(model, row["prompt"])
        digest = hashlib.sha256(result["bytes"]).hexdigest()
        suffix = {"image/png": ".png"}.get(result["mime"], ".jpg")
        name = f"{slug}-{digest[:8]}{suffix}"
        (STAGING / name).write_bytes(result["bytes"])
        gl.record(ledger, slug, row["prompt"], result, digest, name)
        gl.save(LEDGER, ledger)
        print(f"     -> {name} ({len(result['bytes']) // 1024} KB, "
              f"${result['cost_usd'] or 0:.4f})")

    print(f"\n{client.calls} model calls, measured spend ${client.spend_usd:.4f}. "
          f"Every attempt is PENDING until a person looks at it.")


if __name__ == "__main__":
    main()
