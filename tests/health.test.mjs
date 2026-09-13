import test from 'node:test';
import assert from 'node:assert/strict';
import { createHealthHandler } from '../netlify/functions/health.ts';

test('basic health checks do not read shared storage', async () => {
  const handler = createHealthHandler(() => { throw Error('should not read storage'); });
  const response = await handler(new Request('https://receiver.test/api/health'));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).allowanceStore, undefined);
});

test('readiness checks report store reachability without counters, credentials, or raw errors', async () => {
  for (const [read, status, label] of [
    [async () => ({ data: { privateValue: 'sensitive' } }), 200, 'reachable'],
    [async () => { throw Error('sensitive credential error'); }, 503, 'unavailable'],
  ]) {
    const response = await createHealthHandler(read)(new Request('https://receiver.test/api/health?readiness=1'));
    assert.equal(response.status, status);
    const body = await response.text();
    assert.equal(JSON.parse(body).allowanceStore, label);
    assert.doesNotMatch(body, /sensitive|privateValue|credential/);
  }
});
