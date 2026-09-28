import assert from "node:assert/strict";
import test from "node:test";
import { sanitizePersistedListings, validWorkspaceIds, persistWorkspace, restoreWorkspace, retainWorkspaceListings, clearWorkspace, STORAGE_KEY } from "../app/workspace-state.ts";
import { scoreBachelorPad } from "../app/archetypes.ts";

const listing = {
  id: "rentcast:live-1", title: "Live loft", neighborhood: "Arts District", city: "Los Angeles",
  rent: 2800, beds: 1, baths: 1, available: "Listed as active", source: "Provider",
  sourceUrl: "https://lapmg.appfolio.com/listings/detail/test", image: "https://images.cdn.appfolio.com/image.jpg",
  features: ["Parking", "Pet friendly"], status: "needs-verification", fit: 88,
  why: ["Source backed"], unknowns: ["Confirm availability"], redFlags: [],
};

test("restores a valid persisted live listing", () => {
  assert.deepEqual(sanitizePersistedListings([listing]), [listing]);
});

test("drops malformed persisted listing objects", () => {
  assert.deepEqual(sanitizePersistedListings([{ ...listing, sourceUrl: 42 }]), []);
});

test("preserves only trusted, unique gallery URLs with the primary image first", () => {
  const secondImage = "https://images.cdn.appfolio.com/second.jpg";
  const [clean] = sanitizePersistedListings([{...listing, images:[secondImage, listing.image, "https://evil.test/image.jpg", secondImage]}]);
  assert.deepEqual(clean.images, [listing.image, secondImage]);
});

test("live galleries survive workspace persistence and reload", () => {
  const data = new Map();
  globalThis.localStorage = { getItem: key => data.get(key) ?? null, setItem: (key,value) => data.set(key,value), removeItem: key => data.delete(key) };
  const images = [listing.image, "https://images.cdn.appfolio.com/gallery.jpg"];
  assert.ok(persistWorkspace({saved:[],compare:[],rejected:[],activeQuery:"loft",activeNeighborhood:"arts district",liveListings:[{...listing,images}]}));
  assert.deepEqual(restoreWorkspace([]).liveListings[0].images, images);
  clearWorkspace();
  delete globalThis.localStorage;
});

test("keeps live saved and compare ids when the restored listing exists", () => {
  const allowed = new Set(["rentcast:live-1", "snapshot-1"]);
  assert.deepEqual(validWorkspaceIds(["rentcast:live-1", "missing", "rentcast:live-1"], allowed), ["rentcast:live-1"]);
  assert.deepEqual(validWorkspaceIds(["snapshot-1", "rentcast:live-1"], allowed, 1), ["snapshot-1"]);
});

test('saved evidence and archetype ranking survive replacing results, pause fallback, and reload', () => {
  const data = new Map();
  globalThis.localStorage = { getItem: key => data.get(key) ?? null, setItem: (key,value) => data.set(key,value), removeItem: key => data.delete(key) };
  const original = {...listing, title:'101 Main Street', images:[listing.image,'https://images.cdn.appfolio.com/gallery.jpg'], warehouseSignals:['Industrial conversion']};
  const retainedListings = retainWorkspaceListings([], [original], [original.id]);
  for (const liveListings of [[], null, [{...listing,id:'rentcast:new'}]]) {
    assert.ok(persistWorkspace({saved:[original.id],compare:[original.id],rejected:[],activeQuery:'a different search',liveListings,retainedListings}));
    const restored = restoreWorkspace([]);
    assert.deepEqual(restored.saved,[original.id]);
    assert.deepEqual(restored.compare,[original.id]);
    assert.equal(restored.retainedListings[0].sourceUrl, original.sourceUrl);
    assert.deepEqual(restored.retainedListings[0].images, original.images);
    assert.deepEqual(scoreBachelorPad(restored.retainedListings[0]), scoreBachelorPad(original));
  }
  clearWorkspace();
  delete globalThis.localStorage;
});

test('v3 migration preserves snapshot saves alongside live results and clear removes only workspace keys', () => {
  const data = new Map([['unrelated-app','keep']]);
  globalThis.localStorage = { getItem: key => data.get(key) ?? null, setItem: (key,value) => data.set(key,value), removeItem: key => data.delete(key) };
  const snapshot={...listing,id:'snapshot-1'};
  data.set('receiver:workspace:v3',JSON.stringify({version:3,savedAt:Date.now(),saved:[snapshot.id,listing.id],compare:[],rejected:[],activeQuery:'loft',liveListings:[listing]}));
  const restored=restoreWorkspace([snapshot]);
  assert.deepEqual(restored.saved,[snapshot.id,listing.id]);
  assert.deepEqual(restored.retainedListings.map(x=>x.id),[snapshot.id,listing.id]);
  assert.ok(persistWorkspace({...restored,liveListings:[]}));
  assert.deepEqual(restoreWorkspace([snapshot]).saved,[snapshot.id,listing.id]);
  assert.ok(persistWorkspace(restored));
  assert.ok(data.has(STORAGE_KEY));
  assert.ok(!data.has('receiver:workspace:v3'));
  clearWorkspace();
  assert.deepEqual([...data],[['unrelated-app','keep']]);
  delete globalThis.localStorage;
});

test('retained listings use refreshed evidence, drop unselected records, and still reject unsafe URLs', () => {
  const updated={...listing,rent:2600};
  assert.equal(retainWorkspaceListings([listing],[updated],[listing.id])[0].rent,2600);
  assert.deepEqual(retainWorkspaceListings([listing],[],[]),[]);
  assert.deepEqual(retainWorkspaceListings([],[{...listing,image:'https://evil.test/image.jpg'}],[listing.id]),[]);
});


test('multi-area workspaces round-trip and v4 single-area searches migrate without losing saved evidence', () => {
  const data = new Map();
  globalThis.localStorage = { getItem: key => data.get(key) ?? null, setItem: (key,value) => data.set(key,value), removeItem: key => data.delete(key) };
  try {
    const workspace = { saved:[listing.id], compare:[listing.id], rejected:[], activeQuery:'loft', activeNeighborhoods:['koreatown','arts district'], liveListings:[listing] };
    assert.ok(persistWorkspace(workspace));
    assert.deepEqual(restoreWorkspace([]).activeNeighborhoods, ['arts district','koreatown']);
    assert.equal(restoreWorkspace([]).liveListings.length, 1);
    clearWorkspace();
    data.set('receiver:workspace:v4', JSON.stringify({ ...workspace, version:4, savedAt:Date.now(), activeNeighborhood:'arts district', activeNeighborhoods:undefined }));
    const migrated = restoreWorkspace([]);
    assert.deepEqual(migrated.activeNeighborhoods, ['arts district']);
    assert.deepEqual(migrated.saved, [listing.id]);
    assert.ok(persistWorkspace(migrated));
    assert.ok(!data.has('receiver:workspace:v4'));
    const corrupted = JSON.parse(data.get(STORAGE_KEY));
    corrupted.activeNeighborhoods = ['not-real'];
    data.set(STORAGE_KEY, JSON.stringify(corrupted));
    assert.equal(restoreWorkspace([]).liveListings, null);
    assert.deepEqual(restoreWorkspace([]).saved, [listing.id]);
  } finally { delete globalThis.localStorage; }
});
