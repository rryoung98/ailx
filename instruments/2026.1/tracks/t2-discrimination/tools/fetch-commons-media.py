#!/usr/bin/env python3
"""fetch-commons-media.py — reproducible pipeline for the T2 real-vs-AI image deck.

Both sides of the deck come from the Wikimedia Commons API
(https://commons.wikimedia.org/w/api.php, User-Agent 'AILX-research/0.1'):

  FAKE side: photorealistic AI-generated images curated by hand from
    Category:AI-generated photographs, Category:AI-generated images of
    {animals, architecture, food, nature}. Hard curation rules:
      - only images a human could plausibly mistake for a photograph
      - no identifiable real public figures (spec hard rule)
      - no realistic depictions of private individuals' faces
      - license must be CC0 / CC-BY / CC-BY-SA / Public domain
  REAL side: genuine photographs from Quality/Featured pictures, matched
    by SUBJECT to each fake (mountain lake fake -> mountain lake photo)
    so discrimination hinges on authenticity cues, not subject matter.

For each curated title this script:
  1. downloads the 800px thumburl (with 429 backoff),
  2. re-encodes to progressive JPEG, quality 78 (stepping down to fit
     <= 150 KB), max edge 800px,
  3. writes apps/web/public/t2-media/<first-12-hex-of-sha256-of-bytes>.jpg,
  4. prints a provenance row (author/license from extmetadata) for the bank.

Bank items are appended as canonical-JSON lines (id = sha256 of the
canonical JSON of the item minus `id`); afterwards run:
  node packages/content-tools/dist/cli/hash-bank.js --write \
    instruments/2026.1/tracks/t2-discrimination/items/bank.jsonl
  node packages/content-tools/dist/cli/build-snapshot.js instruments/2026.1

Usage: python3 fetch-commons-media.py <titles.txt> <out-dir>
  titles.txt: one Commons file title per line, e.g. 'File:Cute Hedgehog.jpg'
"""
import json
import pathlib
import sys
import time

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[4] / "tools"))

import commons_media as cm  # noqa: E402

# The fetch, licence and encode rules live in ONE place, shared with the
# practice pipeline (instruments/practice/2026.1/tools/build-practice-corpus.py).
# Two media corpora that must never overlap have to agree on what an
# acceptable asset is, so neither keeps its own copy of the rules.


def main(titles_path, out_dir):
    session = cm.session()
    titles = [t.strip() for t in open(titles_path) if t.strip()]
    for title, info in cm.imageinfo(session, titles, width=800).items():
        if not cm.OK_LICENSE.match(info["license"] or ""):
            print(f"SKIP (license {info['license']!r}): {title}")
            continue
        data = cm.encode(cm.fetch_bytes(session, info["thumburl"]))
        out = f"{out_dir}/{cm.content_name(data)}.jpg"
        with open(out, "wb") as fh:
            fh.write(data)
        print(json.dumps({
            "commons_title": title,
            "file": out,
            "bytes": len(data),
            "author": info["author"],
            "license": info["license"],
            "source_url": info["source_url"],
        }, ensure_ascii=False))
        time.sleep(1.5)


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])
