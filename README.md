# LA Apartment Receiver

A source-linked Los Angeles rental search workspace. The interface accepts a natural-language apartment brief, retrieves current provider inventory, preserves exact listing links and freshness timestamps, and can verify drive-time constraints.

## Production search

The Netlify `POST /api/search` function:

- queries active long-term rentals from RentCast;
- enforces parsed budget, bedroom, amenity, location, warehouse-style, and regional requirements;
- rejects records without an exact HTTP(S) listing link or authentic listing image;
- deduplicates repeated records;
- keeps retrieval time separate from the provider's last-seen time;
- uses Google Routes for traffic-aware commute constraints;
- excludes every commute-constrained candidate that cannot be successfully routed;
- fails explicitly instead of presenting demo results as live data; and
- rate-limits callers to protect provider quotas and cost.

The browser clearly labels the static research snapshot whenever live search is unavailable.

## Required Netlify environment variables

Configure secrets in Netlify, never in this repository:

- `RENTCAST_API_KEY` — required for live rental inventory.
- `GOOGLE_ROUTES_API_KEY` — required only for commute-constrained searches. Enable the Google Routes API and restrict the key to server-side use and that API.

Redeploy after adding or rotating either value.

## Local verification

Use Node.js 22.13 or later:

```bash
npm ci
npm test
npm run lint
```

Pull requests run the same production build, regression tests, and lint checks in GitHub Actions.

## Netlify configuration

Netlify uses:

- build command: `npm run build:netlify`
- publish directory: `dist/client`
- function directory: `netlify/functions`

The provider keys remain server-side in the Netlify function.

## Current scope and known limits

- Live structured inventory currently comes from RentCast only.
- Craigslist, Facebook Marketplace, sublease communities, and local property-manager feeds require separate compliant connectors.
- Saved live listings persist for the current browser session; a durable cross-session shortlist is not yet implemented.
- Comparison and inquiry buttons remain labeled preview interactions and do not send messages or submit forms.
- Provider activity is not a guarantee of availability. Live results remain marked as needing confirmation on the original listing page.
