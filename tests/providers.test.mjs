import assert from "node:assert/strict";
import test from "node:test";
import { buildLiveSearchRequest } from "../app/live-search.ts";
import { buildRentCastUrl, normalizeRentCastListing, searchRentCast } from "../app/providers.ts";

const sample = {
  id: "la-1",
  addressLine1: "101 Industrial Street",
  formattedAddress: "101 Industrial Street, Los Angeles, CA 90013",
  city: "Los Angeles",
  neighborhood: "Arts District",
  state: "CA",
  zipCode: "90013",
  latitude: 34.0407,
  longitude: -118.2351,
  price: 2700,
  bedrooms: 1,
  bathrooms: 1,
  squareFootage: 850,
  status: "Active",
  lastSeenDate: "2026-08-24T12:00:00.000Z",
  listingUrl: "https://example.com/listing",
  description: "Industrial loft with parking, in-unit washer and exposed brick",
};

test("normalizes a RentCast record into the Receiver contract", () => {
  const listing = normalizeRentCastListing(sample, new Date("2026-08-25T12:00:00.000Z"));
  assert.ok(listing);
  assert.equal(listing.id, "rentcast:la-1");
  assert.equal(listing.rent, 2700);
  assert.equal(listing.sourceUrl, "https://example.com/listing");
  assert.deepEqual(listing.warehouseSignals, ["Loft", "Industrial conversion"]);
  assert.deepEqual(listing.features, ["Parking", "Laundry"]);
  assert.equal(listing.freshness, "live");
});

test("builds a bounded LA RentCast query from search intent", () => {
  const request = buildLiveSearchRequest("one bedroom in West Hollywood under $2,800");
  const url = buildRentCastUrl(request);
  assert.equal(url.origin, "https://api.rentcast.io");
  assert.equal(url.searchParams.get("city"), "West Hollywood");
  assert.equal(url.searchParams.get("state"), "CA");
  assert.equal(url.searchParams.get("address"), null);
  assert.equal(url.searchParams.get("price"), "0:2800");
  assert.equal(url.searchParams.get("bedrooms"), "1:");
  assert.equal(url.searchParams.get("status"), "Active");
  assert.equal(url.searchParams.get("limit"), "50");
});

test("adds traffic-aware commute minutes and removes over-limit routes", async () => {
  const request = buildLiveSearchRequest("industrial lofts within 45 minutes of Santa Monica");
  const calls = [];
  const fetcher = async (input, init = {}) => {
    calls.push({ input: String(input), init });
    if (calls.length === 1) return new Response(JSON.stringify([
      sample,
      { ...sample, id: "la-2", addressLine1: "202 Far Street", latitude: 34.2, longitude: -117.9 },
    ]), { status: 200 });
    return new Response(JSON.stringify([
      { originIndex: 0, destinationIndex: 0, condition: "ROUTE_EXISTS", status: {}, duration: "2400s" },
      { originIndex: 1, destinationIndex: 0, condition: "ROUTE_EXISTS", status: {}, duration: "3600s" },
    ]), { status: 200 });
  };

  const now = new Date("2026-08-25T12:00:00.000Z");
  const results = await searchRentCast(request, {
    rentCastApiKey: "rentcast-test",
    googleRoutesApiKey: "google-test",
  }, fetcher, now);

  assert.equal(results.length, 1);
  assert.equal(results[0].commute?.minutes, 40);
  assert.equal(results[0].commute?.origin, "santa monica");
  assert.equal(calls[0].init.headers["X-Api-Key"], "rentcast-test");
  assert.equal(calls[1].init.headers["X-Goog-Api-Key"], "google-test");
  const routeRequest = JSON.parse(calls[1].init.body);
  assert.equal(routeRequest.routingPreference, "TRAFFIC_AWARE");
  assert.equal(routeRequest.origins.length, 2);
  assert.equal(routeRequest.destinations.length, 1);
});

test("fails explicitly when Google Routes is temporarily unavailable", async () => {
  const request = buildLiveSearchRequest("loft within 45 minutes of Santa Monica");
  let call = 0;
  const fetcher = async () => {
    call += 1;
    if (call === 1) return new Response(JSON.stringify([sample]), { status: 200 });
    return new Response("unavailable", { status: 503 });
  };

  await assert.rejects(
    searchRentCast(request, {
      rentCastApiKey: "rentcast-test",
      googleRoutesApiKey: "google-test",
    }, fetcher, new Date("2026-08-25T12:00:00.000Z")),
    /Google Routes returned 503/,
  );
});
