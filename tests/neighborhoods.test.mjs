import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_NEIGHBORHOOD, LA_NEIGHBORHOODS, MVP_NEIGHBORHOODS, isNeighborhoodKey, neighborhoodLabel } from "../app/neighborhoods.ts";
import { AREA_CENTERS } from "../app/providers.ts";

test("LA neighborhood registry is unique, bounded, and shared with provider geography", () => {
  const keys = LA_NEIGHBORHOODS.map((area) => area.key);
  assert.equal(new Set(keys).size, keys.length);
  assert.ok(MVP_NEIGHBORHOODS.length >= 15);
  assert.ok(isNeighborhoodKey(DEFAULT_NEIGHBORHOOD));
  for (const area of LA_NEIGHBORHOODS) {
    assert.ok(area.radiusMiles > 0 && area.radiusMiles <= 4, area.key);
    assert.ok(area.latitude > 33 && area.latitude < 35, area.key);
    assert.ok(area.longitude < -117 && area.longitude > -119, area.key);
    assert.deepEqual(AREA_CENTERS[area.key], {
      label: area.label,
      latitude: area.latitude,
      longitude: area.longitude,
      radiusMiles: area.radiusMiles,
    });
  }
});

test("MVP dropdown labels are human-readable and unsupported keys fail validation", () => {
  assert.equal(neighborhoodLabel("arts district"), "Arts District");
  assert.equal(neighborhoodLabel("ucla"), "Westwood / UCLA");
  assert.equal(isNeighborhoodKey("not-a-neighborhood"), false);
  assert.ok(MVP_NEIGHBORHOODS.every((area) => area.mvp));
});
