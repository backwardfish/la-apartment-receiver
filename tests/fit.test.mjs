import assert from "node:assert/strict";
import test from "node:test";
import { scoreFit, presentSnapshot } from "../app/fit.ts";
import { parseSearchIntent } from "../app/search-intent.ts";

const loftBrief = parseSearchIntent("warehouse loft near the Arts District");
const openBrief = parseSearchIntent("one bedroom under $3,000");

test("fit rewards evidence and cannot make a generic listing look like a strong loft match", () => {
  const authentic = scoreFit({ area: "Arts District", warehouseSignals: ["Loft", "Industrial conversion"], freshness: "live" }, loftBrief);
  const someLoft = scoreFit({ area: "Arts District", warehouseSignals: ["Loft"], freshness: "live" }, loftBrief);
  const generic = scoreFit({ area: "Arts District", warehouseSignals: [], freshness: "live" }, loftBrief);
  const staleGeneric = scoreFit({ area: "Arts District", warehouseSignals: [], freshness: "stale" }, loftBrief);
  const outsideArea = scoreFit({ warehouseSignals: ["Loft"], freshness: "live" }, loftBrief);
  assert.ok(authentic > someLoft && someLoft > generic && generic > staleGeneric, `${authentic} > ${someLoft} > ${generic} > ${staleGeneric}`);
  assert.ok(authentic >= 90 && generic <= 70 && staleGeneric <= 50, "generic listings no longer sit in the 76–99 band");
  assert.ok(outsideArea < someLoft, "a loft outside every requested area scores below one inside");
});

test("fit without a requested area or style stays modest and freshness still matters", () => {
  const live = scoreFit({ warehouseSignals: [], freshness: "live" }, openBrief);
  const unknown = scoreFit({ warehouseSignals: [], freshness: "needs-verification" }, openBrief);
  assert.equal(live, 60);
  assert.equal(unknown, 50);
  assert.equal(scoreFit({ warehouseSignals: [], freshness: "live", commute: { origin: "santa monica", minutes: 12, verifiedAt: "2026-09-15T00:00:00Z" } }, openBrief), 68);
});


test("snapshot fit and uncertainty follow the active loft brief instead of preset marketing scores", () => {
  const intent = { raw: 'Industrial loft with parking', warehouseStyle: true, locations: [], requiredFeatures: ['Parking'], maxRent: 3500 };
  const generic = { title: 'Conventional one bedroom', features: ['Parking'], fit: 94, why: ['Under your $2,800 ceiling'], unknowns: [] };
  const loft = { ...generic, title: 'Converted warehouse loft with exposed brick', fit: 78 };
  const first = presentSnapshot(generic, intent);
  const second = presentSnapshot(loft, intent);
  assert.ok(first.fit < second.fit);
  assert.ok(first.fit < 60);
  assert.ok(first.unknowns.includes('No loft or industrial evidence in the snapshot'));
  assert.ok(first.why.includes('Within your $3,500 ceiling'));
  assert.ok(!first.why.some(reason => reason.includes('2,800')));
  assert.ok(!second.unknowns.some(reason => reason.startsWith('No loft')));
  assert.equal(second.styleGrade, 'A');
});

test("otherwise similar apartments vary with rent headroom in the active brief", () => {
  const listing = { area: 'Hollywood', warehouseSignals: [], styleGrade: 'D', freshness: 'live', beds: 1, features: ['Parking'] };
  const brief = parseSearchIntent('One bedroom in Hollywood under $3,500 with parking');
  const cheap = scoreFit({ ...listing, rent: 2100 }, brief);
  const middle = scoreFit({ ...listing, rent: 2800 }, brief);
  const ceiling = scoreFit({ ...listing, rent: 3500 }, brief);
  assert.ok(cheap > middle && middle > ceiling);
  assert.equal(scoreFit({ ...listing, rent: 2100 }, parseSearchIntent('Hollywood')), scoreFit({ ...listing, rent: 3500 }, parseSearchIntent('Hollywood')), 'no implicit cheap-rent preference without a ceiling');
  assert.ok(scoreFit({ ...listing, rent: 2800 }, parseSearchIntent('Hollywood under $4,000')) > scoreFit({ ...listing, rent: 2800 }, parseSearchIntent('Hollywood under $3,000')));
});

test("requested bedrooms and amenities require actual source evidence", () => {
  const brief = parseSearchIntent('One bedroom under $3,000 with parking and laundry');
  const listing = { warehouseSignals: [], freshness: 'recent', rent: 2400 };
  const unknown = scoreFit(listing, brief);
  const partial = scoreFit({ ...listing, beds: 1, features: ['Parking'] }, brief);
  const complete = scoreFit({ ...listing, beds: 1, features: ['Parking', 'Laundry'] }, brief);
  assert.ok(complete > partial && partial > unknown);
  assert.ok(scoreFit({ ...listing, beds: 0, features: [] }, brief) < unknown);
  assert.ok(scoreFit({ ...listing, rent: 3100 }, brief) < unknown);
  assert.ok(scoreFit({ ...listing, rent: 1000 }, parseSearchIntent('between $2,000 and $3,000')) < scoreFit(listing, parseSearchIntent('between $2,000 and $3,000')));
});

test("city matches and area proximity count only when supported by the requested location", () => {
  const brief = { ...openBrief, locations: ['irvine'] };
  const listing = { warehouseSignals: [], freshness: 'recent' };
  assert.ok(scoreFit({ ...listing, city: 'Irvine' }, brief) > scoreFit({ ...listing, city: 'Anaheim' }, brief));
  const areaBrief = { ...openBrief, locations: ['hollywood'] };
  assert.ok(scoreFit({ ...listing, area: 'Hollywood', distanceMiles: 1 }, areaBrief) > scoreFit({ ...listing, area: 'Hollywood', distanceMiles: 5 }, areaBrief));
});

test("a real loft remains above a cheaper generic apartment, and snapshots use rent evidence", () => {
  const brief = parseSearchIntent('Loft under $3,500');
  const listing = { warehouseSignals: [], freshness: 'recent' };
  assert.ok(scoreFit({ ...listing, styleGrade: 'B', rent: 3500 }, brief) > scoreFit({ ...listing, styleGrade: 'D', rent: 1800 }, brief));
  const snapshot = { title: 'Conventional apartment', features: [], fit: 94, why: [], unknowns: [], rent: 2100 };
  assert.ok(presentSnapshot(snapshot, brief).fit > presentSnapshot({ ...snapshot, rent: 3500 }, brief).fit);
});
