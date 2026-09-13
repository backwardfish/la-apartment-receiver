import type { LiveListing, LiveSearchRequest, ListingFreshness } from "./live-search.ts";

const RENTCAST_URL = "https://api.rentcast.io/v1/listings/rental/long-term";
const GOOGLE_ROUTES_URL = "https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix";
const LA_CENTER = { latitude: 34.0522, longitude: -118.2437 };
const SEARCHABLE_CITIES = new Set(["beverly hills", "burbank", "culver city", "glendale", "long beach", "los angeles", "pasadena", "santa monica", "torrance", "west hollywood"]);
type UnknownRecord = Record<string, unknown>;
export type ProviderConfig = { rentCastApiKey: string; googleRoutesApiKey?: string };

function text(value: unknown) { return typeof value === "string" && value.trim() ? value.trim() : undefined; }
function number(value: unknown) { return typeof value === "number" && Number.isFinite(value) ? value : undefined; }
function httpUrl(value: unknown) { const valueText = text(value); if (!valueText) return undefined; try { const url = new URL(valueText); return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : undefined; } catch { return undefined; } }
function nestedText(value: unknown, key: string) { return value && typeof value === "object" ? text((value as UnknownRecord)[key]) : undefined; }
function dateValue(value: unknown) { const valueText = text(value); if (!valueText || Number.isNaN(Date.parse(valueText))) return undefined; return new Date(valueText); }
function freshness(lastSeen: Date | undefined, now: Date): ListingFreshness { if (!lastSeen) return "needs-verification"; const ageDays = Math.max(0, (now.getTime() - lastSeen.getTime()) / 86_400_000); if (ageDays <= 1) return "live"; if (ageDays <= 7) return "recent"; if (ageDays <= 30) return "needs-verification"; return "stale"; }

function listingHaystack(record: UnknownRecord) {
  const values = Array.isArray(record.features) ? record.features : [];
  return [record.propertyType, record.addressLine1, record.formattedAddress, record.description, record.petPolicy, record.furnishing, ...values]
    .filter((value): value is string => typeof value === "string").join(" ").toLowerCase();
}

function warehouseSignals(record: UnknownRecord) {
  const haystack = listingHaystack(record);
  return [["Loft", /\bloft\b/], ["Industrial conversion", /\bindustrial|warehouse|factory conversion|converted factory\b/], ["Live\/work", /\blive[ /-]?work\b/]]
    .filter(([, pattern]) => (pattern as RegExp).test(haystack)).map(([label]) => label as string);
}

// Stable UX taxonomy. Provider-specific wording is evidence; these canonical
// labels are what filtering, scoring, and presentation consume.
function features(record: UnknownRecord) {
  const haystack = listingHaystack(record);
  const detected = [
    ["Parking", /parking|garage|carport|assigned space/],
    ["Laundry", /laundry|washer|dryer|w\/d/],
    ["Pool", /\bpool\b/],
    ["Balcony", /balcony/],
    ["Patio", /patio|outdoor space|terrace/],
    ["Dishwasher", /dishwasher/],
    ["Air conditioning", /air conditioning|central air|\ba\/c\b|\bac\b/],
    ["Pet friendly", /pet friendly|pets allowed|cats allowed|dogs allowed|pet[- ]?friendly/],
    ["Furnished", /\bfurnished\b|fully furnished/],
  ].filter(([, pattern]) => (pattern as RegExp).test(haystack)).map(([label]) => label as string);
  return [...new Set(detected)];
}

function listingAddress(record: UnknownRecord) { return text(record.formattedAddress) ?? [text(record.addressLine1), text(record.city), text(record.state), text(record.zipCode)].filter(Boolean).join(", "); }
function exactSourceUrl(record: UnknownRecord) { return httpUrl(record.listingUrl) ?? httpUrl(record.url); }

export function normalizeRentCastListing(value: unknown, now = new Date()): LiveListing | null {
  if (!value || typeof value !== "object") return null;
  const record = value as UnknownRecord; const rent = number(record.price); const address = listingAddress(record); const id = text(record.id); const city = text(record.city); const listingUrl = exactSourceUrl(record);
  if (!id || !address || !city || rent === undefined || !listingUrl) return null;
  const lastSeen = dateValue(record.lastSeenDate); const freshnessDate = lastSeen ?? dateValue(record.listedDate);
  const image = httpUrl(record.imageUrl) ?? (Array.isArray(record.photos) ? record.photos.map(httpUrl).find(Boolean) : undefined); if (!image) return null;
  return { id: `rentcast:${id}`, title: text(record.addressLine1) ?? address, neighborhood: text(record.neighborhood) ?? city, city, rent, beds: number(record.bedrooms) ?? 0, baths: number(record.bathrooms) ?? 1, sqft: number(record.squareFootage), available: text(record.status) === "Active" ? "Listed as active" : text(record.status), source: nestedText(record.listingOffice, "name") ?? "RentCast feed", sourceUrl: listingUrl, image, features: features(record), freshness: freshness(freshnessDate, now), capturedAt: now.toISOString(), lastSeenAt: lastSeen?.toISOString(), warehouseSignals: warehouseSignals(record) };
}

function titleCase(value: string) { return value.replace(/\b\w/g, (letter) => letter.toUpperCase()); }
export function buildRentCastUrl(request: LiveSearchRequest) { const url = new URL(RENTCAST_URL); const { intent } = request; if (intent.locationQuery && SEARCHABLE_CITIES.has(intent.locationQuery)) { url.searchParams.set("city", titleCase(intent.locationQuery)); url.searchParams.set("state", "CA"); } else if (intent.locationQuery) { url.searchParams.set("address", `${titleCase(intent.locationQuery)}, Los Angeles, CA`); url.searchParams.set("radius", "8"); } else { url.searchParams.set("latitude", String(LA_CENTER.latitude)); url.searchParams.set("longitude", String(LA_CENTER.longitude)); url.searchParams.set("radius", "40"); } url.searchParams.set("status", "Active"); url.searchParams.set("propertyType", "Apartment,Condo,Multi-Family,Townhouse"); if (intent.maxRent !== undefined) url.searchParams.set("price", `0:${intent.maxRent}`); if (intent.minBedrooms !== undefined) url.searchParams.set("bedrooms", `${intent.minBedrooms}:`); url.searchParams.set("limit", "50"); return url; }
function coordinate(listing: unknown) { if (!listing || typeof listing !== "object") return null; const record = listing as UnknownRecord; const latitude = number(record.latitude); const longitude = number(record.longitude); return latitude === undefined || longitude === undefined ? null : { latitude, longitude }; }
function durationMinutes(value: unknown) { const duration = text(value); const match = duration?.match(/^([\d.]+)s$/); return match ? Math.ceil(Number(match[1]) / 60) : undefined; }
function regionalPreference(item: { coordinate: { latitude: number; longitude: number } | null }, regions: Array<"south" | "east">) { if (!item.coordinate || regions.length === 0) return 0; const south = item.coordinate.latitude < 34.02; const east = item.coordinate.longitude > -118.20; return Number((regions.includes("south") && south) || (regions.includes("east") && east)); }

export async function searchRentCast(request: LiveSearchRequest, config: ProviderConfig, fetcher: typeof fetch = fetch, now = new Date()): Promise<LiveListing[]> {
  const rentCastResponse = await fetcher(buildRentCastUrl(request), { headers: { "X-Api-Key": config.rentCastApiKey, accept: "application/json" }, signal: AbortSignal.timeout(12_000) });
  if (!rentCastResponse.ok) throw new Error(`RentCast returned ${rentCastResponse.status}`);
  const payload: unknown = await rentCastResponse.json(); if (!Array.isArray(payload)) throw new Error("RentCast returned an invalid listing payload");
  const seen = new Set<string>();
  const candidates = payload.map((item, index) => ({ index, listing: normalizeRentCastListing(item, now), coordinate: coordinate(item) }))
    .filter((item): item is typeof item & { listing: LiveListing } => item.listing !== null)
    .filter(({ listing }) => request.intent.requiredFeatures.every((feature) => listing.features.includes(feature)) && (!request.intent.warehouseStyle || listing.warehouseSignals.length > 0))
    .filter(({ listing }) => { const key = [listing.title, listing.city, listing.rent, listing.beds].join("|").toLowerCase().replace(/\s+/g, " "); if (seen.has(key)) return false; seen.add(key); return true; })
    .sort((a, b) => { const relevance = (item: typeof a) => { const listing = item.listing; const haystack = `${listing.title} ${listing.neighborhood} ${listing.city} ${listing.features.join(" ")} ${listing.warehouseSignals.join(" ")}`.toLowerCase(); return request.intent.searchTerms.filter((term) => haystack.includes(term)).length + regionalPreference(item, request.intent.preferredRegions) * 2; }; return relevance(b) - relevance(a); });

  const needsCommute = request.intent.commute; if (!needsCommute || candidates.length === 0) return candidates.map(({ listing }) => listing);
  if (!config.googleRoutesApiKey) throw new Error("Google Routes is not configured for a commute-constrained search");
  const routable = candidates.filter((item) => item.coordinate).slice(0, 49); if (routable.length === 0) return [];
  const routesResponse = await fetcher(GOOGLE_ROUTES_URL, { method: "POST", headers: { "content-type": "application/json", "X-Goog-Api-Key": config.googleRoutesApiKey, "X-Goog-FieldMask": "originIndex,destinationIndex,status,condition,duration" }, signal: AbortSignal.timeout(12_000), body: JSON.stringify({ origins: routable.map((item) => ({ waypoint: { location: { latLng: item.coordinate } } })), destinations: [{ waypoint: { address: `${needsCommute.origin}, CA` } }], travelMode: "DRIVE", routingPreference: "TRAFFIC_AWARE", departureTime: now.toISOString(), languageCode: "en-US", regionCode: "US" }) });
  if (!routesResponse.ok) throw new Error(`Google Routes returned ${routesResponse.status}`);
  const routes: unknown = await routesResponse.json(); if (!Array.isArray(routes)) throw new Error("Google Routes returned an invalid route matrix");
  const commuteByCandidate = new Map<number, number>(); for (const value of routes) { if (!value || typeof value !== "object") continue; const route = value as UnknownRecord; const originIndex = number(route.originIndex); const minutes = durationMinutes(route.duration); if (route.condition !== "ROUTE_EXISTS" || originIndex === undefined || minutes === undefined) continue; const candidate = routable[originIndex]; if (candidate) commuteByCandidate.set(candidate.index, minutes); }
  return routable.flatMap(({ listing, index }) => { const minutes = commuteByCandidate.get(index); if (minutes === undefined || minutes > needsCommute.maxMinutes) return []; return [{ ...listing, commute: { origin: needsCommute.origin, minutes, verifiedAt: now.toISOString() } }]; });
}
