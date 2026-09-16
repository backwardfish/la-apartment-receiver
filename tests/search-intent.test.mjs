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
  const intent = parseSearchIntent("West Hollywood under $2,800");
  assert.equal(intent.locationQuery, "west hollywood");
  const results = tailorListings(fixtures, intent);
  assert.deepEqual(results.map((listing) => listing.neighborhood), ["West Hollywood"]);
});

test("recognizes a bare neighborhood followed by an amenity", () => {
  const intent = parseSearchIntent("Santa Monica with laundry");
  assert.equal(intent.locationQuery, "santa monica");
  assert.deepEqual(intent.requiredFeatures, ["Laundry"]);
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
  assert.equal(intent.locationQuery, undefined);
});

test('commute destinations do not narrow inventory to that city', () => {
  assert.equal(parseSearchIntent('one bedroom within 45 minutes of Santa Monica').locationQuery, undefined);
  assert.equal(parseSearchIntent('loft in Silver Lake within 45 minutes of Santa Monica').locationQuery, 'silver lake');
  assert.equal(parseSearchIntent('loft in Santa Monica within 45 minutes of Pasadena').locationQuery, 'santa monica');
});

test('unfurnished searches do not accidentally require furnished listings', () => {
  assert.ok(!parseSearchIntent('an unfurnished apartment with parking').requiredFeatures.includes('Furnished'));
  assert.ok(parseSearchIntent('a furnished apartment with parking').requiredFeatures.includes('Furnished'));
});

test("recognises USC, UCLA, and Downtown LA clusters as alternatives in one brief", () => {
  const intent = parseSearchIntent("Find me a warehouse-style apartment, loft, or bachelor-pad type place near UCLA, USC, or the Arts District in Downtown LA");
  assert.deepEqual(intent.locations, ["ucla", "usc", "arts district", "downtown los angeles"]);
  assert.equal(intent.locationQuery, "ucla");
  assert.equal(intent.warehouseStyle, true);
  assert.equal(intent.bachelorPad, true);
  assert.deepEqual(intent.searchTerms, [], "area names and archetype words are not leftover ranking noise");
  assert.match(describeSearchIntent(intent), /near UCLA \/ USC \/ Arts District \/ Downtown LA/);
  assert.deepEqual(parseSearchIntent("apartment in University Park near Exposition Park").locations, ["usc"]);
  assert.deepEqual(parseSearchIntent("studio in Westwood Village").locations, ["ucla"]);
  assert.deepEqual(parseSearchIntent("one bedroom in West Hollywood").locations, ["west hollywood"], "West Hollywood is not also Hollywood");
});

test("loft descriptors such as exposed brick and high ceilings count as warehouse intent", () => {
  for (const query of ["exposed brick and high ceilings downtown", "open floor plan converted building", "live/work space"]) {
    assert.equal(parseSearchIntent(query).warehouseStyle, true, query);
  }
  assert.equal(parseSearchIntent("quiet one bedroom with parking").warehouseStyle, false);
});

test("a loft brief hides generic snapshot listings instead of ranking them as strong matches", () => {
  const snapshot = [
    ...fixtures,
    { title: "Studio loft with two parking spaces in Hollywood", neighborhood: "Hollywood", city: "Los Angeles", rent: 2050, beds: 0, features: ["Parking", "Laundry"] },
  ];
  assert.deepEqual(tailorListings(snapshot, parseSearchIntent("Industrial loft with parking")).map((listing) => listing.title), ["Studio loft with two parking spaces in Hollywood"]);
  assert.deepEqual(tailorListings(snapshot, parseSearchIntent("loft in Arts District")), []);
  assert.equal(tailorListings(snapshot, parseSearchIntent("parking")).length, 3);
});
