import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createSearchHandler, listingProvider } from '../netlify/functions/search.ts';
import { createSearchStatusHandler } from '../netlify/functions/search-status.ts';
import { cacheKeyFor, isFreshRecord } from '../app/search-records.ts';
import { parseSearchIntent, } from '../app/search-intent.ts';
import { requestLiveSearch } from '../app/live-search.ts';

const sample = JSON.parse(await readFile(new URL('./fixtures/zillow-apify-sample.json', import.meta.url), 'utf8'));
const context = { requestId: 'test-request' };
const post = (query) => new Request('https://receiver.test/api/search', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query }) });
const status = (id) => new Request(`https://receiver.test/api/search-status?id=${id}`);
const env = (overrides = {}) => { globalThis.Netlify = { env: { get: (key) => ({ LIVE_SEARCH_ENABLED: 'true', LISTING_PROVIDER: 'zillow-apify', APIFY_TOKEN: 'apify-secret', ...overrides })[key] } }; };

function memoryStore() {
  const data = new Map();
  const store = {
    get: async (id) => data.get(`search/${id}`) ?? null,
    put: async (record) => { data.set(`search/${record.id}`, structuredClone(record)); },
    cachedSearchId: async (key) => data.get(`cache/${key}`) ?? null,
    rememberCache: async (key, id) => { data.set(`cache/${key}`, id); },
  };
  return { store, data };
}
function apifyFetcher(state = { runStatus: 'RUNNING', items: sample }) {
  const calls = [];
  const fetcher = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).includes('/acts/')) return Response.json({ data: { id: 'run-1', defaultDatasetId: 'ds-1' } }, { status: 201 });
    if (String(url).includes('/actor-runs/')) return Response.json({ data: { status: state.runStatus, usageTotalUsd: 0.03 } });
    if (String(url).includes('/datasets/')) return Response.json(state.items);
    return new Response('unexpected', { status: 500 });
  };
  return { fetcher, calls, state };
}

test('provider selection defaults to RentCast and only an exact zillow-apify value switches', () => {
  assert.equal(listingProvider(() => undefined), 'rentcast');
  assert.equal(listingProvider(() => 'Zillow-Apify '), 'zillow-apify');
  assert.equal(listingProvider(() => 'zillow'), 'rentcast');
});

test('cache keys ignore ranking words but change with areas, budget, features, and style', () => {
  const base = cacheKeyFor(parseSearchIntent('warehouse loft in Arts District under $3,500'));
  assert.equal(cacheKeyFor(parseSearchIntent('quiet sunny warehouse loft in Arts District under $3,500')), base);
  assert.notEqual(cacheKeyFor(parseSearchIntent('warehouse loft in Arts District under $3,000')), base);
  assert.notEqual(cacheKeyFor(parseSearchIntent('warehouse loft in Arts District under $3,500 with parking')), base);
  assert.notEqual(cacheKeyFor(parseSearchIntent('apartment in Arts District under $3,500')), base);
  assert.equal(isFreshRecord({ status: 'done', completedAt: new Date(Date.now() - 5 * 3600_000).toISOString() }), true);
  assert.equal(isFreshRecord({ status: 'done', completedAt: new Date(Date.now() - 7 * 3600_000).toISOString() }), false);
});

test('zillow search reserves once, starts runs with the token in a header, returns 202, then resolves to ranked results and caches them', async (t) => {
  env();
  t.mock.method(console, 'info', () => {}); t.mock.method(console, 'error', () => {});
  const { store, data } = memoryStore();
  const apify = apifyFetcher();
  let reservations = 0;
  const search = createSearchHandler(async () => { reservations++; }, () => store, apify.fetcher);
  const poll = createSearchStatusHandler(() => store, apify.fetcher);

  const started = await search(post('warehouse loft in the Arts District under $3,500'), context);
  assert.equal(started.status, 202);
  const pending = await started.json();
  assert.equal(pending.status, 'pending'); assert.match(pending.searchId, /^[0-9a-f-]{36}$/); assert.equal(pending.total, 1);
  assert.equal(reservations, 1);
  for (const call of apify.calls) { assert.doesNotMatch(call.url, /apify-secret/); assert.equal(call.init.headers.authorization, 'Bearer apify-secret'); }

  const running = await poll(status(pending.searchId), context);
  assert.equal(running.status, 202); assert.equal((await running.json()).finished, 0);

  apify.state.runStatus = 'SUCCEEDED';
  const done = await poll(status(pending.searchId), context);
  assert.equal(done.status, 200);
  const body = await done.json();
  assert.equal(body.status, 'ok');
  assert.deepEqual(body.results.map((listing) => [listing.title, listing.styleGrade, listing.area]), [['130 S Hewitt St APT 31', 'A', 'Arts District'], ['201 S Santa Fe Ave Suite 211', 'B', 'Arts District']]);
  assert.equal(body.results[0].sourceUrl, 'https://www.zillow.com/homedetails/130-S-Hewitt-St-APT-31-Los-Angeles-CA-90012/122236602_zpid/');
  assert.doesNotMatch(JSON.stringify(body), /apify-secret|run-1|ds-1/, 'run identifiers and tokens stay server-side');

  // The same brief within six hours is served from the finished record without a reservation or provider call.
  const callsBefore = apify.calls.length;
  const cached = await search(post('warehouse loft in the Arts District under $3,500'), context);
  assert.equal(cached.status, 200);
  assert.match((await cached.json()).provider, /reused a search finished/);
  assert.equal(reservations, 1); assert.equal(apify.calls.length, callsBefore);
  assert.ok([...data.keys()].some((key) => key.startsWith('cache/')));
});

test('zillow path fails closed without a token, refuses commute briefs, and reports failed or overdue runs honestly', async (t) => {
  t.mock.method(console, 'info', () => {}); t.mock.method(console, 'error', () => {});
  const { store } = memoryStore();
  env({ APIFY_TOKEN: undefined });
  let reservations = 0;
  const noToken = await createSearchHandler(async () => { reservations++; }, () => store, async () => { throw new Error('no provider call expected'); })(post('loft in Arts District'), context);
  assert.equal(noToken.status, 503); assert.equal((await noToken.json()).code, 'search_not_configured'); assert.equal(reservations, 0);
  env();
  const commute = await createSearchHandler(async () => { reservations++; }, () => store, async () => { throw new Error('no provider call expected'); })(post('loft within 30 minutes of Santa Monica'), context);
  assert.equal(commute.status, 503); assert.equal((await commute.json()).code, 'commute_unavailable'); assert.equal(reservations, 0);

  const apify = apifyFetcher({ runStatus: 'FAILED', items: [] });
  const search = createSearchHandler(async () => { reservations++; }, () => store, apify.fetcher);
  const poll = createSearchStatusHandler(() => store, apify.fetcher);
  const pending = await (await search(post('loft in Arts District'), context)).json();
  const failed = await poll(status(pending.searchId), context);
  assert.equal(failed.status, 502); assert.equal((await failed.json()).code, 'search_provider_error');
  assert.equal((await store.get(pending.searchId)).status, 'failed');

  // Overdue searches are failed rather than polled forever; unknown ids and bad ids are distinct.
  const slow = apifyFetcher({ runStatus: 'RUNNING', items: [] });
  const pending2 = await (await createSearchHandler(async () => {}, () => store, slow.fetcher)(post('loft in Arts District under $9,000'), context)).json();
  const late = createSearchStatusHandler(() => store, slow.fetcher, () => new Date(Date.now() + 10 * 60_000));
  assert.equal((await late(status(pending2.searchId), context)).status, 502);
  assert.equal((await poll(status('not-a-uuid'), context)).status, 400);
  assert.equal((await poll(status('00000000-0000-4000-8000-000000000000'), context)).status, 404);
  assert.equal((await poll(new Request('https://receiver.test/api/search-status', { method: 'POST' }), context)).status, 405);
});

test('the browser client follows a pending search to its result and gives up after the deadline', async () => {
  let polls = 0;
  const fetcher = async (url) => {
    if (String(url) === '/api/search') return Response.json({ status: 'pending', searchId: '11111111-2222-4333-8444-555555555555', pollAfterMs: 1, provider: 'Zillow via Apify', total: 1, finished: 0 }, { status: 202 });
    polls++;
    return polls < 3 ? Response.json({ status: 'pending', searchId: '11111111-2222-4333-8444-555555555555', pollAfterMs: 1, provider: 'Zillow via Apify', finished: 0, total: 1 }, { status: 202 })
      : Response.json({ status: 'ok', query: 'loft', searchedAt: new Date().toISOString(), provider: 'Zillow via Apify', results: [] });
  };
  const progress = [];
  const outcome = await requestLiveSearch('loft in Arts District', undefined, (p) => progress.push(p), fetcher, async () => {});
  assert.equal(outcome.status, 'ok'); assert.equal(polls, 3); assert.ok(progress.length >= 3);
  let now = 0;
  const clock = { now: () => now };
  const forever = async () => Response.json({ status: 'pending', searchId: '11111111-2222-4333-8444-555555555555', pollAfterMs: 1, provider: 'Zillow via Apify' }, { status: 202 });
  const realNow = Date.now; Date.now = () => (now += 60_000);
  try { const timeout = await requestLiveSearch('loft', undefined, undefined, forever, async () => {}); assert.equal(timeout.code, 'search_timeout'); }
  finally { Date.now = realNow; void clock; }
});
