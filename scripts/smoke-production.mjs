import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import origins from '../app/trusted-origins.json' with { type: 'json' };

const [site = 'https://la-apartment-receiver.netlify.app', revision, ...flags] = process.argv.slice(2);
assert.match(revision ?? '', /^[a-f0-9]{40}$/, 'Supply the exact expected commit SHA');
const root = new URL(site);
assert.ok(root.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(root.hostname), 'Use HTTPS outside local development');
assert.ok(!root.username && !root.password && !root.search && !root.hash, 'Use a plain site origin');
const request = (path, init) => fetch(new URL(path, root), { ...init, redirect: 'error', signal: AbortSignal.timeout(20_000) });
let release;
for (let attempt = 0; attempt < (flags.includes('--wait') ? 30 : 1); attempt++) {
  const response = await request('/release.json');
  assert.equal(response.status, 200, 'Release manifest must be available');
  release = await response.json();
  if (release.revision === revision) break;
  if (flags.includes('--wait') && attempt < 29) await delay(20_000);
}
assert.equal(release.revision, revision, 'Production has not reached the expected commit');
assert.equal(release.dirty, false, 'Production must contain a clean reviewed commit');
const health = await request('/api/health?readiness=1');
assert.equal(health.status, 200, 'Allowance storage must be reachable');
assert.equal(health.headers.get('cache-control'), 'no-store');
const status = await health.json();
assert.deepEqual(status.release, release, 'Client and function provenance must agree');
assert.equal(status.allowanceStore, 'reachable');
assert.match(status.runtimeNode, /^v22\./);

const page = await request('/');
assert.equal(page.status, 200);
for (const [header, expected] of Object.entries({ 'x-content-type-options':'nosniff', 'x-frame-options':'DENY', 'referrer-policy':'no-referrer' })) assert.equal(page.headers.get(header), expected, header);
assert.match(page.headers.get('strict-transport-security') ?? '', /max-age=31536000/);
assert.match(page.headers.get('permissions-policy') ?? '', /camera=\(\), microphone=\(\), geolocation=\(\)/);
const csp = page.headers.get('content-security-policy') ?? '';
const scripts = csp.match(/(?:^|;\s*)script-src ([^;]+)/)?.[1] ?? '';
assert.ok(scripts.includes("'self'"));
assert.doesNotMatch(scripts, /unsafe-inline|unsafe-eval/);
for (const directive of ["object-src 'none'", "base-uri 'none'", "frame-ancestors 'none'", "form-action 'self'", "connect-src 'self'"]) assert.ok(csp.includes(directive), directive);
const imageHosts = csp.match(/(?:^|;\s*)img-src ([^;]+)/)?.[1].split(/\s+/) ?? [];
assert.deepEqual(new Set(imageHosts), new Set(["'self'", ...origins.images.flatMap(host => [`https://${host}`, `https://*.${host}`])]));
const html = await page.text();
const hashes = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
  .filter(([, attributes, body]) => !/\bsrc=/.test(attributes) && body.trim())
  .map(([, , body]) => `'sha256-${createHash('sha256').update(body).digest('base64')}'`);
assert.ok(hashes.length > 0);
assert.deepEqual(new Set(scripts.match(/'sha256-[^']+'/g)), new Set(hashes), 'Served HTML and CSP hashes must match exactly');

// Every default search request is invalid before credential access or reservation.
const checks = [
  { name:'invalid query', path:'/api/search', init:{ method:'POST', headers:{'content-type':'application/json'}, body:'{"query":""}' }, expected:400 },
  { name:'wrong method', path:'/api/search', expected:405 },
  { name:'wrong media', path:'/api/search', init:{method:'POST',headers:{'content-type':'text/plain'},body:'invalid'}, expected:415 },
  { name:'oversized body', path:'/api/search', init:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({query:'',padding:'x'.repeat(20_001)})}, expected:413 },
  { name:'direct function route', path:'/.netlify/functions/search', expected:404 },
  { name:'status without id', path:'/api/search-status', expected:400 },
  { name:'status unknown id', path:'/api/search-status?id=00000000-0000-4000-8000-000000000000', expected:404 },
  { name:'status wrong method', path:'/api/search-status', init:{ method:'POST' }, expected:405 },
];
if (flags.includes('--expect-paused')) checks.push({name:'paused search',path:'/api/search',init:{method:'POST',headers:{'content-type':'application/json'},body:'{"query":"one bedroom"}'},expected:503});
for (const check of checks) {
  const response = await request(check.path, check.init);
  assert.equal(response.status, check.expected, check.name);
  if (check.expected !== 404) {
    assert.equal(response.headers.get('x-receiver-release'), revision, `${check.name}: function revision`);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.ok(response.headers.get('x-request-id'));
    if (check.name === 'paused search') assert.equal((await response.json()).code, 'search_paused');
  }
}
console.log(JSON.stringify({checkedAt:new Date().toISOString(),site:root.origin,revision,dirty:release.dirty,runtime:status.runtimeNode,allowanceStore:status.allowanceStore,cspInlineHashes:new Set(hashes).size,checks:checks.map(({name,expected})=>({name,status:expected})),providerCalls:flags.includes('--expect-paused')?'zero if paused assertion passed':'zero by request construction'},null,2));
