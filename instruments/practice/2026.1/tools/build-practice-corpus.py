#!/usr/bin/env python3
"""build-practice-corpus.py — turn curation.json into corpus.json + assets.

The practice corpus is UNSCORED training material. It must never overlap the
scored T2 bank, so this script is deliberately paranoid:

  1. Every asset is checked against the scored deck's shipped bytes
     (apps/web/public/t2-media) and refused on a collision, and refused again
     if the curated Commons title already appears in the scored bank.
  2. Every licence must match commons_media.OK_LICENSE. No licence, no item.
  3. Every `synthetic` row must have a Commons page that ACTUALLY claims model
     generation, and every `authentic` row must have a page that does NOT.
     Category membership is not evidence: AI categories contain restorations
     of real photographs, and photographs of AI-themed events. The claim is
     read from the file page and the matched marker is recorded in the item.

Output:
  instruments/practice/2026.1/corpus.json   content-addressed practice items
  apps/web/public/practice-media/<12hex>.jpg  the assets themselves

Assets live in the repo, not in Blob storage, because /practice ships in the
STATIC GitHub Pages export, which has no server to sign a Blob URL from. The
budget is enforced by test (packages/report/test/practiceCorpus.test.ts).

Usage: python3 build-practice-corpus.py [--offline]
  --offline  re-derive corpus.json from assets already on disk (no network).
"""
import argparse
import hashlib
import json
import pathlib
import sys
import time

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parents[3]
sys.path.insert(0, str(ROOT / "instruments" / "tools"))

import commons_media as cm  # noqa: E402

#: Why an asset was cropped, and the phrase that records it in the credit.
#: Every crop is a change to somebody else's work, so it is stated, and the
#: reason is curated rather than inferred: a watermark crop removes a badge
#: that would answer the card, a framing crop removes an ASPECT-RATIO leak
#: (see packages/report/test/practiceCorpus.test.ts — generators default to
#: 1:1 and cameras do not, so uncropped ratio would classify the corpus for
#: free). Both are recorded; neither is silent.
CROP_REASONS = {
    "watermark": ", corner cropped to remove a generator watermark",
    "framing": ", cropped to reframe, so the aspect ratio carries no signal",
}

#: What the picture LOOKS like, when that is not photorealistic. A candidate
#: can answer a painterly or rendered image from its style alone and never
#: reach the artefact, so the corpus says which items are answerable that way
#: instead of pretending the bank is uniform.
OK_STYLES = {"painterly", "render"}

#: Encoded-size discipline. Photographs compress LARGE (sensor noise) and
#: generations compress SMALL (smooth gradients), so a corpus encoded to a
#: ceiling alone can be classified by `ls -l` — a shortcut that never looks at
#: a picture. Every asset is therefore encoded towards one common size, and
#: the cap is the hard limit /practice can ship in the static export.
ASSET_AIM_BYTES = 140_000
ASSET_CAP_BYTES = 200_000

CURATION = HERE.parent / "curation.json"
CORPUS = HERE.parent / "corpus.json"
ASSETS = ROOT / "apps" / "web" / "public" / "practice-media"
SCORED_MEDIA = ROOT / "apps" / "web" / "public" / "t2-media"
SCORED_BANK = ROOT / "instruments" / "2026.1" / "tracks" / "t2-discrimination" / "items" / "bank.jsonl"


def scored_fingerprints():
    """(byte hashes, commons titles) the practice corpus may never reuse."""
    hashes = {}
    if SCORED_MEDIA.is_dir():
        for p in sorted(SCORED_MEDIA.glob("*.jpg")):
            hashes[hashlib.sha256(p.read_bytes()).hexdigest()] = p.name
    titles = set()
    if SCORED_BANK.is_file():
        for line in SCORED_BANK.read_text(encoding="utf8").splitlines():
            if not line.strip():
                continue
            prov = (json.loads(line).get("provenance") or {})
            if prov.get("commons_title"):
                titles.add(prov["commons_title"])
    return hashes, titles


def item_id(family, slug):
    return f"practice:{family}:{slug}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--offline", action="store_true")
    args = ap.parse_args()

    curation = json.loads(CURATION.read_text(encoding="utf8"))
    rows = curation["items"]
    banned_hashes, banned_titles = scored_fingerprints()
    ASSETS.mkdir(parents=True, exist_ok=True)

    for row in rows:
        if row["commons_title"] in banned_titles:
            sys.exit(f"REFUSED: {row['commons_title']} is already in the scored bank")
        if row.get("crop") and row.get("crop_reason") not in CROP_REASONS:
            sys.exit(f"REFUSED: {row['slug']} crops without a known crop_reason "
                     f"({sorted(CROP_REASONS)})")
        if row.get("style") and row["style"] not in OK_STYLES:
            sys.exit(f"REFUSED: {row['slug']} has unknown style {row['style']!r}")

    previous = {}
    if CORPUS.is_file():
        previous = {i["id"]: i for i in json.loads(CORPUS.read_text(encoding="utf8"))["items"]}

    if args.offline:
        titles_info, evidence = {}, {}
    else:
        sess = cm.session()
        titles = [r["commons_title"] for r in rows]
        titles_info = cm.imageinfo(sess, titles)
        evidence = cm.page_evidence(sess, titles)

    items, retrieved = [], time.strftime("%Y-%m-%d")
    for row in rows:
        title, slug, family = row["commons_title"], row["slug"], row["family"]
        iid = item_id(family, slug)
        if args.offline:
            prior = previous.get(iid)
            if prior is None:
                sys.exit(f"--offline cannot rebuild {iid}: not in corpus.json")
            items.append(prior)
            continue

        info = titles_info.get(title)
        if info is None:
            sys.exit(f"REFUSED: no imageinfo for {title}")
        if not cm.OK_LICENSE.match(info["license"] or ""):
            sys.exit(f"REFUSED: licence {info['license']!r} for {title}")

        page = evidence.get(title, {})
        haystack = page.get("wikitext", "") + " " + " ".join(page.get("categories", []))
        marker = cm.AI_MARKER.search(haystack)
        if row["key"] == "synthetic" and marker is None:
            sys.exit(f"REFUSED: {title} is curated synthetic but its page claims no generator")
        if row["key"] == "authentic" and marker is not None:
            sys.exit(f"REFUSED: {title} is curated authentic but its page mentions {marker.group(0)!r}")

        crop = row.get("crop")
        data = cm.encode(cm.fetch_bytes(sess, info["thumburl"]),
                         crop=tuple(crop) if crop else None,
                         target=ASSET_CAP_BYTES, aim=ASSET_AIM_BYTES,
                         quality_floor=64)
        digest = hashlib.sha256(data).hexdigest()
        if digest in banned_hashes:
            sys.exit(f"REFUSED: {title} encodes to the scored asset {banned_hashes[digest]}")
        name = cm.content_name(data)
        (ASSETS / f"{name}.jpg").write_bytes(data)

        items.append({
            "id": iid,
            "family": family,
            "key": row["key"],
            "difficulty": row["difficulty"],
            "tell": row["tell"],
            "material": {"kind": "image", "src": f"practice-media/{name}.jpg", "alt": row["alt"],
                         **({"style": row["style"]} if row.get("style") else {})},
            "credit": {
                "commons_title": title,
                "author": info["author"],
                "license": info["license"],
                "source_url": info["source_url"],
                "retrieved": retrieved,
                "derivative": "re-encoded JPEG, max edge 800px"
                              + (CROP_REASONS[row["crop_reason"]] if crop else ""),
                **({"generator_evidence": marker.group(0)} if marker else {}),
            },
        })
        time.sleep(1.5)

    items.sort(key=lambda i: i["id"])
    CORPUS.write_text(json.dumps({
        "version": curation["version"],
        "generated_by": "instruments/practice/2026.1/tools/build-practice-corpus.py",
        "items": items,
    }, ensure_ascii=False, indent=2) + "\n", encoding="utf8")
    write_typescript(curation["version"], items)
    print(f"wrote {CORPUS} with {len(items)} items, and {TS_OUT.name}")


TS_OUT = ROOT / "packages" / "report" / "src" / "practiceCorpus.ts"

TS_HEADER = """/**
 * GENERATED FILE — do not edit by hand.
 *
 * Source of truth: `instruments/practice/2026.1/corpus.json`.
 * Regenerate:     `python3 instruments/practice/2026.1/tools/build-practice-corpus.py`
 * Kept in sync by `packages/report/test/practiceCorpus.test.ts`.
 *
 * The corpus is content-as-data; this module only carries it into the bundle
 * so that `/practice` works in the STATIC export, which can read no file at
 * run time. It reaches no instrument content and performs no I/O.
 */
import type { PracticeItem } from "./practice.js";

/**
 * Version of the corpus, recorded on every practice session so a later
 * content change can never be mistaken for a change in a person's accuracy.
 */
"""


def write_typescript(version, items):
    """Emit the bundle-side corpus module. One pipeline, one command."""
    key_index = {"synthetic": 0, "authentic": 1}
    lines = [TS_HEADER, f"export const PRACTICE_BANK_VERSION = {json.dumps(version)};\n",
             "export const PRACTICE_BANK: readonly PracticeItem[] = ["]
    for item in items:
        out = dict(item)
        out["key"] = key_index[item["key"]]
        body = json.dumps(out, ensure_ascii=False, indent=2)
        lines.append("\n".join("  " + ln for ln in body.splitlines()) + ",")
    lines.append("];\n")
    TS_OUT.write_text("\n".join(lines), encoding="utf8")


if __name__ == "__main__":
    main()
