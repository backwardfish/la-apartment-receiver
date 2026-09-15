# Release audit — 2026-09-15

Audited at `main` = `dd558ea` (production deploy, paused). Fixes on branch `claude/release-audit-fixes`.
Environment: Node 22.23.2 / npm 10.9.8 (per `.nvmrc`), Linux; browser checks with headless Chromium against `netlify dev --offline`.

## Status: NOT READY — one P0 outside the codebase

| Area | Result | Basis |
|---|---|---|
| Core search | FAIL | Live path cannot return a listing (see P0). Snapshot path works and is labelled. |
| Real listings | FAIL | No real listing has ever been rendered; provider contract cannot supply one. |
| Warehouse/loft relevance | PARTIAL | Hard filter + ranking verified on synthetic provider records; blind on real RentCast records (no description). |
| Save / Reject / Compare | PASS | Browser-verified on snapshot and mocked live results, including reload. |
| Persistence | PASS | `receiver:workspace:v4`, 30-day expiry, clear button, selections survive zero-result and error searches. |
| Source/freshness integrity | PARTIAL | Snapshot links are real AppFolio pages; freshness/retrieval labels correct; nothing live to verify. |
| Deployment | PASS | `/release.json`, `/api/health?readiness=1`, CSP hash parity, `search_paused` 503 all verified on production. |
| Test/build health | PASS | `npm ci` clean, `npm run verify` green (78 tests after this branch), `npm audit` 0 findings, CI #74 green on main. |
| Security/secrets | PASS | No secrets in repo or artifact; Gitleaks in CI; provider errors redacted; fail-closed allowance. |

## P0 — blocks use

**RentCast cannot power this product as built.** Its published rental-listing schema has no `listingUrl`, `imageUrl`/`photos`, `description`, or `neighborhood`. `normalizeRentCastListing` requires an approved listing URL and photo, so every real record is rejected and `searchRentCast` throws `source_evidence_unavailable` for any non-empty response. Loft/warehouse detection reads `description`, so style ranking would be blind even if the gate were opened. Regression test: "KNOWN BLOCKER" in `tests/providers.test.mjs`. Resolution is a product decision (evidence source), not a code fix.

## P1 — fixed on this branch

- Three location clusters (Arts District/DTLA, USC, UCLA) were not supported: single-location parser, "Usc, Los Angeles, CA" address geocode with an 8-mile radius, no post-filter. Now: multi-area intent, one bounded coordinate circle, coordinate post-filter, distance in evidence.
- "Loft" brief in snapshot mode ranked five generic apartments as 86–94 fit ("Industrial loft with parking" chip). Now hard-filtered.
- Fit floor of 76 made every live result read as a strong match. Now an evidence score (40 base).
- `bedrooms=1:` is not the documented range syntax; now `1:*`.
- "Industrial St" in an address counted as loft evidence; now only the listing's own text counts.
- Static sidebar "Baseline search" misrepresented criteria; now reflects the parsed brief.
- Empty state did not distinguish "provider failed" from "no matches"; now it does.

## P2

- Fonts 404 in production (committed `.vinext` cache used a machine-specific path) — fixed.
- Netlify Dev local Blobs returns no ETag on reads, so only one local live search works per store; documented with reset workaround. Multi-reservation/exhaustion has never been witnessed outside synthetic tests.
- Snapshot data is five 2026-08 LAPMG listings (Hollywood/WeHo/Inglewood/Santa Monica); none fit the loft brief, so snapshot mode is useless for this search.
- Template leftovers: `app/chatgpt-auth.ts`, `db/`, `drizzle/`, `worker/`, `examples/d1` are unused by the Netlify deployment.

## P3

- Commute estimates exist only for Santa Monica destinations without a Routes key.
- Free-text ranking terms are naive substring matches.

## Verified vs inferred

Verified by running: install, verify pipeline, audits, production endpoints, local functions with an invalid key (401 → 502, redacted log), local allowance reservation, browser flows (search, save, reject, compare, reload, clear, mobile 390px, error notices for provider/429/allowance/garbage responses), font 404 before/200 after.
Inferred (not witnessed): hosted Blobs ETag behaviour, platform rate limiting at the edge, any real provider response.
