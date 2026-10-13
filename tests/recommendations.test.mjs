import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { DIRECT_SOURCES } from '../app/direct-sources.ts';
import { refreshRecommendationInventory, usableRecommendationInventory, nextRecommendationRefresh } from '../app/recommendation-inventory.ts';
import { createRecommendationsHandler } from '../netlify/functions/recommendations.mts';
import { config as hourlyConfig } from '../netlify/functions/hourly-recommendations.mts';
const now=new Date('2026-10-13T09:00:00Z');
const html=await readFile(new URL('./fixtures/direct-mcmpropertymanagement.html',import.meta.url),'utf8');
function cache(initial=null){let value=initial;return {get:async()=>value,put:async next=>{value=next}};}
const fetcher=async()=>new Response(html,{headers:{'content-type':'text/html'}});
const context={requestId:'test',deploy:{context:'production',id:'test'}};
test('hourly inventory refresh uses every configured manager without paid provider calls',async()=>{
 const calls=[];const store=cache();const value=await refreshRecommendationInventory(store,async url=>{calls.push(url);return fetcher();},now);
 assert.deepEqual(calls,DIRECT_SOURCES.map(source=>source.url));
 assert.equal(value.inventories.length,DIRECT_SOURCES.length);
 assert.equal(hourlyConfig.schedule,'0 * * * *');assert.equal(hourlyConfig.path,undefined);
 assert.equal(nextRecommendationRefresh(now.getTime()),'2026-10-13T10:00:00.000Z');
});
test('refresh failure keeps original checked times; old evidence is not relabeled fresh',async()=>{
 const store=cache();const original=await refreshRecommendationInventory(store,fetcher,now);
 const later=new Date(now.getTime()+3600000);
 const refreshed=await refreshRecommendationInventory(store,async()=>{throw new Error('offline');},later);
 assert.ok(refreshed.sources.every(source=>source.status==='stale'&&source.checkedAt===now.toISOString()));
 assert.equal(refreshed.inventories[0].listings[0].capturedAt,original.inventories[0].listings[0].capturedAt);
 await assert.rejects(()=>refreshRecommendationInventory(store,async()=>{throw new Error('offline');},new Date(now.getTime()+25*3600000)));
});
test('normal queue reads reuse the hosted inventory, filter brief, and retain release evidence',async()=>{
 const store=cache();await refreshRecommendationInventory(store,fetcher,now);let calls=0;
 const handler=createRecommendationsHandler(()=>store,async()=>{calls++;throw new Error('must not fetch');},()=>now);
 const result=await handler(new Request('https://test/api/recommendations',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({query:'one bedroom under $3,000',region:'la'})}),context);
 assert.equal(result.status,200);const body=await result.json();assert.equal(calls,0);
 assert.ok(body.results.length > 0);assert.ok(body.results.every(row=>row.rent<=3000&&row.beds>=1&&row.county==='la'));
 assert.equal(body.nextRefreshAt,'2026-10-13T10:00:00.000Z');assert.ok(result.headers.get('x-receiver-release'));assert.equal(result.headers.get('x-request-id'),'test');
});
test('invalid recommendation requests fail before cache or outbound work; empty sources return unavailable',async()=>{
 let reads=0;const handler=createRecommendationsHandler(()=>{reads++;return cache();},async()=>{throw new Error('offline');},()=>now);
 for(const [init,status] of [[{method:'DELETE'},405],[{method:'POST',headers:{'content-type':'text/plain'},body:'x'},415],[{method:'POST',headers:{'content-type':'application/json'},body:'{"query":"loft","region":"unknown"}'},400]]){
  assert.equal((await handler(new Request('https://test/api/recommendations',init),context)).status,status);
 }
 assert.equal(reads,0);assert.equal((await handler(new Request('https://test/api/recommendations'),context)).status,503);
});
test('expired, future-dated or oversized hourly inventory is never usable',async()=>{
 const value=await refreshRecommendationInventory(cache(),fetcher,now);
 assert.ok(usableRecommendationInventory(value,now.getTime()));
 assert.equal(usableRecommendationInventory(value,now.getTime()-1),false);
 assert.equal(usableRecommendationInventory(value,now.getTime()+25*3600000),false);
 assert.equal(usableRecommendationInventory({...value,inventories:Array(50).fill(value.inventories[0])},now.getTime()),false);
});
