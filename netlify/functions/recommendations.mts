import type { Config, Context } from '@netlify/functions';
import { getStore } from '@netlify/blobs';
import { filterDirectListings, type DirectRegion } from '../../app/direct-sources.ts';
import { refreshRecommendationInventory, usableRecommendationInventory, nextRecommendationRefresh, type RecommendationCache } from '../../app/recommendation-inventory.ts';
import { release } from '../../app/release.ts';
import { boundedJson } from './search.ts';
export function recommendationCache(context: Context): RecommendationCache {
  // Public source evidence only. Preview writes cannot reach the production store.
  const name = context.deploy.context === 'production' ? 'receiver-hourly-recommendations-v1' : `receiver-recs-${context.deploy.id}`;
  const store = getStore({ name, consistency: 'strong' });
  return { get: async () => store.get('latest', { type: 'json' }), put: async value => { await store.setJSON('latest', value); } };
}
export const createRecommendationsHandler = (getCache: (context: Context) => RecommendationCache = recommendationCache, fetcher: typeof fetch = fetch, clock: () => Date = () => new Date()) => async (request: Request, context: Context) => {
  const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'x-receiver-release': release.revision, ...(status === 405 ? { allow: 'GET, POST' } : {}) } });
  if (!['GET', 'POST'].includes(request.method)) return reply({ status: 'unavailable', message: 'Use GET or POST.' }, 405);
  let payload: unknown = { query: 'Loft under $3,500', region: 'all' };
  if (request.method === 'POST') {
    if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') return reply({ status: 'unavailable', message: 'Send JSON.' }, 415);
    try { payload = await boundedJson(request); } catch (error) { return reply({ status: 'unavailable', message: 'Invalid search.' }, error instanceof RangeError ? 413 : 400); }
  }
  if (!payload || typeof payload !== 'object' || !('query' in payload) || typeof payload.query !== 'string' || !payload.query.trim() || payload.query.length > 500 || !('region' in payload) || !['all', 'la', 'oc'].includes(String(payload.region))) return reply({ status: 'unavailable', message: 'Enter a brief and a supported area.' }, 400);
  const query = payload.query.trim(), region = payload.region as DirectRegion, now = clock();
  try { filterDirectListings([], query, region, now); } catch (error) { return reply({ status: 'unavailable', message: error instanceof Error ? error.message : 'Unsupported brief.' }, 400); }
  try {
    const cache = getCache(context);
    let inventory = await cache.get();
    // First-use seed only. Normal reads never start an hourly refresh or paid actor.
    if (!usableRecommendationInventory(inventory, now.getTime())) inventory = await refreshRecommendationInventory(cache, fetcher, now);
    const listings = inventory!.inventories.flatMap(part => part.listings);
    return reply({ status: 'ok', query, region, results: filterDirectListings(listings, query, region, now), sources: inventory!.sources, refreshedAt: inventory!.refreshedAt, nextRefreshAt: nextRecommendationRefresh(now.getTime()), stale: now.getTime() - Date.parse(inventory!.refreshedAt) > 90 * 60_000, inventoryCount: listings.length });
  } catch { return reply({ status: 'unavailable', message: 'The recommendation queue could not be loaded. Existing queued listings remain available; retry later.' }, 503); }
};
export default createRecommendationsHandler();
export const config: Config = { path: '/api/recommendations', rateLimit: { windowLimit: 15, windowSize: 60, aggregateBy: ['ip', 'domain'] } };
