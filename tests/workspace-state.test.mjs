import assert from "node:assert/strict";
import test from "node:test";
import { sanitizePersistedListings, validWorkspaceIds } from "../app/workspace-state.ts";

const listing = {
  id: "rentcast:live-1", title: "Live loft", neighborhood: "Arts District", city: "Los Angeles",
  rent: 2800, beds: 1, baths: 1, available: "Listed as active", source: "Provider",
  sourceUrl: "https://example.com/listing", image: "https://example.com/image.jpg",
  features: ["Parking", "Pet friendly"], status: "needs-verification", fit: 88,
  why: ["Source backed"], unknowns: ["Confirm availability"], redFlags: [],
};

test("restores a valid persisted live listing", () => {
  assert.deepEqual(sanitizePersistedListings([listing]), [listing]);
});

test("drops malformed persisted listing objects", () => {
  assert.deepEqual(sanitizePersistedListings([{ ...listing, sourceUrl: 42 }]), []);
});

test("keeps live saved and compare ids when the restored listing exists", () => {
  const allowed = new Set(["rentcast:live-1", "snapshot-1"]);
  assert.deepEqual(validWorkspaceIds(["rentcast:live-1", "missing", "rentcast:live-1"], allowed), ["rentcast:live-1"]);
  assert.deepEqual(validWorkspaceIds(["snapshot-1", "rentcast:live-1"], allowed, 1), ["snapshot-1"]);
});
