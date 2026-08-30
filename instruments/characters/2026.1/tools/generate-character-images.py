#!/usr/bin/env python3
"""generate-character-images.py — draw the 16 player-type characters.

`packages/report/src/playerType.ts` already names every type and writes its
tagline. This gives the sixteen a FACE, because the player-type card is the
share surface (docs/UX-DIRECTION.md: "the player-type card is our owl") and a
block of letters does not travel through a feed.

Two rules differ deliberately from the practice corpus generator, and the
difference is the whole design:

  ONE MODEL, ON PURPOSE. The practice corpus spreads across models so that a
  candidate cannot learn one generator's fingerprint. Here the opposite is
  wanted: sixteen pictures that read as ONE family — same line weight, same
  palette, same framing, same scale. Mixing generators guarantees they will
  not. The model is recorded per character regardless.

  ONE STYLE PREAMBLE. `cast.json` holds the art direction once and every
  prompt is preamble + that character's subject line. A per-character style
  paragraph would drift on the sixth character and nobody would notice until
  all sixteen were side by side.

A person still looks at every image (`--accept` / `--reject --reason`), and
the reason is recorded. That gate carries an extra obligation here: a
character that resembles an existing mascot or franchise creature is a legal
and reputational problem, not a taste problem, and it must be rejected.

Usage:
  generate-character-images.py [--only CODE ...] [--force] [--jobs N]
  generate-character-images.py --accept CODE [--reason ...]
  generate-character-images.py --reject CODE --reason "what is wrong with it"
  generate-character-images.py --status

Raw generations stage in `.ailx-generated/characters/` (git-ignored); the
shipped asset is the budgeted re-encode written by `build-characters.py`.
"""
import argparse
import concurrent.futures as futures
import hashlib
import json
import pathlib
import sys

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parents[3]
sys.path.insert(0, str(ROOT / "instruments" / "tools"))

import generation_ledger as gl  # noqa: E402
import openrouter_images as oi  # noqa: E402

CAST = HERE.parent / "cast.json"
LEDGER = HERE.parent / "generated.json"
STAGING = ROOT / ".ailx-generated" / "characters"


def load_cast():
    return json.loads(CAST.read_text(encoding="utf8"))


def prompt_for(cast, row):
    """The FULL prompt: the shared style preamble, then this one subject.

    Built here and recorded per attempt, so a later preamble edit can never be
    mistaken for the prompt an accepted picture was actually drawn from.
    """
    return f"{cast['style_preamble']} {row['subject']}"


def status_report(cast, ledger):
    for row in cast["characters"]:
        attempt = gl.latest(ledger, row["code"])
        state = attempt["status"] if attempt else "not generated"
        print(f"  {row['code']}  {row['slug']:<20} {state}")
    kept = [a for a in ledger["attempts"] if a["status"] == gl.ACCEPTED]
    print(f"\naccepted: {len(kept)}/{len(cast['characters'])}  "
          f"attempts: {len(ledger['attempts'])}  "
          f"measured spend: ${gl.spend(ledger):.4f}")


def vet(ledger, code, status, reason=None):
    if gl.vet(LEDGER, ledger, code, status, reason) is None:
        sys.exit(f"no pending attempt for {code}")
    print(f"{code}: {status}" + (f" - {reason}" if reason else ""))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", nargs="*", default=None, help="type codes to draw")
    ap.add_argument("--force", action="store_true", help="redraw even if an attempt exists")
    ap.add_argument("--jobs", type=int, default=4, help="parallel generations")
    ap.add_argument("--accept", metavar="CODE")
    ap.add_argument("--reject", metavar="CODE")
    ap.add_argument("--reason", default=None)
    ap.add_argument("--status", action="store_true")
    args = ap.parse_args()

    cast, ledger = load_cast(), gl.load(LEDGER)

    if args.status:
        return status_report(cast, ledger)
    if args.accept:
        return vet(ledger, args.accept, gl.ACCEPTED, args.reason)
    if args.reject:
        if not args.reason:
            sys.exit("--reject needs --reason: a rejection nobody explained "
                     "teaches the next run nothing")
        return vet(ledger, args.reject, gl.REJECTED, args.reason)

    rows = cast["characters"]
    if args.only:
        wanted = set(args.only)
        rows = [r for r in rows if r["code"] in wanted]
        missing = wanted - {r["code"] for r in rows}
        if missing:
            sys.exit(f"no cast row for {sorted(missing)}")
    if not args.force:
        rows = [r for r in rows if gl.latest(ledger, r["code"]) is None]
    if not rows:
        return print("nothing to draw (--force to redo)")

    client = oi.ImageClient()
    if client.mode == "proxy":
        sys.exit(f"refusing to draw the cast on the shared CANDIDATE budget; "
                 f"set {oi.KEY_ENV}")
    STAGING.mkdir(parents=True, exist_ok=True)
    model = cast["model"]

    def draw(row):
        prompt = prompt_for(cast, row)
        result = client.generate(model, prompt)
        digest = hashlib.sha256(result["bytes"]).hexdigest()
        suffix = {"image/png": ".png"}.get(result["mime"], ".jpg")
        name = f"{row['code']}-{digest[:8]}{suffix}"
        (STAGING / name).write_bytes(result["bytes"])
        return row, prompt, result, digest, name

    # Sixteen sequential calls is sixteen round trips; the ledger is written on
    # the main thread only, so parallelism cannot interleave two writers.
    with futures.ThreadPoolExecutor(max_workers=max(1, args.jobs)) as pool:
        for future in [pool.submit(draw, r) for r in rows]:
            try:
                row, prompt, result, digest, name = future.result()
            except oi.GenerationError as exc:
                print(f"  FAILED: {exc}")
                continue
            gl.record(ledger, row["code"], prompt, result, digest, name)
            gl.save(LEDGER, ledger)
            print(f"  {row['code']} -> {name} ({len(result['bytes']) // 1024} KB, "
                  f"${result['cost_usd'] or 0:.4f})")

    print(f"\n{client.calls} model calls, measured spend ${client.spend_usd:.4f}. "
          f"Every attempt is PENDING until a person looks at it.")


if __name__ == "__main__":
    main()
