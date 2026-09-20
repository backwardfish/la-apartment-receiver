# LA Apartment Receiver

A source-linked Los Angeles rental research workspace. The LA-only MVP uses a required single-neighborhood selector and Zillow via Apify for live searches. Results require approved HTTPS listing links and images, and retrieval time stays separate from the provider's last-seen time. Every listing still needs an availability check at its original source.

## Live sources

`LISTING_PROVIDER` chooses the live source:

- `zillow-apify` — the MVP source. Zillow rental listings are retrieved through the Apify actor [`igolaizola/zillow-scraper-ppe`](https://apify.com/igolaizola/zillow-scraper-ppe) using `APIFY_TOKEN`. The browser submits one canonical neighborhood plus free-text criteria. The server starts exactly one bounded Actor run (20 records, 120 s Actor timeout, $0.50 maximum charge), returns `202`, and the browser polls `GET /api/search-status?id=` until completion. A finished search for the same normalized brief is reused for 6 hours without a new run.
- `rentcast` — retained only for compatibility/testing. It is never selected implicitly; missing or invalid `LISTING_PROVIDER` fails closed instead of falling back.

> **Known blocker for the RentCast source (confirmed 2026-09-15).** RentCast's published rental-listing schema contains no listing URL, photos, description, or neighborhood ([schema](https://developers.rentcast.io/reference/property-listings-schema)). The adapter's evidence gate therefore rejects every real RentCast record (`tests/providers.test.mjs`, "KNOWN BLOCKER"), and loft/warehouse detection has no text to read. Live search cannot return results until a source that supplies listing links, photos, and descriptions is approved, or the evidence contract is deliberately changed. Do not relax the gate to make a search "work".

For the MVP, geography is structured rather than inferred from prose. The UI requires one supported LA neighborhood from the shared registry in `app/neighborhoods.ts`; API validation, provider coordinates, post-filtering, display labels, and tests all consume that same registry. Free text is reserved for budget, bedrooms, amenities, and style. A brief that asks for a loft or warehouse only shows listings whose own description carries that evidence; a short honest list is preferred to a padded one.

When live search is unavailable, the interface explicitly labels the research snapshot. A missing Google Routes key permits only the documented Santa Monica neighborhood estimates; their upper bound must meet the requested cutoff. Other commute destinations require Routes. Estimates are labeled without a live-traffic claim.

## Develop and verify

Use the Node version in `.nvmrc` (22.23.2) and npm 10.9.8:

```sh
npm ci
npm run verify
npx --no-install netlify dev --offline --no-open
```

`verify` builds and exports the actual Netlify artifact, runs regression tests, lint, and TypeScript checks, checks for configured secrets in public output, and packages the functions. GitHub Actions performs it on Linux and macOS and audits the locked dependencies. No GNU `timeout` or personal shell symlink is required. Restart Netlify Dev after rebuilding so its script-policy headers match the new HTML.

Netlify Dev's local Blobs server does not return an ETag on reads, and the allowance fails closed without one, so a local `.env` with `LIVE_SEARCH_ENABLED=true` permits exactly one live search per local store. Delete `.netlify/blobs-serve` to reset it. Hosted Netlify Blobs return ETags; this is a local limitation only.

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
