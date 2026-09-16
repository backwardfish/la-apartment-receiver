import type { Config, Context } from '@netlify/functions';
import { buildLiveSearchRequest, type LiveSearchRequest, type LiveSearchResponse } from '../../app/live-search.ts';
import { isSantaMonicaCommute } from '../../app/commute-estimates.ts';
import { searchRentCast, ProviderError } from '../../app/providers.ts';
import { release } from '../../app/release.ts';
import { reserveNetlifySearch } from '../../app/netlify-search-budget.ts';
import { SearchBudgetError } from '../../app/search-budget.ts';
import { cacheKeyFor, isFreshRecord, searchStore, type SearchRecord, type SearchStore } from '../../app/search-records.ts';
import { startZillowRuns } from '../../app/zillow-apify.ts';

declare const Netlify: { env: { get(key: string): string | undefined } };

export const ZILLOW_PROVIDER_LABEL = 'Zillow via Apify';
export const POLL_AFTER_MS = 3_000;

export function response(body: LiveSearchResponse, status: number, requestId: string, retryAfter?: number) {
  return new Response(JSON.stringify(body), { status, headers: {
    'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store',
    'x-content-type-options': 'nosniff', 'x-request-id': requestId,
    'x-receiver-release': release.revision, ...(status === 405 ? { allow: 'POST' } : {}),
    ...(retryAfter ? { 'retry-after': String(retryAfter) } : {}),
  } });
}

export async function boundedJson(request: Request): Promise<unknown> {
  const maxBytes = 20_000;
  if (Number(request.headers.get('content-length')) > maxBytes) throw new RangeError('payload_too_large');
  const reader = request.body?.getReader();
  if (!reader) return null;
  let bytes = 0;
  let body = '';
  const decoder = new TextDecoder('utf-8', { fatal: true });
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) { await reader.cancel(); throw new RangeError('payload_too_large'); }
      body += decoder.decode(value, { stream: true });
    }
    return JSON.parse(body + decoder.decode());
  } finally { reader.releaseLock(); }
}

/** `LISTING_PROVIDER` selects the live source. RentCast remains the default so existing deployments do not change behaviour. */
export function listingProvider(get: (key: string) => string | undefined): 'rentcast' | 'zillow-apify' {
  return get('LISTING_PROVIDER')?.trim().toLowerCase() === 'zillow-apify' ? 'zillow-apify' : 'rentcast';
}

/** A finished record becomes the success envelope; used by both the cache path and the status poller. */
export function completedEnvelope(record: SearchRecord, cached: boolean): LiveSearchResponse {
  return { status: 'ok', query: record.query, searchedAt: record.completedAt ?? record.createdAt, results: record.results ?? [], provider: cached ? `${ZILLOW_PROVIDER_LABEL} · reused a search finished ${record.completedAt ? new Date(record.completedAt).toISOString() : 'earlier'}` : ZILLOW_PROVIDER_LABEL };
}

export const createSearchHandler = (reserve = reserveNetlifySearch, store: () => SearchStore = () => searchStore(), fetcher: typeof fetch = fetch) => async (request: Request, context: Context) => {
  const requestId = context?.requestId || crypto.randomUUID();
  const unavailable = (code: string, message: string, status: number, retryAfter?: number) => response({ status: code === 'search_not_configured' ? 'unconfigured' : 'unavailable', code, message }, status, requestId, retryAfter);
  if (request.method !== 'POST') return unavailable('method_not_allowed', 'Use POST to run a live apartment search.', 405);
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') return unavailable('unsupported_media_type', 'Send the apartment search as JSON.', 415);
  let payload: unknown;
  try { payload = await boundedJson(request); }
  catch (error) { return error instanceof RangeError ? unavailable('payload_too_large', 'The apartment search request is too large.', 413) : unavailable('invalid_request', 'Send a valid apartment search.', 400); }
  if (!payload || typeof payload !== 'object' || !('query' in payload) || typeof payload.query !== 'string') return unavailable('invalid_request', 'A non-empty apartment search is required.', 400);
  let normalized: LiveSearchRequest;
  try { normalized = buildLiveSearchRequest(payload.query); }
  catch { return unavailable('invalid_request', 'Enter an apartment search between 1 and 500 characters.', 400); }
  if (Netlify.env.get('LIVE_SEARCH_ENABLED') !== 'true') {
    console.info(JSON.stringify({ event: 'search_paused', requestId }));
    return unavailable('search_paused', 'Live search is paused. The research snapshot is available below.', 503);
  }
  const provider = listingProvider(key => Netlify.env.get(key));
  if (provider === 'zillow-apify') return zillowSearch(normalized, requestId, unavailable, reserve, store, fetcher);

  const rentCastApiKey = Netlify.env.get('RENTCAST_API_KEY');
  const googleRoutesApiKey = Netlify.env.get('GOOGLE_ROUTES_API_KEY');
  const usingEstimate = !!normalized.intent.commute && !googleRoutesApiKey && isSantaMonicaCommute(normalized.intent.commute.origin);
  if (!rentCastApiKey) return unavailable('search_not_configured', 'Live search is not configured. The research snapshot is available below.', 503);
  if (normalized.intent.commute && !googleRoutesApiKey && !usingEstimate) return unavailable('commute_unavailable', 'Commute estimates currently cover Santa Monica only. Try another search without a commute limit.', 503);
  try {
    await reserve(key => Netlify.env.get(key));
  } catch (error) {
    if (error instanceof SearchBudgetError && error.code === 'search_allowance_exhausted') {
      return unavailable(error.code, 'The shared live-search allowance has been reached. Please try again after it resets; the research snapshot remains available.', 429, error.retryAfter);
    }
    console.error(JSON.stringify({ event: 'search_allowance_unavailable', requestId }));
    return unavailable('search_allowance_unavailable', 'Live search is temporarily unavailable while its usage allowance cannot be checked. Please try again later.', 503);
  }
  try {
    const results = await searchRentCast(normalized, { rentCastApiKey, googleRoutesApiKey });
    return response({ status: 'ok', query: normalized.query, searchedAt: new Date().toISOString(), results, provider: usingEstimate ? 'RentCast + neighborhood commute estimates' : normalized.intent.commute ? 'RentCast + Google Routes' : 'RentCast' }, 200, requestId);
  } catch (error) {
    // Provider errors can contain credentials, URLs, or search inputs. Log only fixed categories.
    console.error(JSON.stringify({ event: 'live_search_failed', requestId, code: error instanceof ProviderError ? error.code : 'provider_failure' }));
    const message = error instanceof ProviderError && error.code === 'source_evidence_unavailable'
      ? 'The provider returned listings without usable source links or photos. Live results are unavailable; the research snapshot is shown separately.'
      : 'The live-search provider is unavailable. Please try again shortly.';
    return unavailable('search_provider_error', message, 502);
  }
};

async function zillowSearch(normalized: LiveSearchRequest, requestId: string, unavailable: (code: string, message: string, status: number, retryAfter?: number) => Response, reserve: typeof reserveNetlifySearch, store: () => SearchStore, fetcher: typeof fetch) {
  const apifyToken = Netlify.env.get('APIFY_TOKEN');
  if (!apifyToken) return unavailable('search_not_configured', 'Live search is not configured. The research snapshot is available below.', 503);
  if (normalized.intent.commute) return unavailable('commute_unavailable', 'Commute limits are not yet supported with the Zillow provider. Try the same search without a drive-time limit.', 503);
  const cacheKey = cacheKeyFor(normalized.intent);
  let records: SearchStore;
  try {
    records = store();
    const cachedId = await records.cachedSearchId(cacheKey);
    const cached = cachedId ? await records.get(cachedId) : null;
    if (cached && isFreshRecord(cached)) {
      console.info(JSON.stringify({ event: 'search_cache_hit', requestId }));
      return response(completedEnvelope(cached, true), 200, requestId);
    }
  } catch {
    console.error(JSON.stringify({ event: 'search_store_unavailable', requestId }));
    return unavailable('search_store_unavailable', 'Live search is temporarily unavailable while its search storage cannot be reached. Please try again later.', 503);
  }
  try {
    await reserve(key => Netlify.env.get(key));
  } catch (error) {
    if (error instanceof SearchBudgetError && error.code === 'search_allowance_exhausted') {
      return unavailable(error.code, 'The shared live-search allowance has been reached. Please try again after it resets; the research snapshot remains available.', 429, error.retryAfter);
    }
    console.error(JSON.stringify({ event: 'search_allowance_unavailable', requestId }));
    return unavailable('search_allowance_unavailable', 'Live search is temporarily unavailable while its usage allowance cannot be checked. Please try again later.', 503);
  }
  try {
    const runs = await startZillowRuns(normalized, { apifyToken }, fetcher);
    const record: SearchRecord = { version: 1, id: crypto.randomUUID(), createdAt: new Date().toISOString(), query: normalized.query, provider: 'zillow-apify', cacheKey, runs, status: 'running' };
    await records.put(record);
    console.info(JSON.stringify({ event: 'live_search_started', requestId, runs: runs.length }));
    return response({ status: 'pending', searchId: record.id, pollAfterMs: POLL_AFTER_MS, provider: ZILLOW_PROVIDER_LABEL, finished: 0, total: runs.length, elapsedMs: 0 }, 202, requestId);
  } catch (error) {
    console.error(JSON.stringify({ event: 'live_search_failed', requestId, code: error instanceof ProviderError ? error.code : 'provider_failure' }));
    return unavailable('search_provider_error', 'The live-search provider is unavailable. Please try again shortly.', 502);
  }
}
export default createSearchHandler();

// Platform enforcement is distributed; do not substitute an in-memory counter.
export const config: Config = { path: '/api/search', rateLimit: { windowLimit: 15, windowSize: 60, aggregateBy: ['ip', 'domain'] } };
