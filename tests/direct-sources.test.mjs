import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
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
  const first=await handler(request(),{});assert.equal(first.status,200);const body=await first.json();assert.equal(body.sources.length,DIRECT_SOURCES.length);assert.equal(calls,DIRECT_SOURCES.length);
  const second=await (await handler(request('under $2,000'),{})).json();assert.equal(calls,DIRECT_SOURCES.length);assert.equal(second.results.length,0);assert.ok(second.sources.every(s=>s.status==='cached'&&s.checkedAt===now.toISOString()));
  assert.equal(first.headers.get('cache-control'),'no-store');assert.ok(first.headers.get('x-receiver-release'));
});
test('partial failure is explicit, stale evidence expires, and failed checks never advance timestamps',async()=>{
  const store=memory();const old={...inventory(),checkedAt:new Date(now.getTime()-SOURCE_TTL_MS-1000).toISOString()};old.listings=old.listings.map(l=>({...l,capturedAt:old.checkedAt}));store.values.set('orangecountypm',old);
  const handler=createDirectSourcesHandler(()=>store,async()=>{throw Error('offline')},()=>now);
  const stale=await (await handler(request(),{})).json();assert.equal(stale.sources[0].status,'unavailable');assert.equal(stale.sources[1].status,'stale');assert.equal(stale.sources[1].checkedAt,old.checkedAt);assert.equal(stale.results[0].freshness,'stale');
  const expired=createDirectSourcesHandler(()=>store,async()=>{throw Error('offline')},()=>new Date(now.getTime()+STALE_LIMIT_MS));assert.equal((await expired(request(),{})).status,502);
  const partial=createDirectSourcesHandler(()=>memory(),async url=>{if(!url.includes('orangecountypm.'))throw Error('offline');return fetcher(url)},()=>now);
  const body=await(await partial(request(),{})).json();assert.equal(body.results.length,1);assert.equal(body.sources[0].status,'unavailable');assert.equal(body.sources[1].status,'checked');
});
test('invalid requests fail before cache, outbound requests, or provider allowance access',async()=>{
  const handler=createDirectSourcesHandler(()=>{throw Error('must not run')},async()=>{throw Error('must not run')},()=>now);
  for(const q of ['', 'x'.repeat(501),'loft in New York'])assert.equal((await handler(request(q),{})).status,400);
  assert.equal((await handler(request('loft','http://evil.test'),{})).status,400);
  assert.equal((await handler(new Request('https://receiver.test',{method:'DELETE'}),{})).status,405);
  assert.equal((await handler(new Request('https://receiver.test',{method:'POST',body:'wrong'}),{})).status,415);
});

const sourceFixture = source => readFileSync(new URL(`./fixtures/direct-${source.id}.html`,import.meta.url),'utf8');
test('additional managers preserve captured unit prices, exact links, images, and county scope',()=>{
  const expected = {
    mcmpropertymanagement:{count:2,rent:1575,beds:0,county:'la',unit:'8b518bad-51a6-4b3c-82d7-d00f94228062'},
    dtlamanagement:{count:2,rent:2000,beds:1,county:'la',unit:'85854e46-2d3a-4250-a440-0576ee601b68'},
    lidopm:{count:2,rent:2125,beds:1,county:'oc',unit:'02a87d05-9be0-4552-a5a1-58c7d5855155'},
  };
  for(const source of DIRECT_SOURCES.slice(2)){
    const result=parseAppfolioInventory(sourceFixture(source),source,now), e=expected[source.id];
    assert.equal(result.listings.length,e.count,source.id);
    const first=result.listings[0];assert.equal(first.rent,e.rent);assert.equal(first.beds,e.beds);assert.equal(first.county,e.county);
    assert.equal(first.sourceUrl,new URL(`/listings/detail/${e.unit}`,source.url).href);
    assert.ok(first.image.startsWith(`https://images.cdn.appfolio.com/${source.id}/images/`));
    assert.equal(first.capturedAt,now.toISOString());assert.equal(first.source,source.name);
    assert.equal(filterDirectListings(result.listings,'under $3,000',e.county==='la'?'oc':'la',now).length,0);
  }
  // The DTLA capture includes one unpriced ad and one commercial space lacking bedroom/bathroom specs.
  const dtla=DIRECT_SOURCES.find(source=>source.id==='dtlamanagement');
  assert.equal((sourceFixture(dtla).match(/id="listing_/g)??[]).length,4);
});
test('OC city-specific 906/907 ZIPs remain in OC without admitting unrelated city/ZIP pairs',()=>{
  const valid=[['Buena Park','90620'],['Buena Park','90621'],['La Habra','90631'],['La Palma','90623'],['Los Alamitos','90720'],['Seal Beach','90740'],['Sunset Beach','90742']];
  for(const [city,zip] of valid){
    const parsed=parseAppfolioInventory(fixture(`1 Main St, ${city}, CA ${zip}`),DIRECT_SOURCES[1],now);
    assert.equal(parsed.listings[0].county,'oc');
    assert.equal(filterDirectListings(parsed.listings,'under $3,000','oc',now).length,1);
  }
  for(const address of ['1 Main St, Irvine, CA 90620','1 Main St, Buena Park, CA 90740','1 Main St, Phoenix, CA 90620'])assert.throws(()=>parseAppfolioInventory(fixture(address),DIRECT_SOURCES[1],now));
});
test('expanded sources fetch independently in parallel, cache by manager, and isolate one manager failure',async()=>{
  const store=memory();let active=0,maxActive=0;const urls=[];
  const handler=createDirectSourcesHandler(()=>store,async url=>{
    active++;maxActive=Math.max(maxActive,active);urls.push(url);
    await new Promise(resolve=>setTimeout(resolve,5));active--;
    const source=DIRECT_SOURCES.find(source=>source.url===url);
    if(source.id==='mcmpropertymanagement')throw Error('offline');
    return new Response(source.id==='lapmg'||source.id==='orangecountypm'?fixture():sourceFixture(source),{headers:{'content-type':'text/html'}});
  },()=>now);
  const response=await handler(request(),{});assert.equal(response.status,200);const body=await response.json();
  assert.equal(maxActive,DIRECT_SOURCES.length);assert.deepEqual(new Set(urls),new Set(DIRECT_SOURCES.map(source=>source.url)));
  assert.equal(body.sources.find(source=>source.name==='MCM Property Management').status,'unavailable');
  assert.ok(body.sources.filter(source=>source.name!=='MCM Property Management').every(source=>source.status==='checked'));
  assert.equal(store.values.size,DIRECT_SOURCES.length-1);
  assert.ok(body.results.some(listing=>listing.source==='DTLA Management'));assert.ok(body.results.some(listing=>listing.source==='Lido Property Management'));
});
