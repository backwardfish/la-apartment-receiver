import assert from "node:assert/strict";
import test from "node:test";
import { scoreFit } from "../app/fit.ts";
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
