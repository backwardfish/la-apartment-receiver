# Security and release runbook

## Configuration parity

| Setting | Local and CI | Netlify preview | Netlify production |
|---|---|---|---|
| Node build version | `.nvmrc`: 22.23.2 | 22.23.2 | 22.23.2 |
| npm / CLI | 10.9.8 / locked Netlify CLI 27.5.2 | Same lockfile | Same lockfile |
| Install and verification | `npm ci`, `npm run verify` | Same | Same; clean tracked tree required |
| Output / functions | `dist/client` / `netlify/functions` | Same | Same |
| Function runtime | Local Node 22 | `nodejs22.x` | `nodejs22.x`; hosted patch managed by Netlify |
| Provider credentials | Synthetic tests; optional local `.env` | No production values; separate preview keys only if needed | Production-specific RentCast and optional Routes values |
| Next.js integration | Custom Vinext static export | `NETLIFY_NEXT_PLUGIN_SKIP=true` | Same; no Next.js server is deployed |
| Routes | Native paths under Netlify Dev | `/api/search`, `/api/health` | Same |

`dist/server` is a build-time rendering input, not the publish directory. Public artifact checks cover `dist/client`. Keep `.env`, `.netlify`, runtime caches, and generated release files out of Git.

HTML post-processing is disabled so generated inline scripts retain their CSP hashes. Restart Netlify Dev after rebuilding: a running local server can retain an older `_headers` configuration while serving the new HTML. Verify all inline hashes against the headers of the deployed response, not only the files on disk.

## Secrets and provider controls

- `RENTCAST_API_KEY`: search function only. `GOOGLE_ROUTES_API_KEY`: optional route matrix calls only. The legacy `OPENAI_HOUSEHUNTER` value has no consumer in this application; remove it after confirming no external integration depends on it.
- The site's current Netlify plan rejects Functions-only environment scope. Production-only values isolate previews and development, but remain visible to production builds. `check-public-artifact.mjs` stops publication if a configured provider credential appears in public output. This is a compensating control, not equivalent to Functions-only scope.
- Netlify Secrets Controller returns masked values through management APIs outside its hosted runtime. Do not use those placeholders for provider probes or overwrite a stored production value with them. Test credentials through the deployed function; hosted build scanning checks the real values.
- Never print values, embed keys in frontend environment variables, or copy signed deployment URLs into commands or tickets. Use authenticated CLI or Git deployment. For exposure, invalidate the capability or underlying credential first, then clean shared copies and review deploy/access records.
- `LIVE_SEARCH_ENABLED=false` stops provider calls before fetching. Redeploy after changing it or provider credentials. Restore live search only after a bounded provider smoke test succeeds.
- The platform limits searches to 15 per 60 seconds per IP/domain. Bodies are capped at 20,000 actual bytes, queries at 500 characters, RentCast results at 50, and route-matrix origins at 49. Each provider request has a 12-second deadline and refuses redirects.
- Platform enforcement can lag and is not a global spending ceiling. Set RentCast account quotas and Google API quotas/budget alerts before wider use; alerts alone do not cap spend. Distributed callers can still consume a shared provider allowance. Keep the pause control available.

## Data and browser boundaries

`trusted-origins.json` is the shared URL/CSP allowlist. Approve new providers deliberately, with source paths and photos checked against real responses. Require HTTPS, reject embedded credentials and deceptive hosts, and render text through React. No submitted listing/image URL is fetched by a server in this application. Adding an image proxy or scraper would require private-network/DNS/redirect protections first.

Provider-supplied links, photos, amenities, and timestamps remain claims. Missing evidence is an unavailable result, not an invented listing. Negative amenity statements must not satisfy a requested feature. Empty results, invalid requests, missing configuration, and provider failures remain distinct.

Commute estimates use the upper bound: 40–45 minutes qualifies for a 45-minute cap; 45–50 does not. Unknown areas cannot qualify by default. A failed Google Routes call does not silently become a successful estimate.

Local storage uses a bounded versioned schema, discards unknown fields, downgrades stored verification claims, and expires on a later visit after 30 inactive days. It contains no credential fields; users should avoid entering sensitive personal data into free-text searches. Browser storage is not encrypted account storage. Only app-managed workspace keys are removed by the clear button.

Logs contain fixed error categories (including provider HTTP status) and a request ID. Do not add request bodies, raw provider errors, authorization headers, signed URLs, or full listing payloads. Public errors carry safe messages and a correlation ID.

## Release procedure

1. Open a pull request. Required `release-gate` checks both Linux and macOS production builds, regression tests, lint, and native function packaging. `main` disallows direct/force pushes and deletion, including administrator bypass. The single-owner configuration requires a PR but zero independent reviewer approvals; do not call this independent review.
2. Merge only after required checks pass. Git-linked Netlify production builds protected `main` using `npm run verify`; a failed build must not replace the current deploy. Preview builds never receive production provider values.
3. Record full commit SHA, CI run URL, Netlify deploy ID/time, and previous deploy ID. Compare `/release.json`, `/api/health`, Netlify `commit_ref`, and the selected Git revision. `release.dirty` must be false. The search response's `x-receiver-release` must match.
4. Check safe invalid requests, a bounded live search, source links/images, truthful fallback labels, save/reload/clear, and desktop/mobile behavior. Verify a 45-minute Santa Monica cutoff with passing and failing upper-bound examples. A deploy marked ready does not prove valid provider credentials.
5. Exercise rate rejection with invalid requests so testing does not use paid provider calls. Check native/custom paths and spoofed client headers. Netlify Dev does not prove edge enforcement; test a deployed environment.

Emergency manual release uses pinned `npm run deploy:production` from a clean, reviewed revision with passing CI and the correct linked site. It verifies before deploying; record the same provenance. Routine deployment must not depend on temporary MCP proxy URLs.

For rollback, republish the last known-good Netlify deploy, verify client/function release IDs again, and pause provider calls if needed. Rollback can restore older security behavior: use it only to contain a regression, then ship a corrected forward release. Do not reuse a deploy merely because it was previously live.

## Dependency follow-up

Run `npm audit` and `npm audit --omit=dev`, trace findings to their owning tool, and assess deployed reachability. Production dependency audit is not a complete security audit. Old MCP warnings for `glob@10.5.0` and `cron-parser@4.9.0` belong to the retired upload workflow; the locked replacement CLI uses newer versions.

The September 2026 patch set updates Next/React/Vite and compatible transitive dependencies, and pins patched Sharp 0.35.4. Remaining development-tool findings are the Drizzle Kit loader's old esbuild and Vinext's image-size dependency. Neither development server nor image parser is exposed by the static Netlify app. Avoid exposing local development servers or processing untrusted images through those tools. Track supported upstream fixes; do not force a breaking framework migration or downgrade merely to erase an audit count.

References: [Netlify rate limits](https://docs.netlify.com/manage/security/secure-access-to-sites/rate-limiting/), [environment contexts/scopes](https://docs.netlify.com/build/environment-variables/overview/), [GitHub branch protection](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches), [Google API key restrictions](https://developers.google.com/maps/api-security-best-practices).
