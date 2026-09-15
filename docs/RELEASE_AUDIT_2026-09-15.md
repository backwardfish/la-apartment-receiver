# Release audit — 2026-09-15

Audited at `main` = `dd558ea` (production deploy, paused). Fixes on branch `claude/release-audit-fixes` (two commits).
Environment: Node 22.23.2 / npm 10.9.8 (per `.nvmrc`), Linux; browser checks with headless Chromium against `netlify dev --offline`.

## Status of `main`: NOT READY — live search cannot return a listing

| Area | `main` | Branch (pending deploy + token) | Basis |
|---|---|---|---|
| Core search | FAIL | PARTIAL → PASS after one witnessed live run | RentCast path cannot return listings; Zillow-via-Apify path unit-tested end to end against real dataset rows and mocked Apify REST; real token never exercised from the function. |
| Real listings | FAIL | PARTIAL | Real Zillow rows for the Arts District were pulled through Apify during the audit (see below); the function's own integration awaits `APIFY_TOKEN`. |
| Warehouse/loft relevance | PARTIAL | PASS on the recorded sample | A–D grading matches a loft hunter's read of six real listings; generic/sleeping-loft rows are D and excluded from loft briefs. |
| Save / Reject / Compare | PASS | PASS | Browser-verified on snapshot, mocked live, and async results, including reload. |
| Persistence | PASS | PASS | `receiver:workspace:v4`; new style fields persisted and restored. |
| Source/freshness integrity | PARTIAL | PASS on sample | Exact `zillow.com/homedetails` URLs, `zillowstatic` photos render under CSP, "listed N days ago" from the source. |
| Deployment | PASS | PASS (after merge) | `/release.json`, `/api/health?readiness=1`, CSP hash parity, `search_paused` verified on production; new function packaged with its rate limit. |
| Test/build health | PASS | PASS | `npm ci` clean, `npm run verify` green (89 tests), `npm audit` 0 findings, CI #74 green on main. |
| Security/secrets | PASS | PASS | Token only in `Authorization` header; run/dataset ids never leave the server; fixed log categories; artifact secret scan covers `APIFY_TOKEN`. |

## P0 — the provider

RentCast's published rental-listing schema has no `listingUrl`, `imageUrl`/`photos`, `description`, or `neighborhood`. `normalizeRentCastListing` requires an approved listing URL and photo, so every real record is rejected and `searchRentCast` throws `source_evidence_unavailable`; loft detection reads `description`, so ranking would be blind regardless. Regression test: "KNOWN BLOCKER" in `tests/providers.test.mjs`.

Resolution on this branch: `LISTING_PROVIDER=zillow-apify` uses the Apify actor `igolaizola/zillow-scraper-ppe`. Verified during the audit with three $0.02 sample runs on the owner's Apify account (6 s each):

| Arts District, 1 mi, keyword "loft" | Rent | Grade | Evidence |
|---|---|---|---|
| 130 S Hewitt St #31 (built 1936, 1,201 sqft) | $3,000 | A | 24-ft ceiling, wall of glass, polished concrete floor |
| 1850 Industrial St #706 (Biscuit Company Lofts) | $8,000 | B | live/work, high ceilings; no build year in record |
| 201 S Santa Fe #211 (RiverFront live/work lofts) | $2,600 | B | title only; boilerplate description |
| Barker Block furnished monthly | $7,167 | A + caution | "revitalized early 20th-century warehouse"; 30-night furnished |
| Artisan on 2nd (complex, 2008) | $2.8–3.2k | skipped | building-level row without unit facts |
| 100 S Alameda (Savoy) | $3.1–3.7k | D | "cozy upstairs loft" in a generic condo |

USC (2 mi, "loft"): 0 rows. UCLA (2 mi): 8 rows, all "1 BR with loft" Westside apartments — graded D. This is the market, not the app.

## P1 — fixed on this branch

- Three location clusters were unsupported (single-location parser, "Usc, Los Angeles, CA" geocode with 8-mile radius, no post-filter). Now multi-area intent, one bounded circle per cluster, coordinate post-filter, distance in evidence.
- Loft brief in snapshot mode ranked five generic apartments as 86–94 fit. Now hard-filtered.
- Fit floor of 76 made everything read as a strong match. Now an evidence score (40 base, grade-weighted).
- `bedrooms=1:` → documented `1:*`.
- "Industrial St" in an address counted as loft evidence. Only listing text counts now.
- Static sidebar criteria misrepresented the brief; empty states did not distinguish "provider failed" from "no matches".

## P2

- Fonts 404 in production (machine-specific `.vinext` cache path) — fixed.
- Netlify Dev local Blobs returns no ETag on reads: one local live search per store lifetime; documented with reset workaround. Hosted multi-reservation/exhaustion still only witnessed through synthetic store tests.
- Commute limits are not supported with the Zillow source (503 `commute_unavailable`).
- Apartment-community group rows are skipped; some loft-heavy communities (Artisan on 2nd) therefore do not appear.
- Snapshot data (five 2026-08 LAPMG listings) is useless for the loft brief; consider removing or replacing it.
- Template leftovers (`app/chatgpt-auth.ts`, `db/`, `drizzle/`, `worker/`, `examples/d1`) are unused by the Netlify deployment.

## Verified vs inferred

Verified by running: install; verify pipeline; audits; production endpoints; local functions with invalid RentCast and Apify credentials (401 → 502, redacted logs); local allowance reservation; three real Apify actor runs and their dataset rows; browser flows (search, async progress and polling, save, reject, compare, reload, clear, mobile 390 px, error notices for provider/429/allowance/garbage responses); zillowstatic photo rendering under CSP; font 404 before / 200 after.
Inferred (not witnessed): hosted Blobs ETag behaviour; edge rate limiting; the function's own calls to Apify with a valid token (shape matches the documented REST API and the recorded actor output).
