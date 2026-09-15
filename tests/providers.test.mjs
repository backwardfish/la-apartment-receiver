import assert from "node:assert/strict";
import test from "node:test";
import { buildLiveSearchRequest } from "../app/live-search.ts";
import { AREA_CENTERS, MAX_PROVIDER_RECORDS, buildRentCastUrl, enclosingCircle, normalizeRentCastListing, requestedAreas, searchRentCast } from "../app/providers.ts";

const sample = { id:"la-1", addressLine1:"101 Industrial Street", formattedAddress:"101 Industrial Street, Los Angeles, CA 90013", city:"Los Angeles", neighborhood:"Arts District", state:"CA", zipCode:"90013", latitude:34.0407, longitude:-118.2351, price:2700, bedrooms:1, bathrooms:1, squareFootage:850, status:"Active", lastSeenDate:"2026-08-24T12:00:00.000Z", listingUrl:"https://lapmg.appfolio.com/listings/detail/test", description:"Industrial loft with parking, in-unit washer and exposed brick", imageUrl:"https://images.cdn.appfolio.com/la-1.jpg" };

test('provider JSON has a streamed byte bound even without a trustworthy Content-Length', async () => {
  const request=buildLiveSearchRequest('one bedroom');
  for (const headers of [{},{'content-length':'1'},{'content-length':'2000001'}]) {
    await assert.rejects(searchRentCast(request,{rentCastApiKey:'synthetic'},async()=>new Response('x'.repeat(2000001),{headers})),error=>error.code==='rentcast_response_too_large');
  }
  await assert.rejects(searchRentCast(request,{rentCastApiKey:'synthetic'},async()=>new Response('{private-body')),error=>error.code==='rentcast_invalid_payload'&&!error.message.includes('private-body'));
});

test('a commute-only search queries the LA region and excludes unknown neighborhoods', async () => {
  const request=buildLiveSearchRequest('one bedroom within 45 minutes of Santa Monica');
  assert.equal(buildRentCastUrl(request).searchParams.get('city'),null);
  assert.ok(buildRentCastUrl(request).searchParams.has('latitude'));
  const results=await searchRentCast(request,{rentCastApiKey:'synthetic'},async()=>Response.json([
    {...sample,id:'pass',neighborhood:'Silver Lake'},
    {...sample,id:'fail',addressLine1:'202 Test Street',neighborhood:'Arts District'},
    {...sample,id:'unknown',addressLine1:'303 Test Street',neighborhood:'Unmapped Area',city:'Unknown City'},
  ]));
  assert.deepEqual(results.map(x=>x.id),['rentcast:pass']);
});

test("normalizes a RentCast record into the Receiver contract", () => { const listing=normalizeRentCastListing(sample,new Date("2026-08-25T12:00:00.000Z")); assert.ok(listing); assert.equal(listing.id,"rentcast:la-1"); assert.equal(listing.rent,2700); assert.equal(listing.sourceUrl,"https://lapmg.appfolio.com/listings/detail/test"); assert.deepEqual(listing.warehouseSignals,["Loft","Industrial conversion"]); assert.deepEqual(listing.features,["Parking","Laundry"]); assert.equal(listing.freshness,"live"); });
test("normalizes pet-friendly and furnished provider language into canonical UX features", () => { const listing=normalizeRentCastListing({...sample,id:"la-pet",description:"Fully furnished loft. Cats allowed and dogs allowed. Assigned garage space."}); assert.ok(listing); assert.ok(listing.features.includes("Pet friendly")); assert.ok(listing.features.includes("Furnished")); assert.ok(listing.features.includes("Parking")); });
test("rejects provider records without authentic listing imagery",()=>assert.equal(normalizeRentCastListing({...sample,imageUrl:undefined,photos:undefined}),null));
test("rejects provider records that do not preserve an exact listing source",()=>assert.equal(normalizeRentCastListing({...sample,listingUrl:undefined,url:undefined}),null));
test("enforces hard amenity and warehouse requirements on live results",async()=>{const request=buildLiveSearchRequest("industrial loft with parking under $3,000"); const fetcher=async()=>new Response(JSON.stringify([sample,{...sample,id:"la-2",addressLine1:"202 Conventional Street",description:"Conventional apartment with laundry"},{...sample,id:"la-3",addressLine1:"303 Loft Street",description:"Industrial loft without assigned amenities"}]),{status:200}); const results=await searchRentCast(request,{rentCastApiKey:"test"},fetcher,new Date("2026-08-25T12:00:00.000Z")); assert.deepEqual(results.map(x=>x.id),["rentcast:la-1"]);});
test("builds a bounded LA RentCast query from search intent",()=>{const url=buildRentCastUrl(buildLiveSearchRequest("one bedroom in West Hollywood under $2,800")); assert.equal(url.searchParams.get("city"),"West Hollywood"); assert.equal(url.searchParams.get("price"),"0:2800"); assert.equal(url.searchParams.get("bedrooms"),"1:*"); assert.equal(url.searchParams.get("status"),"Active"); assert.equal(url.searchParams.get("limit"),String(MAX_PROVIDER_RECORDS)); assert.ok(MAX_PROVIDER_RECORDS<=500);});

// RentCast's published rental-listing schema has no listingUrl, imageUrl/photos, description, or neighborhood
// (https://developers.rentcast.io/reference/property-listings-schema). This documents that the current
// evidence gate rejects every record shaped like the real provider response, so live search cannot succeed
// until a source with listing links and photos is configured. Do not "fix" this test by relaxing the gate silently.
const rentCastSchemaRecord = { id:"1855-Industrial-St,-Apt-402,-Los-Angeles,-CA-90021", formattedAddress:"1855 Industrial St, Apt 402, Los Angeles, CA 90021", addressLine1:"1855 Industrial St", addressLine2:"Apt 402", city:"Los Angeles", state:"CA", zipCode:"90021", county:"Los Angeles", latitude:34.0339, longitude:-118.2298, propertyType:"Condo", bedrooms:1, bathrooms:1, squareFootage:1120, yearBuilt:1924, status:"Active", price:3450, listingType:"Standard", listedDate:"2026-09-01T00:00:00.000Z", createdDate:"2026-09-01T00:00:00.000Z", lastSeenDate:"2026-09-14T13:00:00.000Z", daysOnMarket:14, mlsName:"CRMLS", mlsNumber:"26-123456", listingAgent:{ name:"Agent", phone:"3235551212" }, listingOffice:{ name:"Loft Realty", phone:"2135551212" }, history:{} };
test("KNOWN BLOCKER: records shaped like RentCast's published schema carry no source link or photo and are rejected", async () => {
  assert.equal(normalizeRentCastListing(rentCastSchemaRecord), null);
  await assert.rejects(searchRentCast(buildLiveSearchRequest("loft in Arts District"),{rentCastApiKey:"test"},async()=>Response.json([rentCastSchemaRecord])),error=>error.code==="source_evidence_unavailable");
});

test("a single recognised neighbourhood becomes a tight coordinate circle, not an 8-mile address geocode", () => {
  for (const [query, area] of [["industrial loft near USC","usc"],["loft near UCLA","ucla"],["warehouse loft in the Arts District","arts district"]]) {
    const url = buildRentCastUrl(buildLiveSearchRequest(query));
    assert.equal(url.searchParams.get("address"), null, query);
    assert.equal(Number(url.searchParams.get("latitude")).toFixed(4), AREA_CENTERS[area].latitude.toFixed(4), query);
    assert.equal(Number(url.searchParams.get("radius")), AREA_CENTERS[area].radiusMiles, query);
  }
  const unknown = buildRentCastUrl(buildLiveSearchRequest("loft in Frogtown"));
  assert.equal(unknown.searchParams.get("address"), "Frogtown, Los Angeles, CA");
  assert.equal(unknown.searchParams.get("radius"), "3");
});

test("several requested areas share one bounded request and results must fall inside one of them", async () => {
  const request = buildLiveSearchRequest("loft near UCLA, USC, or the Arts District in Downtown LA");
  assert.deepEqual(request.intent.locations, ["ucla","usc","arts district","downtown los angeles"]);
  const url = buildRentCastUrl(request);
  const circle = enclosingCircle(requestedAreas(request.intent));
  assert.ok(circle && circle.radiusMiles > 6 && circle.radiusMiles <= 12, "one circle covers the west side and downtown");
  assert.equal(Number(url.searchParams.get("radius")), circle.radiusMiles);
  const at = (id, latitude, longitude, description = "Industrial loft") => ({ ...sample, id, addressLine1: `${id} Street`, latitude, longitude, description });
  const results = await searchRentCast(request, { rentCastApiKey: "test" }, async () => Response.json([
    at("arts", 34.0400, -118.2330),
    at("usc", 34.0250, -118.2860),
    at("westwood", 34.0620, -118.4440),
    at("koreatown", 34.0577, -118.3009),   // inside the enclosing circle but in none of the requested areas
    at("hollywood", 34.0928, -118.3287),
    { ...sample, id: "nocoords", addressLine1: "No Coordinates", latitude: undefined, longitude: undefined },
  ]));
  assert.deepEqual(results.map(x => x.id).sort(), ["rentcast:arts","rentcast:usc","rentcast:westwood"]);
  const arts = results.find(x => x.id === "rentcast:arts");
  assert.equal(arts.area, "Arts District");
  assert.ok(arts.distanceMiles < 0.2);
  assert.equal(results.find(x => x.id === "rentcast:westwood").area, "UCLA");
});

test("loft signals outrank generic records for a warehouse brief and nearer listings break ties", async () => {
  const request = buildLiveSearchRequest("warehouse loft in the Arts District");
  const results = await searchRentCast(request, { rentCastApiKey: "test" }, async () => Response.json([
    { ...sample, id: "far-loft", addressLine1: "Far Loft", latitude: 34.0470, longitude: -118.2400, description: "Loft" },
    { ...sample, id: "near-loft", addressLine1: "Near Loft", latitude: 34.0405, longitude: -118.2330, description: "Loft" },
    { ...sample, id: "true-warehouse", addressLine1: "Warehouse", latitude: 34.0450, longitude: -118.2380, description: "Converted warehouse loft with exposed brick" },
    { ...sample, id: "generic", addressLine1: "Generic", latitude: 34.0405, longitude: -118.2330, description: "Luxury apartment with pool" },
  ]));
  assert.deepEqual(results.map(x => x.id), ["rentcast:true-warehouse","rentcast:near-loft","rentcast:far-loft"]);
});
test("treats broad south/east language as ranking preference rather than excluding otherwise valid LA candidates",async()=>{const request=buildLiveSearchRequest("warehouse-style apartments south or east of LA"); const fetcher=async()=>new Response(JSON.stringify([sample,{...sample,id:"la-east",addressLine1:"202 East Loft",latitude:34.03,longitude:-118.1}]),{status:200}); const results=await searchRentCast(request,{rentCastApiKey:"test"},fetcher); assert.equal(results.length,2); assert.equal(results[0].id,"rentcast:la-east");});
test("uses conservative neighborhood estimates for Santa Monica commute without a Routes key",async()=>{const request=buildLiveSearchRequest("loft within 50 minutes of Santa Monica"); const fetcher=async()=>new Response(JSON.stringify([sample,{...sample,id:"weho",addressLine1:"202 WeHo Loft",city:"West Hollywood",neighborhood:"West Hollywood"},{...sample,id:"pasadena",addressLine1:"303 Pasadena Loft",city:"Pasadena",neighborhood:"Pasadena"}]),{status:200}); const results=await searchRentCast(request,{rentCastApiKey:"test"},fetcher,new Date("2026-08-25T12:00:00.000Z")); assert.deepEqual(results.map(x=>x.id).sort(),["rentcast:la-1","rentcast:weho"].sort()); const arts=results.find(x=>x.id==="rentcast:la-1"); assert.equal(arts?.commute?.estimated,true); assert.deepEqual(arts?.commute?.range,[45,50]); assert.equal(arts?.commute?.minutes,50);});
test("estimated commute uses the upper bound when enforcing a ceiling",async()=>{const request=buildLiveSearchRequest("loft within 45 minutes of Santa Monica"); const fetcher=async()=>new Response(JSON.stringify([{...sample,id:"silver",addressLine1:"Silver Lake Loft",city:"Los Angeles",neighborhood:"Silver Lake"},{...sample,id:"arts",addressLine1:"Arts Loft",neighborhood:"Arts District"}]),{status:200}); const results=await searchRentCast(request,{rentCastApiKey:"test"},fetcher); assert.deepEqual(results.map(x=>x.id),["rentcast:silver"]);});
test("adds traffic-aware commute minutes and removes over-limit routes when Routes is configured",async()=>{const request=buildLiveSearchRequest("industrial lofts within 45 minutes of Santa Monica"); let call=0; const fetcher=async()=>{call++; if(call===1)return new Response(JSON.stringify([sample,{...sample,id:"la-2",addressLine1:"202 Far Street",latitude:34.2,longitude:-117.9}]),{status:200}); return new Response(JSON.stringify([{originIndex:0,destinationIndex:0,condition:"ROUTE_EXISTS",status:{},duration:"2400s"},{originIndex:1,destinationIndex:0,condition:"ROUTE_EXISTS",status:{},duration:"3600s"}]),{status:200});}; const results=await searchRentCast(request,{rentCastApiKey:"test",googleRoutesApiKey:"google"},fetcher,new Date("2026-08-25T12:00:00.000Z")); assert.equal(results.length,1); assert.equal(results[0].commute?.minutes,40); assert.equal(results[0].commute?.estimated,false);});
test("fails explicitly when Google Routes is temporarily unavailable",async()=>{const request=buildLiveSearchRequest("loft within 45 minutes of Santa Monica"); let call=0; const fetcher=async()=>++call===1?new Response(JSON.stringify([sample]),{status:200}):new Response("unavailable",{status:503}); await assert.rejects(searchRentCast(request,{rentCastApiKey:"test",googleRoutesApiKey:"google"},fetcher),/Google Routes returned 503/);});

test("a street name like Industrial St is not loft evidence; only the listing's own text is", () => {
  const onIndustrialStreet = normalizeRentCastListing({ ...sample, description: "Bright one bedroom with parking" });
  assert.deepEqual(onIndustrialStreet.warehouseSignals, []);
  assert.deepEqual(normalizeRentCastListing({ ...sample, description: "Converted warehouse loft" }).warehouseSignals, ["Loft", "Industrial conversion"]);
});
