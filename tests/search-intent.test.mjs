import assert from "node:assert/strict";
import test from "node:test";
import { describeSearchIntent, parseSearchIntent, tailorListings } from "../app/search-intent.ts";

const fixtures = [
  { title: "West Hollywood one-bedroom", neighborhood: "West Hollywood", city: "Los Angeles", rent: 2595, beds: 1, features: ["Parking", "Laundry"] },
  { title: "Santa Monica studio", neighborhood: "Santa Monica", city: "Santa Monica", rent: 2100, beds: 0, features: ["Laundry"] },
  { title: "Inglewood two-bedroom", neighborhood: "Inglewood", city: "Inglewood", rent: 2450, beds: 2, features: ["Parking", "Patio"] },
];

test("parses rent, bedroom, feature, and location intent", () => {
  const intent = parseSearchIntent("A 1 bedroom in West Hollywood under $2,800 with parking");
  assert.equal(intent.maxRent, 2800);
  assert.equal(intent.minBedrooms, 1);
  assert.deepEqual(intent.requiredFeatures, ["Parking"]);
  assert.equal(intent.locationQuery, "west hollywood");
  assert.deepEqual(intent.searchTerms, []);
});

test("understands a spelled-out bedroom request and keeps descriptive words as hints", () => {
  const intent = parseSearchIntent("A quiet one-bedroom in West Hollywood under $2,800 with parking");
  assert.equal(intent.minBedrooms, 1);
  assert.equal(intent.locationQuery, "west hollywood");
  assert.deepEqual(intent.searchTerms, ["quiet"]);
  assert.deepEqual(tailorListings(fixtures, intent).map((listing) => listing.neighborhood), ["West Hollywood"]);
});

test("does not discard valid listings for an unsupported descriptive preference", () => {
  const results = tailorListings(fixtures, parseSearchIntent("one bedroom under $2,800 with parking and lots of sunlight"));
  assert.deepEqual(results.map((listing) => listing.neighborhood), ["West Hollywood", "Inglewood"]);
});

test("filters a bare neighborhood suggestion as a location", () => {
  const results = tailorListings(fixtures, parseSearchIntent("West Hollywood under $2,800"));
  assert.deepEqual(results.map((listing) => listing.neighborhood), ["West Hollywood"]);
});

test("tailors results using hard requirements and descriptive terms", () => {
  const results = tailorListings(fixtures, parseSearchIntent("1 bedroom in West Hollywood under $2,800 with parking"));
  assert.deepEqual(results.map((listing) => listing.neighborhood), ["West Hollywood"]);
});

test("handles studios without losing the zero-bedroom value", () => {
  const intent = parseSearchIntent("studio in Santa Monica under $2,300");
  assert.equal(intent.minBedrooms, 0);
  assert.deepEqual(tailorListings(fixtures, intent).map((listing) => listing.neighborhood), ["Santa Monica"]);
});

test("returns no false matches when a named neighborhood is absent", () => {
  const results = tailorListings(fixtures, parseSearchIntent("one bedroom in Brentwood under $3,000"));
  assert.deepEqual(results, []);
});

test("describes parsed constraints for the active-search summary", () => {
  const summary = describeSearchIntent(parseSearchIntent("2 bedroom under $2,500 with parking"));
  assert.match(summary, /up to \$2,500/);
  assert.match(summary, /2\+ bedroom/);
  assert.match(summary, /parking/);
});

test("parses warehouse style and a one-hour Santa Monica commute constraint", () => {
  const intent = parseSearchIntent("warehouse-style apartments south or east of LA within an hour's drive of Santa Monica");
  assert.equal(intent.warehouseStyle, true);
  assert.deepEqual(intent.preferredRegions, ["south", "east"]);
  assert.deepEqual(intent.commute, { origin: "santa monica", maxMinutes: 60 });
  assert.deepEqual(intent.searchTerms, []);
  assert.match(describeSearchIntent(intent), /warehouse-style/);
  assert.match(describeSearchIntent(intent), /within 60 min drive of santa monica/);
});
