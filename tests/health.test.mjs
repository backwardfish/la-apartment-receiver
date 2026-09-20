import test from 'node:test';
import assert from 'node:assert/strict';
import { createHealthHandler } from '../netlify/functions/health.ts';

const env = (overrides = {}) => {
  globalThis.Netlify = { env: { get: (key) => ({ LIVE_SEARCH_ENABLED: 'true', LISTING_PROVIDER: 'zillow-apify', APIFY_TOKEN: 'apify-secret', ...overrides })[key] } };
};

test('basic health checks do not read shared storage or probe the provider', async () => {
  env();
  const handler = createHealthHandler(
    () => { throw Error('should not read allowance storage'); },
    () => { throw Error('should not read search storage'); },
    () => { throw Error('should not probe provider'); },
  );
  const response = await handler(new Request('https://receiver.test/api/health'));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.allowanceStore, undefined);
  assert.equal(body.liveSearchStore, undefined);
  assert.equal(body.actorAccessible, undefined);
  assert.equal(body.provider, 'zillow-apify');
  assert.equal(body.providerConfigured, true);
});

test('readiness reports both Blob stores without exposing counters, credentials, or raw errors', async () => {
  env();
  for (const [readAllowance, readSearch, status, allowanceLabel, searchLabel] of [
    [async () => ({ data: { privateValue: 'sensitive' } }), async () => null, 200, 'reachable', 'reachable'],
    [async () => { throw Error('sensitive credential error'); }, async () => null, 503, 'unavailable', 'reachable'],
    [async () => null, async () => { throw Error('private search record'); }, 503, 'reachable', 'unavailable'],
  ]) {
    const response = await createHealthHandler(readAllowance, readSearch)(new Request('https://receiver.test/api/health?readiness=1'));
    assert.equal(response.status, status);
    const body = await response.text();
    assert.equal(JSON.parse(body).allowanceStore, allowanceLabel);
    assert.equal(JSON.parse(body).liveSearchStore, searchLabel);
    assert.doesNotMatch(body, /sensitive|privateValue|credential|private search/);
  }
});

test('provider readiness fails closed for missing configuration and inaccessible actors', async () => {
  env();
  let response = await createHealthHandler(async () => null, async () => null, async () => {})(new Request('https://receiver.test/api/health?readiness=1&provider=1'));
  let body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.actorAccessible, true);
  assert.equal(body.providerConfigured, true);

  env({ APIFY_TOKEN: undefined });
  response = await createHealthHandler(async () => null, async () => null, async () => {})(new Request('https://receiver.test/api/health?readiness=1&provider=1'));
  body = await response.json();
  assert.equal(response.status, 503);
  assert.equal(body.providerConfigured, false);
  assert.equal(body.actorAccessible, false);

  env();
  response = await createHealthHandler(async () => null, async () => null, async () => { throw Error('provider body'); })(new Request('https://receiver.test/api/health?readiness=1&provider=1'));
  body = await response.json();
  assert.equal(response.status, 503);
  assert.equal(body.actorAccessible, false);
  assert.doesNotMatch(JSON.stringify(body), /provider body|apify-secret/);
});
