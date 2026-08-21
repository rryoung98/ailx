# Cohort budget — 45 completions

Goal: fund a full 45-person cohort on one OpenRouter credit pool with hard app-side caps.

## Real prices (OpenRouter, 2026-08-21)
| Use | Model | Price |
|---|---|---|
| T1 vibe coding | openai/gpt-4.1-mini | $0.40/M in · $1.60/M out |
| T4 image drafts/finals | google/gemini-3.1-flash-image | $3.00/M out ≈ **$0.004/image** (~1.3K output tokens/image) |

## Per-run cost with the enforced caps
| Item | Cap | Est. cost |
|---|---|---|
| T1 assist calls | 10 real calls (≈2.5K in + 2K out each) | ≤ $0.042 |
| T4 image generations | 12 real images | ≤ $0.048 |
| **Per run** | | **≤ $0.09** (typical ~$0.05) |

## Cohort budget
- 45 runs × $0.09 = **$4.05** ceiling; with 2× safety (retries, longer prompts, pricier model picks): **fund $10**.
- Caps are enforced in the runners (T1 `REAL_ASSIST_CAP=10`, T4 `REAL_DRAFT_CAP=12`); hitting a cap degrades gracefully (hand-edit / demo model), never blocks completion.
- Demo simulators cost $0 and are always available — a run with no key completes for free.

## Distributing access to the cohort
Do NOT embed a funded key in the public site. Two workable paths:
1. **Provisioned keys**: mint 45 keys with a $0.25 hard limit each via the OpenRouter provisioning API (needs a Provisioning key from the dashboard: POST /api/v1/keys with `limit`), hand one code per participant.
2. **OAuth PKCE** (already built): participants connect their own OpenRouter account; reimburse or gift credits out-of-band.
