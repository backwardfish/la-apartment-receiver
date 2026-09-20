import type { Config } from '@netlify/functions';
import { release } from '../../app/release.ts';
import { budgetStore } from '../../app/netlify-search-budget.ts';
import { searchStore } from '../../app/search-records.ts';
import { probeZillowActor } from '../../app/zillow-apify.ts';

declare const Netlify: { env: { get(key: string): string | undefined } };

export const createHealthHandler = (
  readAllowance = () => budgetStore().read(),
  readSearchStore = () => searchStore().get('00000000-0000-4000-8000-000000000000'),
  probeActor = (token: string) => probeZillowActor({ apifyToken: token }),
) => async (request: Request) => {
  const url = new URL(request.url);
  let allowanceStore: 'reachable' | 'unavailable' | undefined;
  let liveSearchStore: 'reachable' | 'unavailable' | undefined;
  let actorAccessible: boolean | undefined;
  const provider = Netlify.env.get('LISTING_PROVIDER')?.trim().toLowerCase();
  const liveSearchEnabled = Netlify.env.get('LIVE_SEARCH_ENABLED') === 'true';
  const apifyToken = Netlify.env.get('APIFY_TOKEN');
  const providerConfigured = provider === 'zillow-apify' && !!apifyToken;

  if (url.searchParams.get('readiness') === '1') {
    try { await readAllowance(); allowanceStore = 'reachable'; }
    catch { allowanceStore = 'unavailable'; }
    try { await readSearchStore(); liveSearchStore = 'reachable'; }
    catch { liveSearchStore = 'unavailable'; }
  }

  if (url.searchParams.get('provider') === '1') {
    if (providerConfigured) {
      try { await probeActor(apifyToken!); actorAccessible = true; }
      catch { actorAccessible = false; }
    } else {
      actorAccessible = false;
    }
  }

  const providerHealthy = url.searchParams.get('provider') !== '1' || (providerConfigured && actorAccessible === true);
  const available = allowanceStore !== 'unavailable' && liveSearchStore !== 'unavailable' && providerHealthy;
  return new Response(JSON.stringify({
    status: available ? 'ok' : 'degraded',
    release,
    runtimeNode: process.version,
    provider: provider ?? 'unconfigured',
    liveSearchEnabled,
    providerConfigured,
    ...(allowanceStore ? { allowanceStore } : {}),
    ...(liveSearchStore ? { liveSearchStore } : {}),
    ...(actorAccessible !== undefined ? { actorAccessible } : {}),
  }), {
    status: available ? 200 : 503,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
  });
};
export default createHealthHandler();
export const config: Config = { path: '/api/health', rateLimit: { windowLimit: 30, windowSize: 60, aggregateBy: ['ip', 'domain'] } };
