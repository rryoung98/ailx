#!/usr/bin/env python3
"""openrouter_images.py — the ONE image-GENERATION client for corpus tooling.

`commons_media.py` is the fetch/licence/encode helper for images somebody else
already made. This is its counterpart for images WE make: the practice corpus
is shallow because found generations are scarce, and the sociocultural family
is the shallowest of all, because a found generation is rarely culturally
specific enough to be culturally WRONG.

Three rules are encoded here, once, and neither pipeline may keep its own copy.

1. MULTI-MODEL IS THE POINT, not a preference. If every synthetic item comes
   from one generator, a candidate learns that generator's fingerprint instead
   of learning to detect synthesis — the same class of failure as the
   aspect-ratio and file-size leaks the corpus already had, and just as
   invisible. So the vetted set spans BOTH provider families available through
   OpenRouter, and deliberately keeps OLDER models: their cruder artefacts are
   the difficulty range the corpus lacks. The model is recorded on every item
   and `packages/report/test/practiceCorpus.test.ts` fails if one model
   dominates.

2. REDISTRIBUTION RIGHTS ARE PER PROVIDER, and are recorded per item. We
   publish this corpus, so "the model returned it" is not a licence. The basis
   below is quoted from the provider's own terms; a model whose provider has
   no basis here cannot be generated, so an unlicensable image cannot reach
   the repository by accident.

3. THE CANDIDATE BUDGET IS NOT THE CORPUS BUDGET. The shared demo proxy exists
   so a visitor can sit T4 with no key of their own. Bulk-generating a corpus
   through it spends their budget, so this client prefers a private key from
   ``AILX_GEN_OPENROUTER_KEY`` and treats the proxy as a small VERIFICATION
   path with a hard per-run call cap.
"""
import base64
import os
import time

import requests

#: Direct OpenRouter, used when a private corpus-building key is present.
DIRECT_URL = "https://openrouter.ai/api/v1/chat/completions"

#: The candidate-facing shared demo. Fallback only, and capped (rule 3).
PROXY_URL = "https://ailx-shared-demo.vercel.app/api/v1/chat/completions"
PROXY_ORIGIN = "https://rryoung98.github.io"

#: The private key. Named apart from the proxy's own OPENROUTER_KEY so the two
#: budgets can never be confused for one another.
KEY_ENV = "AILX_GEN_OPENROUTER_KEY"

#: Most images a single run may take from the shared candidate budget.
PROXY_CALL_CAP = 12

#: Why we may republish a generated image, quoted from the provider's terms.
#: Checked 2026-08-30; see the note in `docs/CREDITS.md`. A provider with no
#: entry here cannot be generated from, which is the point: unclear rights
#: must block the image rather than be argued about after it ships.
RIGHTS_BASIS = {
    "google": (
        'Gemini API Terms, "Use of Generated Content": "Google won\'t claim '
        'ownership over that content." Output carries an invisible SynthID '
        "watermark; AI origin must be disclosed, never denied."
    ),
    "openai": (
        'OpenAI Terms of Use, "Ownership of content": "you ... (b) own the '
        'Output. We hereby assign to you all our right, title, and interest, '
        'if any, in and to Output." C2PA/SynthID provenance embedded; no '
        "competing-model training."
    ),
}

#: OpenRouter itself claims nothing (ToS s6.1: "Your ownership rights in the
#: Output are set forth in the Model Terms for each Model you use."), so the
#: basis to record is always the upstream provider's.
ROUTER_BASIS = (
    'OpenRouter ToS s6.1: model terms flow through; OpenRouter claims no '
    "ownership of Output."
)

#: The vetted models, and the provider family each belongs to. Older models
#: are here ON PURPOSE (rule 1): gemini-2.5-flash-image fails in cruder, more
#: visible ways than the 3.x line, which is the easy end of a difficulty range
#: a one-model corpus cannot have.
MODELS = {
    "google/gemini-3.1-flash-image": "google",
    "google/gemini-3.1-flash-lite-image": "google",
    "google/gemini-3-pro-image": "google",
    "google/gemini-2.5-flash-image": "google",
    "openai/gpt-5-image": "openai",
    "openai/gpt-5-image-mini": "openai",
    "openai/gpt-5.4-image-2": "openai",
}

#: What the shared demo proxy will pass through. Kept in step with
#: `services/openrouter-proxy/api/v1/chat/completions.js`; a model outside it
#: simply needs the private key.
PROXY_MODELS = {
    "google/gemini-3.1-flash-image",
    "google/gemini-3.1-flash-lite-image",
}


class GenerationError(RuntimeError):
    """The model returned no usable image. Never guessed around."""


def provider_of(model):
    """The provider family of a vetted model, or raise. No silent defaults."""
    try:
        return MODELS[model]
    except KeyError:
        raise GenerationError(
            f"{model} is not a vetted model; add it to MODELS with a provider "
            f"that has a RIGHTS_BASIS entry"
        ) from None


def rights_basis(model):
    """The recorded reason we may republish this model's output."""
    return f"{RIGHTS_BASIS[provider_of(model)]} {ROUTER_BASIS}"


def _image_from_choice(payload):
    """Pull the first image out of an OpenRouter chat completion."""
    try:
        message = payload["choices"][0]["message"]
    except (KeyError, IndexError) as exc:
        raise GenerationError(f"no choice in response: {payload}") from exc
    for image in message.get("images") or []:
        url = (image.get("image_url") or {}).get("url", "")
        if url.startswith("data:"):
            header, _, b64 = url.partition(",")
            return base64.b64decode(b64), header[5:].split(";")[0]
    text = (message.get("content") or "")[:200]
    raise GenerationError(f"model returned no image (said: {text!r})")


class ImageClient:
    """One authenticated route to an image model, chosen once and stated.

    ``mode`` is ``"direct"`` when ``AILX_GEN_OPENROUTER_KEY`` is set and
    ``"proxy"`` otherwise. The proxy route is capped, refuses models the shared
    demo does not allow, and is meant for a verification batch, not a corpus.
    """

    def __init__(self, session=None, proxy_cap=PROXY_CALL_CAP):
        self.key = os.environ.get(KEY_ENV, "").strip()
        self.mode = "direct" if self.key else "proxy"
        self.proxy_cap = proxy_cap
        self.calls = 0
        self.spend_usd = 0.0
        self.session = session or requests.Session()
        self.session.headers.update({"User-Agent": "AILX-research/0.1 (corpus tooling)"})

    def _post(self, model, prompt):
        body = {"model": model, "modalities": ["image", "text"],
                "messages": [{"role": "user", "content": prompt}]}
        if self.mode == "direct":
            return self.session.post(
                DIRECT_URL, json=body, timeout=300,
                headers={"Authorization": f"Bearer {self.key}"})
        if model not in PROXY_MODELS:
            raise GenerationError(
                f"{model} is not in the shared-demo allowlist; set {KEY_ENV} "
                f"to generate from it")
        if self.calls >= self.proxy_cap:
            raise GenerationError(
                f"refusing call {self.calls + 1} on the shared CANDIDATE budget "
                f"(cap {self.proxy_cap}); set {KEY_ENV} to build at scale")
        return self.session.post(
            PROXY_URL, json=body, timeout=300,
            headers={"Origin": PROXY_ORIGIN, "Content-Type": "application/json"})

    def _cost(self, generation_id):
        """What the call actually cost, from OpenRouter. Direct mode only."""
        if self.mode != "direct" or not generation_id:
            return None
        for attempt in range(4):
            time.sleep(1 + attempt)
            r = self.session.get("https://openrouter.ai/api/v1/generation",
                                 params={"id": generation_id}, timeout=60,
                                 headers={"Authorization": f"Bearer {self.key}"})
            if r.status_code == 200:
                return float((r.json().get("data") or {}).get("total_cost") or 0.0)
        return None

    def generate(self, model, prompt):
        """One image, with everything needed to reproduce and to licence it.

        Returns a dict of raw bytes, mime, model, provider, the rights basis,
        the OpenRouter generation id and the measured cost. Retries a transient
        failure a few times; raises rather than returning a half-item.
        """
        provider_of(model)  # refuse an unvetted model before spending anything
        last = None
        for attempt in range(3):
            response = self._post(model, prompt)
            self.calls += 1
            if response.status_code in (429, 500, 502, 503, 504):
                last = GenerationError(f"{response.status_code}: {response.text[:200]}")
                time.sleep(5 + 10 * attempt)
                continue
            if response.status_code != 200:
                raise GenerationError(f"{model}: {response.status_code} {response.text[:300]}")
            payload = response.json()
            try:
                raw, mime = _image_from_choice(payload)
            except GenerationError as exc:  # a refusal or a text-only answer
                last = exc
                time.sleep(3)
                continue
            cost = self._cost(payload.get("id"))
            if cost:
                self.spend_usd += cost
            return {
                "bytes": raw,
                "mime": mime,
                "model": model,
                "provider": provider_of(model),
                "rights_basis": rights_basis(model),
                "route": self.mode,
                "generation_id": payload.get("id"),
                "cost_usd": cost,
            }
        raise GenerationError(f"{model} failed after retries: {last}")
