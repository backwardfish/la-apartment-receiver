# LA Apartment Receiver

A source-linked Los Angeles rental research workspace. Live searches use RentCast, require approved HTTPS listing links and images, and keep retrieval time separate from the provider's last-seen time. Every listing still needs an availability check at its original source.

When live search is unavailable, the interface explicitly labels the research snapshot. A missing Google Routes key permits only the documented Santa Monica neighborhood estimates; their upper bound must meet the requested cutoff. Other commute destinations require Routes. Estimates are labeled without a live-traffic claim.

## Develop and verify

Use the Node version in `.nvmrc` (22.23.2) and npm 10.9.8:

```sh
npm ci
npm run verify
npx --no-install netlify dev --offline --no-open
```

`verify` builds and exports the actual Netlify artifact, runs regression tests and lint, checks for configured secrets in public output, and packages the functions. GitHub Actions performs it on Linux and macOS. No GNU `timeout` or personal shell symlink is required.

## Production

- Build command: `npm run verify`; publish directory: `dist/client`.
- Native functions: `netlify/functions`; routes: `/api/search` and `/api/health`.
- Production-only `RENTCAST_API_KEY` is required for live searches. Optional `GOOGLE_ROUTES_API_KEY` enables traffic-aware route estimates. No credentials belong in Git or browser storage.
- Set `LIVE_SEARCH_ENABLED=false` and redeploy to pause paid provider calls.
- `/release.json` identifies the client build; `/api/health` identifies the function build and actual Node runtime. Both must show the deployed commit.

Use protected pull requests to update `main`. See [the release and security runbook](docs/SECURITY_AND_RELEASE.md) for configuration, verification, rollback, and limitations.

## Workspace privacy and scope

Search criteria, saved/rejected/compared IDs, and bounded listing records persist in this browser. State expires after 30 days without use, and is removed on the next visit. “Clear saved workspace” removes app-managed storage. Shared-device users and same-origin scripts can access it; there is no cross-device sync or account vault.

Saving and comparison toggles are research aids. They do not contact a landlord or submit an inquiry. Approved external images are loaded directly and can disclose the viewer's IP to their hosts; the browser sends no referring page URL.
