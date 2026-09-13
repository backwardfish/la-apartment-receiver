import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { trustedUrl } from '../app/security-urls.ts';
import handler from '../netlify/functions/search.ts';
import { runBounded, duration } from '../scripts/run-bounded.mjs';
import { normalizeRentCastListing, searchRentCast, buildRentCastUrl } from '../app/providers.ts';
import { buildLiveSearchRequest, requestLiveSearch } from '../app/live-search.ts';
import { sanitizePersistedListings, restoreWorkspace, persistWorkspace, clearWorkspace, STORAGE_KEY } from '../app/workspace-state.ts';

const listing={id:'rentcast:1',title:'Loft',neighborhood:'Silver Lake',city:'Los Angeles',rent:2500,beds:1,baths:1,available:'Listed as active',source:'LAPMG',sourceUrl:'https://lapmg.appfolio.com/listings/detail/1',image:'https://images.cdn.appfolio.com/image.jpg',features:['Parking'],status:'needs-verification',fit:80,why:[],unknowns:[],redFlags:[]};
const record={id:'1',addressLine1:'1 Test Street',city:'Los Angeles',neighborhood:'Silver Lake',price:2500,bedrooms:1,bathrooms:1,listingUrl:listing.sourceUrl,imageUrl:listing.image,description:'Loft with parking',lastSeenDate:'2026-09-12T10:00:00Z'};
const req=(body,headers={})=>new Request('https://receiver.test/api/search',{method:'POST',headers:{'content-type':'application/json',...headers},body:typeof body==='string'?body:JSON.stringify(body)});
const context={requestId:'test-request'};

test('uses RentCast multi-value syntax and keeps upstream HTTP diagnostics safe',async()=>{
 const query=buildLiveSearchRequest('one bedroom under $2800');
 assert.equal(buildRentCastUrl(query).searchParams.get('propertyType'),'Apartment|Condo|Multi-Family|Townhouse');
 for(const status of [400,401,403,429,503])await assert.rejects(searchRentCast(query,{rentCastApiKey:'test'},async()=>new Response('sensitive provider body',{status})),error=>error.code===`rentcast_http_${status}`&&!error.message.includes('sensitive'));
});

test('exported security headers permit exactly the generated inline scripts',async()=>{
 const html=await readFile(new URL('../dist/client/index.html',import.meta.url),'utf8');
 const headers=await readFile(new URL('../dist/client/_headers',import.meta.url),'utf8');
 const directive=headers.match(/script-src ([^;]+);/)?.[1];
 assert.ok(directive);assert.doesNotMatch(directive,/unsafe-inline|unsafe-eval/);
 const scripts=[...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].filter(([,attrs,body])=>! /\bsrc=/.test(attrs)&&body.trim());
 assert.ok(scripts.length>0);
 for(const [,,body] of scripts)assert.ok(directive.includes(`'sha256-${createHash('sha256').update(body).digest('base64')}'`));
 assert.equal(new Set(directive.match(/'sha256-[^']+'/g)).size,new Set(scripts.map(([, ,body])=>createHash('sha256').update(body).digest('base64'))).size);
});

test('rejects unsafe, deceptive, credential-bearing, and unapproved URLs',()=>{
 for(const url of ['javascript:alert(1)','data:image/svg+xml,<svg/>','http://lapmg.appfolio.com/listing','https://user:pass@lapmg.appfolio.com/listing','https://lapmg.appfolio.com.evil.test/listing','https://127.0.0.1/listing','https://169.254.169.254/latest/meta-data','https://lapmg.appfolio.com:8080/listing','https://lapmg.appfolio.com/\\evil.test','https://evil.test/listing']) assert.equal(trustedUrl(url,'sources'),undefined,url);
 assert.ok(trustedUrl(listing.sourceUrl,'sources'));
 assert.equal(trustedUrl('https://images.cdn.appfolio.com/active.svg','images'),undefined);
});
test('enforces real streamed bytes even when Content-Length is absent or false',async()=>{
 for(const headers of [{},{'content-length':'1'}])assert.equal((await handler(req(JSON.stringify({query:'a',padding:'a'.repeat(21000)}),headers),context)).status,413);
});
test('rejects malformed/empty/long queries and media types without calling providers',async()=>{
 globalThis.Netlify={env:{get:()=>{throw Error('Secrets should not be read');}}};
 for(const body of ['{',{query:''},{query:'a'.repeat(501)},{query:2},[]])assert.equal((await handler(req(body),context)).status,400);
 assert.equal((await handler(req({query:'loft'},{'content-type':'text/plain'}),context)).status,415);
 assert.equal((await handler(new Request('https://receiver.test/api/search'),context)).status,405);
});
test('fails safely for absent credentials, paused searches, and unsupported commutes',async()=>{
 globalThis.Netlify={env:{get:()=>undefined}};
 const missing=await handler(req({query:'loft'}),context);assert.equal(missing.status,503);assert.doesNotMatch(await missing.text(),/RENTCAST_API_KEY/);
 globalThis.Netlify={env:{get:key=>key==='LIVE_SEARCH_ENABLED'?'false':'test'}};
 assert.equal((await (await handler(req({query:'loft'}),context)).json()).code,'search_paused');
 globalThis.Netlify={env:{get:key=>key==='RENTCAST_API_KEY'?'test':undefined}};
 assert.equal((await handler(req({query:'loft within 30 minutes of Pasadena'}),context)).status,503);
});
test('logs only fixed categories and does not echo secret-bearing errors',async(t)=>{
 globalThis.Netlify={env:{get:key=>key==='RENTCAST_API_KEY'?'test':undefined}};
 const logs=[];t.mock.method(console,'error',line=>logs.push(line));t.mock.method(globalThis,'fetch',async()=>{throw Error('sensitive-key https://private.test/?token=abc');});
 const response=await handler(req({query:'loft'}),context);assert.equal(response.status,502);
 assert.match(response.headers.get('x-receiver-release'),/^[a-f0-9]{40}$/);
 assert.doesNotMatch(JSON.stringify(logs)+await response.text(),/sensitive-key|private.test|token=abc|RENTCAST/);
});
test('separates missing source evidence from a legitimate zero-match result',async()=>{
 const query=buildLiveSearchRequest('loft');
 await assert.rejects(searchRentCast(query,{rentCastApiKey:'test'},async()=>Response.json([{...record,listingUrl:undefined,imageUrl:undefined}])),error=>error.code==='source_evidence_unavailable');
 assert.deepEqual(await searchRentCast(query,{rentCastApiKey:'test'},async()=>Response.json([])),[]);
});
test('does not invent bed/bath values or freshness from listing date',()=>{
 assert.equal(normalizeRentCastListing({...record,bathrooms:undefined}),null);
 assert.equal(normalizeRentCastListing({...record,bedrooms:undefined}),null);
 assert.equal(normalizeRentCastListing({...record,lastSeenDate:undefined,listedDate:new Date().toISOString()}).freshness,'needs-verification');
 assert.equal(normalizeRentCastListing({...record,lastSeenDate:'2099-01-01'}).freshness,'needs-verification');
});
test('enforces local price/bedroom constraints and rejects negated feature claims',async()=>{
 const features=normalizeRentCastListing({...record,description:'Not furnished. No pets allowed. No parking. Loft.'}).features;
 for(const feature of ['Parking','Pet friendly','Furnished'])assert.ok(!features.includes(feature));
 const results=await searchRentCast(buildLiveSearchRequest('one bedroom under $2800'),{rentCastApiKey:'test'},async()=>Response.json([record,{...record,id:'2',price:4000},{...record,id:'3',bedrooms:0}]));
 assert.equal(results.length,1);
});
test('drops unknown persisted fields and does not preserve forged verification',()=>{
 const clean=sanitizePersistedListings([{...listing,apiKey:'secret',status:'verified'}]);
 assert.equal(clean[0].status,'needs-verification');assert.ok(!('apiKey' in clean[0]));
 assert.deepEqual(sanitizePersistedListings([{...listing,image:'javascript:alert(1)'}]),[]);
});
test('retains valid saves, expires old state, and clears both schema versions',()=>{
 const data=new Map();globalThis.localStorage={getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value),removeItem:key=>data.delete(key)};
 const now=Date.now(),state={saved:[listing.id],rejected:[],compare:[listing.id],activeQuery:'loft',liveListings:[listing]};
 assert.equal(persistWorkspace(state,now),true);assert.deepEqual(restoreWorkspace([],now).saved,[listing.id]);
 assert.equal(restoreWorkspace([],now+31*86400000),null);
 data.set('receiver:workspace:v2',JSON.stringify({version:2,...state}));assert.ok(restoreWorkspace([],now));
 assert.ok(clearWorkspace());assert.equal(data.size,0);
 data.set(STORAGE_KEY,'{');assert.equal(restoreWorkspace([],now),null);
});
test('handles denied storage without crashing or claiming persistence',()=>{
 Object.defineProperty(globalThis,'localStorage',{configurable:true,get(){throw Error('denied');}});
 assert.equal(restoreWorkspace([]),null);assert.equal(clearWorkspace(),false);
 assert.equal(persistWorkspace({saved:[],rejected:[],compare:[],activeQuery:'',liveListings:null}),false);
 delete globalThis.localStorage;
});
test('portable runner propagates success/failure and kills hung processes',async()=>{
 assert.equal(duration('3m'),180000);
 assert.equal(await runBounded(process.execPath,['-e','process.exit(7)'],3000),7);
 assert.equal(await runBounded(process.execPath,['-e','setInterval(()=>{},1000)'],150,50),124);
});
test('client gives a useful message for platform rate limiting',async(t)=>{
 t.mock.method(globalThis,'fetch',async()=>new Response('Too many requests',{status:429}));
 const result=await requestLiveSearch('loft');assert.equal(result.code,'rate_limited');
});
