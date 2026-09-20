import type { Config, Context } from '@netlify/functions';
import { buildLiveSearchRequest } from '../../app/live-search.ts';
import { ProviderError } from '../../app/providers.ts';
import { SEARCH_ID_PATTERN, searchStore, type SearchRecord, type SearchStore } from '../../app/search-records.ts';
import { pollZillowRuns, SEARCH_DEADLINE_MS } from '../../app/zillow-apify.ts';
import { completedEnvelope, POLL_AFTER_MS, response, ZILLOW_PROVIDER_LABEL } from './search.ts';

declare const Netlify: { env: { get(key: string): string | undefined } };

const failureMessage = (code?: string) => `The live-search provider did not finish this search${code ? ` (${code})` : ''}. Please try again shortly.`;

/**
 * Progress endpoint for asynchronous provider runs. It never starts provider
 * work or reserves allowance; it only reads run status and, once every run has
 * succeeded, downloads and ranks the results exactly once per search.
 */
export const createSearchStatusHandler = (store: () => SearchStore = () => searchStore(), fetcher: typeof fetch = fetch, now: () => Date = () => new Date()) => async (request: Request, context: Context) => {
  const requestId = context?.requestId || crypto.randomUUID();
  const unavailable = (code: string, message: string, status: number) => response({ status: 'unavailable', code, message }, status, requestId);
  if (request.method !== 'GET') return unavailable('method_not_allowed', 'Use GET to check a live search.', 405);
  const id = new URL(request.url).searchParams.get('id') ?? '';
  if (!SEARCH_ID_PATTERN.test(id)) return unavailable('invalid_request', 'A valid search id is required.', 400);
  let records: SearchStore;
  let record: SearchRecord | null;
  try { records = store(); record = await records.get(id); }
  catch { console.error(JSON.stringify({ event: 'search_store_unavailable', requestId })); return unavailable('search_store_unavailable', 'Live search is temporarily unavailable while its search storage cannot be reached. Please try again later.', 503); }
  if (!record) return unavailable('search_not_found', 'That live search is no longer available. Start a new search.', 404);
  if (record.status === 'done') return response(completedEnvelope(record, false), 200, requestId);
  if (record.status === 'failed') return unavailable('search_provider_error', failureMessage(record.code), 502);
  const apifyToken = Netlify.env.get('APIFY_TOKEN');
  if (!apifyToken) return unavailable('search_not_configured', 'Live search is not configured.', 503);
  const elapsedMs = now().getTime() - Date.parse(record.createdAt);
  const fail = async (code: string) => {
    console.error(JSON.stringify({ event: 'live_search_failed', requestId, code }));
    try { await records.put({ ...record, status: 'failed', code, completedAt: now().toISOString() }); } catch { /* the failure is already reported to the caller */ }
    return unavailable('search_provider_error', failureMessage(code), 502);
  };
  if (elapsedMs > SEARCH_DEADLINE_MS) return fail('apify_search_deadline');
  try {
    const poll = await pollZillowRuns(record.runs, buildLiveSearchRequest(record.query, record.neighborhood), { apifyToken }, fetcher, now());
    if (poll.status === 'running') return response({ status: 'pending', searchId: record.id, pollAfterMs: POLL_AFTER_MS, provider: ZILLOW_PROVIDER_LABEL, finished: poll.finished, total: poll.total, elapsedMs }, 202, requestId);
    if (poll.status === 'failed') return fail(poll.code);
    const done: SearchRecord = { ...record, status: 'done', results: poll.results, completedAt: now().toISOString(), usageUsd: poll.usageUsd };
    await records.put(done);
    try { await records.rememberCache(done.cacheKey, done.id); } catch { /* a missing cache entry only costs a future run */ }
    console.info(JSON.stringify({ event: 'live_search_completed', requestId, results: poll.results.length, usageUsd: poll.usageUsd ?? null }));
    return response(completedEnvelope(done, false), 200, requestId);
  } catch (error) {
    if (error instanceof ProviderError && error.code === 'source_evidence_unavailable') {
      await fail(error.code);
      return unavailable('search_provider_error', 'The provider returned listings without usable source links or photos. Live results are unavailable; the research snapshot is shown separately.', 502);
    }
    if (error instanceof ProviderError && error.code === 'search_store_unavailable') return unavailable('search_store_unavailable', 'Live search is temporarily unavailable while its search storage cannot be reached. Please try again later.', 503);
    // Transient Apify errors (rate limit, 5xx) leave the record running so the client can keep polling until the deadline.
    console.error(JSON.stringify({ event: 'live_search_poll_failed', requestId, code: error instanceof ProviderError ? error.code : 'provider_failure' }));
    return response({ status: 'pending', searchId: record.id, pollAfterMs: POLL_AFTER_MS * 2, provider: ZILLOW_PROVIDER_LABEL, elapsedMs }, 202, requestId);
  }
};
export default createSearchStatusHandler();

export const config: Config = { path: '/api/search-status', rateLimit: { windowLimit: 60, windowSize: 60, aggregateBy: ['ip', 'domain'] } };
