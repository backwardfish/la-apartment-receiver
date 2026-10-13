# LA Apartment Receiver

A source-linked Los Angeles rental research workspace. The LA-only MVP uses a required selector for one to five neighborhoods and Zillow via Apify for live searches. Results require approved HTTPS listing links and images, and retrieval time stays separate from the provider's last-seen time. Every listing still needs an availability check at its original source.

## Live sources

`LISTING_PROVIDER` chooses the live source:

- `zillow-apify` — the MVP source. Zillow rental listings are retrieved through the Apify actor [`igolaizola/zillow-scraper-ppe`](https://apify.com/igolaizola/zillow-scraper-ppe) using `APIFY_TOKEN`. The browser submits one to five canonical neighborhoods plus free-text criteria, including minimum rent (for example, `at least $2,500`) and rent ranges (for example, `between $2,500 and $4,000`). The server atomically reserves allowance for the full selection and starts one bounded Actor run per neighborhood (20 records, 120 s Actor timeout, $0.50 maximum charge each; at most five runs / $2.50 per search), returns `202`, and the browser polls `GET /api/search-status?id=` until completion. Results from all areas are combined, deduplicated, and ranked globally by fit (with text relevance and distance breaking ties). A finished search for the same normalized selection and ranking brief is reused for 6 hours without a new run.
- `rentcast` — retained only for compatibility/testing. It is never selected implicitly; missing or invalid `LISTING_PROVIDER` fails closed instead of falling back.

> **Known blocker for the RentCast source (confirmed 2026-09-15).** RentCast's published rental-listing schema contains no listing URL, photos, description, or neighborhood ([schema](https://developers.rentcast.io/reference/property-listings-schema)). The adapter's evidence gate therefore rejects every real RentCast record (`tests/providers.test.mjs`, "KNOWN BLOCKER"), and loft/warehouse detection has no text to read. Live search cannot return results until a source that supplies listing links, photos, and descriptions is approved, or the evidence contract is deliberately changed. Do not relax the gate to make a search "work".

For the MVP, geography is structured rather than inferred from prose. The UI requires one to five distinct supported LA neighborhoods from the shared registry in `app/neighborhoods.ts`; API validation, provider coordinates, post-filtering, display labels, and tests all consume that same registry. Free text is reserved for budget, bedrooms, amenities, and style. Loft and warehouse character are ranking preferences. Discovery does not require those words, and listings without architectural evidence stay visible with lower style scores and an explicit uncertainty. Rent, bedrooms, requested amenities, and selected geography remain hard limits.

When live search is unavailable, the interface explicitly labels the research snapshot. A missing Google Routes key permits only the documented Santa Monica neighborhood estimates; their upper bound must meet the requested cutoff. Other commute destinations require Routes. Estimates are labeled without a live-traffic claim.

## Develop and verify

Use the Node version in `.nvmrc` (22.23.2) and npm 10.9.8:

```sh
npm ci
npm run verify
npm run dev
```

`verify` builds the native Next.js static export, copies it to `dist/client`, runs regression tests, lint, and TypeScript checks, checks for configured secrets in public output, and compiles the functions for Node 22 while checking exported routes and platform rate limits. Netlify performs final native function packaging. GitHub Actions performs it on Linux and macOS and audits the locked dependencies. No GNU `timeout` or personal shell symlink is required.

`npm run dev` previews the UI. Native search functions run on Netlify; local UI previews do not establish hosted provider readiness. Production publication is Git-linked through protected `main`. The project does not install the Netlify CLI or a Cloudflare preview runtime.

## Production

- Build command: `npm run verify`; publish directory: `dist/client`.
- Native functions: `netlify/functions`; routes: `/api/search`, `/api/search-status`, and `/api/health`.
- Production-only `APIFY_TOKEN` (with `LISTING_PROVIDER=zillow-apify`) or `RENTCAST_API_KEY` is required for live searches. Optional `GOOGLE_ROUTES_API_KEY` enables traffic-aware route estimates for the RentCast source; commute limits are not yet supported with the Zillow source. No credentials belong in Git or browser storage.
- Set `LIVE_SEARCH_ENABLED=false` and redeploy to pause paid provider calls.
- Shared live-search limits default to 25 per UTC day and 50 per UTC month. The allowance persists across deployments in Netlify Blobs. Invalid settings or unavailable storage block provider calls; failed searches retain their reservation. Optional overrides and provider-call bounds are documented in the runbook.
- `/release.json` identifies the client build; `/api/health` identifies the function build and actual Node runtime. Both must show the deployed commit.
- `/api/health?readiness=1` checks both Blob stores without using a search slot. `/api/health?readiness=1&provider=1` additionally verifies the configured Zillow/Apify Actor can be accessed with the hosted token without starting a paid run. Automatic pull-request previews are disabled to protect shared storage; manually deploy only reviewed preview code.

Use protected pull requests to update `main`. See [the release and security runbook](docs/SECURITY_AND_RELEASE.md) for configuration, verification, rollback, and limitations.

## Workspace privacy and scope

Search criteria, saved/rejected/compared IDs, and bounded listing records persist in this browser. State expires after 30 days without use, and is removed on the next visit. “Clear saved workspace” removes app-managed storage. Shared-device users and same-origin scripts can access it; there is no cross-device sync or account vault.

Saving and comparison toggles are research aids. They do not contact a landlord or submit an inquiry. Approved external images are loaded directly and can disclose the viewer's IP to their hosts; the browser sends no referring page URL.

### Multi-neighborhood compatibility

`POST /api/search` accepts `{ "query": "loft under $3,500", "neighborhoods": ["arts district", "koreatown"] }`.
The legacy `neighborhood` string remains supported. Send only one form; empty, duplicate, unknown, and more-than-five selections return 400 before paid work. Selection order does not change cache identity. This does not add LA-wide search.

Each Zillow area consumes one allowance unit, atomically reserved before any run starts. Partial starts are aborted where possible and are never returned as a complete search. Failed runs retain their allowance. Browser workspace v5 migrates v4 single-area searches and preserves saved listings; server v2 records remain pollable alongside v3 multi-area records.
# Direct-source discovery pilot

The default **Direct sources** view reads public unit listings from L.A. Property Management Group, Orange County Property Management, MCM Property Management, DTLA Management, and Lido Property Management's AppFolio rental pages. It supports LA/OC county scope, rent bounds, bedrooms, required amenities, named supported LA neighborhoods and OC cities, and architectural preference ranking. Existing Zillow search remains accessible in the sidebar.

`/api/direct-sources` fetches five fixed, verified URLs, in parallel with 12-second timeouts and 2 MB response limits. It parses explicit index fields and map coordinates without executing source scripts. Listings require a California city/ZIP combination inside the curated county coverage, a positive rent, bed/bath fields, source photograph, and exact unit link. Incomplete records are omitted. This is a five-manager pilot, not complete county inventory; source descriptions may be abbreviated and pricing can exclude fees.

Inventory is cached in a deploy-scoped Netlify Blobs store for six hours, independently of the user's brief, then re-filtered on each request. Reads trigger refresh after expiry. A failed source is reported independently; previous evidence is shown as stale for at most 24 hours with its original check time. No research snapshot is substituted. All-source failure returns an explicit unavailable response. The pilot uses no paid listing API or Zillow allowance and stores no user queries in the source cache.

Direct listings use the same shortlist, comparison, URL allowlist, and evidence drawers as existing results. Production smoke checks all configured sources, exact links, county and price/bedroom constraints, and function/client revision parity.

## Personal feedback

Cards and the detail drawer offer **Not interested**. Hidden listings are suppressed from discovery, shortlist, and comparison by listing ID or canonical source URL. They remain available in **Hidden**, with immediate Undo and Restore; an optional reason can target price, location, style, layout, or amenities. Hiding removes the unit from saved/compared selections.

The browser applies a reversible ranking adjustment, bounded to ±8 fit points, using similarities to hidden evidence and saved references. An unspecified hide requires several shared traits and has weaker influence; explicit reasons target only that trait. Missing amenities/style evidence is not invented, and hard search requirements remain unchanged. Personalization only orders the retrieved candidates; it does not broaden inventory or train an external model. The card's reasons disclose any adjustment.

Feedback uses the existing browser-only workspace policy: 100 hidden references, allowlisted fields and outbound URLs, 500 KB storage limit, 30 days without use before expiry, no cross-device sync. Version 6 migrates existing saved references without creating preference feedback. Restoring removes negative influence; unsaving removes positive influence; clearing the workspace resets both.

## Reference redesign and hourly recommendations

The supplied HTML design is implemented as a black/red, condensed-type workspace with local bundled display/UI fonts, sharp cards, source evidence, responsive comparison, and mobile Search/Shortlist/Pipeline/Docs navigation. The command summary uses real workspace counts. Pipeline stages (Saved/Touring/Applied/Signed) are user-maintained tracking only; no tours, applications, or signatures are sent. Docs is a six-item readiness checklist, not an ID or financial-document upload vault. Workspace v7 preserves prior saves/hides and adds queue records, pipeline stages, and readiness flags under the same expiry/size policy.

`hourly-recommendations` runs on production at `0 * * * *` UTC (every clock hour in Los Angeles too). It checks the five fixed public manager feeds in parallel and atomically replaces a public source-evidence cache in site-scoped Netlify Blobs. It stores no personal preference data or queries. Failed sources keep original check timestamps for at most24 hours, or report unavailable. Previews use an isolated store; the scheduled job rejects non-production contexts. Initial queue reads seed an empty cache; normal reads reuse it and do not spend Zillow allowance.

`/api/recommendations` filters the hourly source evidence against the current direct-source brief. The browser accumulates up to100 unique recommendations; changing the brief rebuilds the queue, source updates refresh existing units, and unmatched older references expire after24 hours. Saved/hidden units leave the pending queue. When open, it reads after each hourly boundary and catches up when a suspended tab becomes visible. Saves/hides personalize ordering locally; the hosted hourly discovery works while the browser is closed, with private preference ranking applied when opened. Source criteria stay strict, and source availability always needs confirmation.
