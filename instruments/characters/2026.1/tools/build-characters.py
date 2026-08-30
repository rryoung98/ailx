#!/usr/bin/env python3
"""build-characters.py — turn accepted generations into the shipped cast.

Input:  `cast.json` (hand-written: code, slug, subject, alt, voice) and
        `generated.json` (the vetting ledger).
Output: `characters.json` (the manifest), the budgeted JPEGs under
        `apps/web/public/characters/`, and the GENERATED TypeScript in
        `packages/report/src/characterCast.ts`.

Why TypeScript and not a fetch: the cast has to render in the STATIC export,
which can read no file at run time, and inside `next/og`, which has no
stylesheet and no DOM. A module the bundler can see is the only shape that
works in both, so the manifest is compiled into one.

Why a re-encode rather than the raw generation: the raw file is a megabyte
and this cast ships on the share card, the gallery wall and the report — the
three surfaces where a slow image is a lost share. The staged original is
git-ignored, so a checkout without it rebuilds from the committed manifest
instead: this build may REUSE work, never invent it.

The asset is square by construction (centre-cropped, then scaled), because a
mixed set of aspect ratios cannot read as one family in a 48px tile.
"""
import hashlib
import io
import json
import pathlib
import sys

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parents[3]
sys.path.insert(0, str(ROOT / "instruments" / "tools"))

import commons_media as cm  # noqa: E402
import generation_ledger as gl  # noqa: E402
from PIL import Image  # noqa: E402

CAST = HERE.parent / "cast.json"
LEDGER = HERE.parent / "generated.json"
MANIFEST = HERE.parent / "characters.json"
STAGING = ROOT / ".ailx-generated" / "characters"
ASSETS = ROOT / "apps" / "web" / "public" / "characters"
TS_OUT = ROOT / "packages" / "report" / "src" / "characterCast.ts"

#: Encoded-size discipline. Sixteen assets ride in the static export and one
#: of them is fetched by the OG rasterizer on every social preview, so the
#: cap is small on purpose. Flat illustration compresses well; a character
#: that will not fit is a busier drawing than the art direction asks for.
ASSET_EDGE = 512
ASSET_AIM_BYTES = 40_000
ASSET_CAP_BYTES = 90_000

#: We publish the cast, and generated output is only ours to publish because
#: the provider's terms say so (recorded per character as `rights_basis`).
LICENSE = "CC0"
AUTHOR = "AILX player-type cast (prompted generation)"


def square_crop(raw):
    """Edge fractions that turn any aspect ratio into a centred square."""
    with Image.open(io.BytesIO(raw)) as im:
        width, height = im.size
    if width == height:
        return None
    if width > height:
        margin = (1 - height / width) / 2
        return (margin, 0.0, margin, 0.0)
    margin = (1 - width / height) / 2
    return (0.0, margin, 0.0, margin)


def store_asset(raw, code):
    """Encode, content-address and write one character asset."""
    data = cm.encode(raw, max_edge=ASSET_EDGE, target=ASSET_CAP_BYTES,
                     aim=ASSET_AIM_BYTES, crop=square_crop(raw), quality_floor=60)
    if len(data) > ASSET_CAP_BYTES:
        sys.exit(f"REFUSED: {code} encodes to {len(data)} bytes, over the "
                 f"{ASSET_CAP_BYTES} budget")
    name = hashlib.sha256(data).hexdigest()[:12]
    ASSETS.mkdir(parents=True, exist_ok=True)
    (ASSETS / f"{name}.jpg").write_bytes(data)
    return name


def asset_name(row, attempt, previous):
    """The content address of this character's shipped asset.

    From the staged original when it is present, otherwise from the manifest
    already committed. A character with neither is a build failure, never a
    guess.
    """
    staged = STAGING / attempt["staged"]
    if staged.is_file():
        raw = staged.read_bytes()
        if hashlib.sha256(raw).hexdigest() != attempt["raw_sha256"]:
            sys.exit(f"REFUSED: {staged.name} does not match the hash recorded "
                     f"when it was generated")
        return store_asset(raw, row["code"])
    prior = previous.get(row["code"])
    if prior is None or not (ASSETS / pathlib.Path(prior["src"]).name).is_file():
        sys.exit(f"REFUSED: {row['code']} has neither a staged original "
                 f"({staged}) nor a built entry to reuse; re-run "
                 f"generate-character-images.py")
    return pathlib.Path(prior["src"]).stem


def character(cast, row, ledger, previous):
    """One manifest entry, refusing anything unvetted or drifted."""
    code = row["code"]
    attempt = gl.accepted(ledger, code)
    if attempt is None:
        sys.exit(f"REFUSED: {code} has no ACCEPTED attempt in {LEDGER.name} — "
                 f"generate it, LOOK at it, then accept or reject it")
    if attempt["model"] != cast["model"]:
        sys.exit(f"REFUSED: {code} was accepted from {attempt['model']} but the "
                 f"cast is drawn by {cast['model']}")
    expected = f"{cast['style_preamble']} {row['subject']}"
    if attempt["prompt"] != expected:
        sys.exit(f"REFUSED: {code} was accepted under a different prompt than the "
                 f"one in {CAST.name}; regenerate rather than rewrite history")
    return {
        "code": code,
        "slug": row["slug"],
        "src": f"characters/{asset_name(row, attempt, previous)}.jpg",
        "alt": row["alt"],
        "voice": row["voice"],
        "credit": {
            "origin": "generated",
            "model": attempt["model"],
            "provider": attempt["provider"],
            # The SUBJECT only. The style preamble is identical for all
            # sixteen and is carried once, next to them: repeating a 1.1 KB
            # paragraph per character would ship 18 KB of the same sentence
            # to every visitor and invite the sixteen copies to drift apart.
            "subject": row["subject"],
            "author": AUTHOR,
            "license": LICENSE,
            "generated": attempt["generated"],
            "vetted": attempt["vetted"],
            "derivative": (f"centre-cropped square, re-encoded JPEG, "
                           f"max edge {ASSET_EDGE}px"),
            "rights_basis": attempt["rights_basis"],
        },
    }


def emit_ts(manifest):
    rows = json.dumps(manifest["characters"], ensure_ascii=False, indent=2)
    rows = "\n".join("  " + line for line in rows.split("\n")).strip()
    TS_OUT.write_text(
        '/**\n'
        ' * GENERATED FILE — do not edit by hand.\n'
        ' *\n'
        ' * Source of truth: `instruments/characters/2026.1/characters.json`.\n'
        ' * Regenerate:     `python3 instruments/characters/2026.1/tools/build-characters.py`\n'
        ' * Kept in sync by `packages/report/test/characters.test.ts`.\n'
        ' *\n'
        ' * Content-as-data carried into the bundle, because the cast has to\n'
        ' * render in the static export (no file system) and in the `next/og`\n'
        ' * rasterizer (no stylesheet). It reaches no instrument content and\n'
        ' * performs no I/O.\n'
        ' */\n'
        'import type { PlayerCharacter } from "./character.js";\n\n'
        f'export const CHARACTER_CAST_VERSION = {json.dumps(manifest["version"])};\n\n'
        '/**\n'
        ' * The art direction, carried once. Prepended to a character\'s own\n'
        ' * `subject` line it reproduces the exact prompt that drew it.\n'
        ' */\n'
        f'export const CHARACTER_STYLE_PROMPT =\n  {json.dumps(manifest["style_preamble"])};\n\n'
        f'export const CHARACTER_CAST: readonly PlayerCharacter[] = {rows};\n',
        encoding="utf8")


def main():
    cast = json.loads(CAST.read_text(encoding="utf8"))
    ledger = gl.load(LEDGER)
    previous = {}
    if MANIFEST.is_file():
        previous = {c["code"]: c
                    for c in json.loads(MANIFEST.read_text(encoding="utf8"))["characters"]}

    characters = [character(cast, row, ledger, previous) for row in cast["characters"]]
    codes = [c["code"] for c in characters]
    if len(set(codes)) != len(codes):
        sys.exit("REFUSED: duplicate codes in cast.json")
    srcs = [c["src"] for c in characters]
    if len(set(srcs)) != len(srcs):
        sys.exit("REFUSED: two characters share one asset — a duplicate picture "
                 "means the cast has sixteen names and fewer than sixteen faces")

    manifest = {
        "version": cast["version"],
        "model": cast["model"],
        "style_preamble": cast["style_preamble"],
        "note": ("Built by tools/build-characters.py. Names and taglines live in "
                 "packages/report/src/playerType.ts and are not repeated here."),
        "characters": characters,
    }
    MANIFEST.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
                        encoding="utf8")
    emit_ts(manifest)

    kept = sorted(p.name for p in ASSETS.glob("*.jpg"))
    live = {pathlib.Path(c["src"]).name for c in characters}
    orphans = [n for n in kept if n not in live]
    total = sum((ASSETS / n).stat().st_size for n in live)
    print(f"{len(characters)} characters, {total // 1024} KB of assets "
          f"(cap {ASSET_CAP_BYTES // 1024} KB each)")
    if orphans:
        print(f"orphaned assets to delete: {orphans}")


if __name__ == "__main__":
    main()
