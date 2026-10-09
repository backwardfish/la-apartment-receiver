import test from 'node:test';
import assert from 'node:assert/strict';
import { DIRECT_SOURCES,parseAppfolioInventory,filterDirectListings,fetchInventory,SOURCE_TTL_MS,STALE_LIMIT_MS,directIntent } from '../app/direct-sources.ts';
import { createDirectSourcesHandler } from '../netlify/functions/direct-sources.mts';
const now=new Date('2026-10-09T01:00:00Z');
const fixture=(address='147 Lemon Grove, Irvine, CA 92618',description='Loft with vaulted ceilings. Dishwasher. Cats allowed, Dogs not allowed.',photo='https://images.cdn.appfolio.com/orangecountypm/images/unit/large.jpg',rent='$2,795')=>`<div class="js-listings-container"><div class="listing-item result js-listing-item" id="listing_1"><span class="js-listing-blurb-rent">${rent}</span><span class="js-listing-blurb-bed-bath">1 bd / 1 ba</span><h2 class="js-listing-title"><a>Upper condo with loft</a></h2><span class="js-listing-address">${address}</span><span class="js-listing-square-feet">Square Feet: 841</span><span class="js-listing-available">NOW</span><p class="js-listing-description">${description}</p><div class="listing-item__actions"></div></div></div><script>markers: ${JSON.stringify([{listing_id:1,detail_page_url:'/listings/detail/6503a909-15a2-4e16-9ce9-76706a49498c',default_photo_url:photo,latitude:33.665,longitude:-117.777}])},
</script>`;
const inventory=()=>parseAppfolioInventory(fixture(),DIRECT_SOURCES[1],now);
const request=(query='loft under $3,000',region='all')=>new Request('https://receiver.test/api/direct-sources',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({query,region})});
const memory=()=>{const values=new Map();return{values,get:async id=>values.get(id)??null,put:async(id,value)=>values.set(id,value)};};
const fetcher=async url=>new Response(fixture(url.includes('lapmg.')?'6200 Fountain Ave, Los Angeles, CA 90028':undefined),{headers:{'content-type':'text/html'}});
test('parses actual manager fields with exact link, source image, evidence, and check time',()=>{
  const l=inventory().listings[0];assert.equal(l.rent,2795);assert.equal(l.sqft,841);assert.equal(l.city,'Irvine');assert.equal(l.county,'oc');assert.equal(l.capturedAt,now.toISOString());assert.equal(l.lastSeenAt,undefined);assert.match(l.sourceUrl,/orangecountypm\.appfolio\.com\/listings\/detail\//);assert.equal(l.styleGrade,'B');assert.ok(l.features.includes('Dishwasher'));assert.ok(l.features.includes('Pet friendly'));assert.equal(l.freshness,'recent');
});
test('rejects missing prices, untrusted images, out-of-region addresses, and changed formats',()=>{
  for(const html of [fixture(undefined,undefined,'https://evil.test/photo.jpg'),fixture('1 Main St, Irvine, TX 75001'),fixture('1 Main St, Phoenix, CA 92618'),fixture(undefined,undefined,undefined,'Call for rent')])assert.throws(()=>parseAppfolioInventory(html,DIRECT_SOURCES[1],now));
  assert.throws(()=>parseAppfolioInventory('<html>Blocked</html>',DIRECT_SOURCES[1],now));
  assert.throws(()=>parseAppfolioInventory('x'.repeat(2_000_001),DIRECT_SOURCES[1],now));
});
test('enforces budget, bedrooms, features, county, OC city, and unknown area while preserving style preferences',()=>{
  const l=inventory().listings[0];const generic={...l,id:'other',title:'Other unit',sourceUrl:l.sourceUrl+'?unit=2',styleGrade:'D',warehouseSignals:[],rent:2800};
  assert.equal(filterDirectListings([l,generic],'loft under $3,000','oc',now).length,2);
  for(const q of ['under $2,000','above $3,000','2 bedrooms','with parking','in Hollywood','in Huntington Beach'])assert.equal(filterDirectListings([l],q,'all',now).length,0,q);
  assert.equal(filterDirectListings([l],'one bedroom in Irvine under $3,000','oc',now).length,1);
  assert.equal(filterDirectListings([l],'loft in Orange County','all',now).length,1);
  assert.deepEqual(directIntent('loft in Orange County').locations,['orange county']);
  assert.equal(filterDirectListings([l],'loft','la',now).length,0);
  assert.throws(()=>filterDirectListings([l],'loft in New York','all',now));
  assert.throws(()=>filterDirectListings([l],'within 30 minutes of Irvine','all',now));
  assert.equal(filterDirectListings([l,l],'loft','all',now).length,1);
});
test('bounded fetch uses fixed URLs and rejects oversized or non-HTML responses',async()=>{
  await fetchInventory(DIRECT_SOURCES[0],async(url,init)=>{assert.equal(url,DIRECT_SOURCES[0].url);assert.equal(init.redirect,'error');assert.ok(init.signal);return fetcher(url)},now);
  await assert.rejects(fetchInventory(DIRECT_SOURCES[0],async()=>new Response('x',{headers:{'content-type':'text/html','content-length':'2000001'}})));
  await assert.rejects(fetchInventory(DIRECT_SOURCES[0],async()=>new Response('{}',{headers:{'content-type':'application/json'}})));
});
test('feed caches inventory across different briefs without refreshing its checked timestamp',async()=>{
  const store=memory();let calls=0;const handler=createDirectSourcesHandler(()=>store,async url=>{calls++;return fetcher(url)},()=>now);
  const first=await handler(request(),{});assert.equal(first.status,200);const body=await first.json();assert.equal(body.sources.length,2);assert.equal(calls,2);
  const second=await (await handler(request('under $2,000'),{})).json();assert.equal(calls,2);assert.equal(second.results.length,0);assert.ok(second.sources.every(s=>s.status==='cached'&&s.checkedAt===now.toISOString()));
  assert.equal(first.headers.get('cache-control'),'no-store');assert.ok(first.headers.get('x-receiver-release'));
});
test('partial failure is explicit, stale evidence expires, and failed checks never advance timestamps',async()=>{
  const store=memory();const old={...inventory(),checkedAt:new Date(now.getTime()-SOURCE_TTL_MS-1000).toISOString()};old.listings=old.listings.map(l=>({...l,capturedAt:old.checkedAt}));store.values.set('orangecountypm',old);
  const handler=createDirectSourcesHandler(()=>store,async()=>{throw Error('offline')},()=>now);
  const stale=await (await handler(request(),{})).json();assert.equal(stale.sources[0].status,'unavailable');assert.equal(stale.sources[1].status,'stale');assert.equal(stale.sources[1].checkedAt,old.checkedAt);assert.equal(stale.results[0].freshness,'stale');
  const expired=createDirectSourcesHandler(()=>store,async()=>{throw Error('offline')},()=>new Date(now.getTime()+STALE_LIMIT_MS));assert.equal((await expired(request(),{})).status,502);
  const partial=createDirectSourcesHandler(()=>memory(),async url=>{if(url.includes('lapmg.'))throw Error('offline');return fetcher(url)},()=>now);
  const body=await(await partial(request(),{})).json();assert.equal(body.results.length,1);assert.equal(body.sources[0].status,'unavailable');assert.equal(body.sources[1].status,'checked');
});
test('invalid requests fail before cache, outbound requests, or provider allowance access',async()=>{
  const handler=createDirectSourcesHandler(()=>{throw Error('must not run')},async()=>{throw Error('must not run')},()=>now);
  for(const q of ['', 'x'.repeat(501),'loft in New York'])assert.equal((await handler(request(q),{})).status,400);
  assert.equal((await handler(request('loft','http://evil.test'),{})).status,400);
  assert.equal((await handler(new Request('https://receiver.test',{method:'DELETE'}),{})).status,405);
  assert.equal((await handler(new Request('https://receiver.test',{method:'POST',body:'wrong'}),{})).status,415);
});
