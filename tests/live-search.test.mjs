import assert from "node:assert/strict";
import test from "node:test";
import { buildLiveSearchRequest, isLiveSearchResponse } from "../app/live-search.ts";

test("builds a normalized request for the live-search endpoint", () => {
  const request = buildLiveSearchRequest("industrial lofts east of LA within 45 minutes of Santa Monica");
  assert.equal(request.query, "industrial lofts east of LA within 45 minutes of Santa Monica");
  assert.equal(request.intent.warehouseStyle, true);
  assert.deepEqual(request.intent.preferredRegions, ["east"]);
  assert.deepEqual(request.intent.commute, { origin: "santa monica", maxMinutes: 45 });
});

test("accepts only the expected live-search response envelope", () => {
  assert.equal(isLiveSearchResponse({ status: "unconfigured", code: "search_not_configured", message: "Set up a provider" }), true);
  assert.equal(isLiveSearchResponse({ status: "ok", query: "loft", searchedAt: "2026-08-18T00:00:00.000Z", provider: "test", results: [] }), true);
  assert.equal(isLiveSearchResponse({ status: "ok", results: [] }), false);
});
