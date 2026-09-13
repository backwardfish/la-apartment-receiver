import assert from "node:assert/strict";
import test from "node:test";
import { scoreBachelorPad } from "../app/archetypes.ts";

test("scores a character-rich entertaining loft as a strong bachelor pad", () => {
  const result = scoreBachelorPad({
    title: "Industrial loft with exposed brick and rooftop",
    neighborhood: "Arts District",
    city: "Los Angeles",
    rent: 3100,
    beds: 1,
    baths: 1,
    sqft: 950,
    features: ["Parking", "Laundry", "Dishwasher", "Air conditioning", "Patio"],
    warehouseSignals: ["Loft", "Industrial conversion"],
  });
  assert.ok(result.score >= 80);
  assert.match(result.reasons.join(" "), /architectural character/i);
});

test("does not mistake a generic amenity-heavy apartment for an exceptional bachelor pad", () => {
  const result = scoreBachelorPad({
    title: "Standard three-bedroom apartment",
    neighborhood: "Torrance",
    city: "Torrance",
    rent: 4200,
    beds: 3,
    baths: 2,
    sqft: 1100,
    features: ["Parking", "Laundry", "Dishwasher", "Air conditioning", "Pool"],
  });
  assert.ok(result.score < 80);
});
