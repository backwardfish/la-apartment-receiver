import assert from 'node:assert/strict';

const site = 'https://la-apartment-receiver.netlify.app';
const revision = '0dc551df09b6cdaaee735a925d7cacaae330cd31';
const req = (path, init={}) => fetch(new URL(path, site), {redirect:'error', signal:AbortSignal.timeout(20000), ...init});

async function json(path, init={}) {
  const r = await req(path, init);
  const body = await r.json().catch(()=>null);
  return {r, body};
}

const release = await (await req('/release.json')).json();
assert.equal(release.revision, revision);
assert.equal(release.dirty, false);

const health = await json('/api/health?readiness=1&provider=1');
assert.equal(health.r.status, 200);
assert.equal(health.body.release.revision, revision);
assert.equal(health.body.provider, 'zillow-apify');
assert.equal(health.body.liveSearchEnabled, true);
assert.equal(health.body.providerConfigured, true);
assert.equal(health.body.actorAccessible, true);

async function search(query, neighborhood) {
  const started = await json('/api/search', {
    method:'POST',
    headers:{'content-type':'application/json'},
    body:JSON.stringify({query, neighborhood}),
  });
  const firstId = started.r.headers.get('x-request-id');
  if (started.r.status === 200) return {requestId:firstId, body:started.body};
  assert.equal(started.r.status, 202, `${query}: expected 200/202, got ${started.r.status} ${JSON.stringify(started.body)}`);
  let body = started.body;
  const deadline = Date.now()+165000;
  while (body.status === 'pending' && Date.now() < deadline) {
    await new Promise(r=>setTimeout(r, Math.min(Math.max(body.pollAfterMs ?? 3000,1000),10000)));
    const polled = await json('/api/search-status?id='+encodeURIComponent(body.searchId));
    body = polled.body;
    if (polled.r.status === 200) return {requestId:firstId, body};
    assert.equal(polled.r.status, 202, `${query}: poll failed ${polled.r.status} ${JSON.stringify(body)}`);
  }
  throw new Error(`${query}: timed out`);
}

function assertEvidence(listing) {
  assert.equal(typeof listing.rent,'number');
  assert.ok(listing.rent > 0);
  assert.equal(typeof listing.beds,'number');
  assert.equal(typeof listing.baths,'number');
  assert.match(listing.sourceUrl, /^https:\/\/(?:www\.)?zillow\.com\//);
  assert.match(listing.image, /^https:\/\/[^/]*zillowstatic\.com\//);
  assert.ok(['live','recent','needs-verification','stale'].includes(listing.freshness));
}

const cases = [];
const a = await search('warehouse loft under $3,500', 'arts district');
assert.equal(a.body.status,'ok');
assert.ok(a.body.results.length > 0, 'Arts District loft search returned no live results');
a.body.results.slice(0,3).forEach(assertEvidence);
cases.push({name:'arts district loft', requestId:a.requestId, count:a.body.results.length, top:a.body.results.slice(0,3).map(x=>({title:x.title,rent:x.rent,beds:x.beds,baths:x.baths,features:x.features,styleGrade:x.styleGrade,sourceUrl:x.sourceUrl}))});

const b = await search('one bedroom under $4,500 with parking', 'arts district');
assert.equal(b.body.status,'ok');
b.body.results.forEach(x=>{ assertEvidence(x); assert.ok(x.rent<=4500); assert.ok(x.beds>=1); assert.ok(x.features.includes('Parking')); });
cases.push({name:'budget beds parking', requestId:b.requestId, count:b.body.results.length, top:b.body.results.slice(0,3).map(x=>({title:x.title,rent:x.rent,features:x.features}))});

const c = await search('pet friendly furnished one bedroom under $5,000', 'santa monica');
assert.equal(c.body.status,'ok');
c.body.results.forEach(x=>{ assertEvidence(x); assert.ok(x.rent<=5000); assert.ok(x.beds>=1); assert.ok(x.features.includes('Pet friendly')); assert.ok(x.features.includes('Furnished')); });
cases.push({name:'pets furnished second neighborhood', requestId:c.requestId, count:c.body.results.length, top:c.body.results.slice(0,3).map(x=>({title:x.title,rent:x.rent,features:x.features}))});

const d = await search('one bedroom under $100', 'arts district');
assert.equal(d.body.status,'ok');
assert.equal(d.body.results.length,0,'Expected a legitimate empty result under $100');
cases.push({name:'legitimate zero results', requestId:d.requestId, count:0});

console.log(JSON.stringify({checkedAt:new Date().toISOString(),revision,health:{provider:health.body.provider,actorAccessible:health.body.actorAccessible,allowanceStore:health.body.allowanceStore,liveSearchStore:health.body.liveSearchStore},cases},null,2));
