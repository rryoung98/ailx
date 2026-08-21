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
import hashlib, io, json, re, sys, time

import requests
from PIL import Image

API = "https://commons.wikimedia.org/w/api.php"
UA = {"User-Agent": "AILX-research/0.1"}
OK_LICENSE = re.compile(r"^(CC0|CC BY(-SA)? \d|Public domain|PD)", re.I)


def api(session, **params):
    params.update(action="query", format="json")
    for attempt in range(6):
        r = session.get(API, params=params, timeout=30)
        if r.status_code == 429:
            time.sleep(3 + 3 * attempt)
            continue
        r.raise_for_status()
        return r.json()
    r.raise_for_status()


def fetch_bytes(session, url):
    for attempt in range(8):
        r = session.get(url, timeout=60)
        if r.status_code == 429:
            time.sleep(8 + 5 * attempt)
            continue
        r.raise_for_status()
        return r.content
    raise RuntimeError(f"persistent 429 for {url}")


def strip_tags(s):
    return re.sub(r"<[^>]+>", "", s or "").strip()


def encode(raw, max_edge=800, target=150_000):
    im = Image.open(io.BytesIO(raw)).convert("RGB")
    im.thumbnail((max_edge, max_edge))
    q = 78
    while True:
        buf = io.BytesIO()
        im.save(buf, "JPEG", quality=q, optimize=True, progressive=True)
        data = buf.getvalue()
        if len(data) <= target or q <= 50:
            return data
        q -= 6


def main(titles_path, out_dir):
    session = requests.Session()
    session.headers.update(UA)
    titles = [t.strip() for t in open(titles_path) if t.strip()]
    for i in range(0, len(titles), 50):
        j = api(session, titles="|".join(titles[i : i + 50]), prop="imageinfo",
                iiprop="url|extmetadata|size", iiurlwidth=800)
        for page in j["query"]["pages"].values():
            if "imageinfo" not in page:
                continue
            ii = page["imageinfo"][0]
            em = ii.get("extmetadata", {})
            license_ = strip_tags(str(em.get("LicenseShortName", {}).get("value", "")))
            if not OK_LICENSE.match(license_):
                print(f"SKIP (license {license_!r}): {page['title']}")
                continue
            raw = fetch_bytes(session, ii.get("thumburl") or ii["url"])
            data = encode(raw)
            digest = hashlib.sha256(data).hexdigest()[:12]
            out = f"{out_dir}/{digest}.jpg"
            with open(out, "wb") as f:
                f.write(data)
            print(json.dumps({
                "commons_title": page["title"],
                "file": out,
                "bytes": len(data),
                "author": strip_tags(str(em.get("Artist", {}).get("value", ""))),
                "license": license_,
                "source_url": ii["descriptionurl"],
            }, ensure_ascii=False))
            time.sleep(1.5)


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])
