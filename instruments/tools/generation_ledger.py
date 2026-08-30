#!/usr/bin/env python3
"""generation_ledger.py — the ONE vetting ledger for images WE generate.

`openrouter_images.py` decides what may be generated and on what rights basis.
This module owns what happens afterwards, because the answer is the same for
every corpus we build: a generation is a PENDING attempt until a person opens
the file, looks at it, and records an accept or a reject with a reason.

The ledger, not the staging directory, is the record that survives. It carries
model, provider, full prompt, date, route, generation id, measured cost, the
redistribution basis and the content hash of the raw bytes — a stronger
provenance record than a scavenged licence page can offer.

Two pipelines use it (the practice corpus and the player-type characters), so
the state machine lives here once rather than being re-typed per pipeline.
"""
import json
import time

#: Vetting states. `pending` is the only state generation may produce.
PENDING, ACCEPTED, REJECTED = "pending", "accepted", "rejected"

DEFAULT_NOTE = "Every generation attempt, vetted by a human before use."


def load(path, note=DEFAULT_NOTE):
    """The ledger at `path`, or an empty one. Never raises on a fresh tree."""
    if path.is_file():
        return json.loads(path.read_text(encoding="utf8"))
    return {"note": note, "attempts": []}


def save(path, ledger):
    path.write_text(json.dumps(ledger, ensure_ascii=False, indent=2) + "\n",
                    encoding="utf8")


def latest(ledger, slug, status=None):
    """The most recent attempt for a slug, optionally in one state."""
    for attempt in reversed(ledger["attempts"]):
        if attempt["slug"] == slug and (status is None or attempt["status"] == status):
            return attempt
    return None


def accepted(ledger, slug):
    """The attempt a build may use: the last one a person accepted."""
    return latest(ledger, slug, ACCEPTED)


def record(ledger, slug, prompt, result, digest, staged):
    """Append one PENDING attempt from an `ImageClient.generate` result."""
    attempt = {
        "slug": slug,
        "status": PENDING,
        "model": result["model"],
        "provider": result["provider"],
        "prompt": prompt,
        "generated": time.strftime("%Y-%m-%d"),
        "route": result["route"],
        "generation_id": result["generation_id"],
        "cost_usd": result["cost_usd"],
        "rights_basis": result["rights_basis"],
        "raw_sha256": digest,
        "raw_bytes": len(result["bytes"]),
        "staged": staged,
    }
    ledger["attempts"].append(attempt)
    return attempt


def vet(path, ledger, slug, status, reason=None):
    """Move the pending attempt for `slug` to `status`, and persist it.

    Returns None when there is nothing pending; the caller decides whether that
    is fatal, because a CLI wants to exit and a batch wants to keep going.
    """
    attempt = latest(ledger, slug, PENDING)
    if attempt is None:
        return None
    attempt["status"] = status
    attempt["vetted"] = time.strftime("%Y-%m-%d")
    if reason:
        attempt["reason"] = reason
    save(path, ledger)
    return attempt


def spend(ledger):
    """Measured spend across every attempt, accepted or not."""
    return sum(a.get("cost_usd") or 0 for a in ledger["attempts"])
