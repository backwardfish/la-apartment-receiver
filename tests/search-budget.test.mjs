import test from 'node:test';
import assert from 'node:assert/strict';
import { reserveSearch, searchLimits, SearchBudgetError } from '../app/search-budget.ts';
import { budgetStore } from '../app/netlify-search-budget.ts';
import { createSearchHandler } from '../netlify/functions/search.ts';

const now = () => new Date('2026-09-13T12:00:00Z');
// Independent clients share an atomic store, matching create-only/ETag write semantics.
function sharedStore(initial = null) {
  let data = initial, version = initial ? 1 : 0;
  return () => ({
    read: async () => data ? { data: structuredClone(data), etag: String(version) } : null,
    write: async (next, etag) => {
      if ((data && etag !== String(version)) || (!data && etag)) return { modified: false };
      data = structuredClone(next); version++;
      return { modified: true, etag: String(version) };
    },
  });
}

test('shared allowance cannot be overspent by concurrent independent clients', async () => {
  const connect = sharedStore();
  const results = await Promise.allSettled(Array.from({ length: 40 }, () => reserveSearch(connect(), { daily: 5, monthly: 8 }, now)));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 5);
  assert.equal((await connect().read()).data.daily, 5);
  assert.equal((await connect().read()).data.monthly, 5);
  await assert.rejects(reserveSearch(connect(), { daily: 5, monthly: 8 }, now), error => error.code === 'search_allowance_exhausted' && error.retryAfter === 43200);
});

test('allowance survives new clients and resets daily and monthly windows independently', async () => {
  const connect = sharedStore();
  await reserveSearch(connect(), { daily: 1, monthly: 2 }, now);
  await assert.rejects(reserveSearch(connect(), { daily: 1, monthly: 2 }, now), /exhausted/);
  await reserveSearch(connect(), { daily: 1, monthly: 2 }, () => new Date('2026-09-14T12:00:00Z'));
  await assert.rejects(reserveSearch(connect(), { daily: 1, monthly: 2 }, () => new Date('2026-09-15T00:00:00Z')), error => error.code === 'search_allowance_exhausted' && error.retryAfter === 16 * 86400);
  await reserveSearch(connect(), { daily: 1, monthly: 2 }, () => new Date('2026-10-01T00:00:00Z'));
  assert.deepEqual((await connect().read()).data, { version: 1, day: '2026-10-01', month: '2026-10', daily: 1, monthly: 1 });
});

test('storage failures, malformed counters, backwards clocks and contention fail closed', async () => {
  const valid = { version: 1, day: '2026-09-13', month: '2026-09', daily: 1, monthly: 1 };
  for (const initial of [{}, { ...valid, daily: -1 }, { ...valid, monthly: 0 }, { ...valid, day: '2026-09-14' }, { ...valid, day: '2026-99-99' }, { ...valid, version: 2 }]) {
    await assert.rejects(reserveSearch(sharedStore(initial)(), undefined, now), error => error.code === 'search_allowance_unavailable');
  }
  for (const store of [
    { read: async () => { throw Error('private storage error'); } },
    { read: async () => ({ data: valid, etag: '' }) },
    { read: async () => null, write: async () => ({ modified: true, etag: '' }) },
    { read: async () => null, write: async () => ({ modified: false }) },
  ]) await assert.rejects(reserveSearch(store, undefined, now), error => error.code === 'search_allowance_unavailable' && !error.message.includes('private'));
});

test('allowance defaults are bounded and malformed overrides cannot disable the guard', () => {
  assert.deepEqual(searchLimits(() => undefined), { daily: 25, monthly: 50 });
  for (const value of ['', '0', '-1', '1.5', 'Infinity', '25abc', '100000']) {
    assert.throws(() => searchLimits(() => value), /unavailable/);
  }
  assert.deepEqual(searchLimits(key => key.endsWith('_DAY') ? '10' : '40'), { daily: 10, monthly: 40 });
});

test('storage transport rejects false write success even when an error response contains an ETag', async () => {
  for (const status of [401, 403, 429, 500, 503]) {
    let writes = 0;
    const store = budgetStore({ siteID: 'test-site', token: 'test-token', fetcher: async (input, init) => {
      if (String(input).startsWith('https://api.netlify.com/')) return Response.json({ url: 'https://storage.test/usage' });
      assert.equal(init.method, 'put');
      assert.equal(init.headers['if-none-match'], '*');
      writes++;
      return new Response('private upstream body', { status, headers: { etag: 'misleading-etag' } });
    } });
    await assert.rejects(store.write({ version: 1, day: '2026-09-13', month: '2026-09', daily: 1, monthly: 1 }), error => error.code === 'search_allowance_unavailable');
    assert.ok(writes >= 1);
  }
});

test('the overall storage deadline rejects even if a transport stalls', async () => {
  const controller = new AbortController();
  const store = budgetStore({ siteID: 'test-site', token: 'test-token', signal: controller.signal, fetcher: async () => new Promise(() => {}) });
  const result = store.read();
  controller.abort();
  await assert.rejects(result, error => error.code === 'search_allowance_unavailable');
  await assert.rejects(store.read(), error => error.code === 'search_allowance_unavailable');
});

test('budget rejection and outage prevent provider calls and return safe, distinct errors', async t => {
  globalThis.Netlify = { env: { get: key => key === 'LIVE_SEARCH_ENABLED' ? 'true' : key === 'RENTCAST_API_KEY' ? 'test' : undefined } };
  let providerCalls = 0;
  t.mock.method(globalThis, 'fetch', async () => { providerCalls++; throw Error('provider should not run'); });
  t.mock.method(console, 'error', () => {});
  for (const [error, status, code] of [
    [new SearchBudgetError('search_allowance_exhausted', 60), 429, 'search_allowance_exhausted'],
    [Error('private credential error'), 503, 'search_allowance_unavailable'],
  ]) {
    const handler = createSearchHandler(async () => { throw error; });
    const result = await handler(new Request('https://receiver.test/api/search', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: 'loft' }) }), { requestId: 'test-id' });
    assert.equal(result.status, status);
    assert.equal((await result.json()).code, code);
    if (status === 429) assert.equal(result.headers.get('retry-after'), '60');
  }
  assert.equal(providerCalls, 0);
});

test('paused, invalid and unconfigured requests do not consume the shared allowance', async () => {
  let reservations = 0;
  const handler = createSearchHandler(async () => { reservations++; });
  const request = query => new Request('https://receiver.test/api/search', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query }) });
  globalThis.Netlify = { env: { get: () => undefined } };
  assert.equal((await handler(request(''), {})).status, 400);
  assert.equal((await handler(request('loft'), {})).status, 503);
  globalThis.Netlify = { env: { get: key => key === 'LIVE_SEARCH_ENABLED' ? 'false' : 'test' } };
  assert.equal((await handler(request('loft'), {})).status, 503);
  assert.equal(reservations, 0);
});

test('failed provider calls still consume a reservation', async t => {
  const connect = sharedStore();
  const handler = createSearchHandler(() => reserveSearch(connect(), { daily: 1, monthly: 1 }, now));
  globalThis.Netlify = { env: { get: key => key === 'LIVE_SEARCH_ENABLED' ? 'true' : key === 'RENTCAST_API_KEY' ? 'test' : undefined } };
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return new Response('private provider error', { status: 503 }); });
  t.mock.method(console, 'error', () => {});
  const request = () => new Request('https://receiver.test/api/search', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"query":"loft"}' });
  assert.equal((await handler(request(), {})).status, 502);
  assert.equal((await handler(request(), {})).status, 429);
  assert.equal(calls, 1);
});
