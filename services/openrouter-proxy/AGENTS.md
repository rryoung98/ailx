# AGENTS.md — `services/openrouter-proxy`

The shared demo MODEL proxy. It holds no exam content and answers no exam route.
Root [`AGENTS.md`](../../AGENTS.md) has the repository split.

## Why this is still in the public repo

TEN-62 moved the model proxy INTO the exam service and put auth in front of it.
This service stays here anyway.

Checked against the deployed service, not assumed: all six `/v1/model/*` routes
go through `apiRoute`, which refuses an unauthenticated caller with 401 before
reading a body, and `handleChatCompletion` needs a `ProxyContext` that cannot
exist without an `authRef`. There is no anonymous cap and no anonymous route.
So the GitHub Pages export — no service, no identity — keeps
`services/openrouter-proxy`, and it has NO personal-key affordance at all: no
sign-in, no paste box. The static tier issues no score of record, so it does
not need a credential.

Deleting it would leave the static demo with no way to call a model at all.

## Environment

- `AILX_ALLOWED_ORIGINS` — optional comma/whitespace separated list of extra allowed CORS
  origins, e.g. a staging or ngrok deployment. Each entry must be a bare absolute http(s)
  origin with no path or trailing slash; the prod and localhost origins stay allowed and
  `*` / `null` are never accepted. Without it, only GitHub Pages and localhost can call the
  shared demo model.
