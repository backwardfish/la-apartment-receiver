import { trustedUrl } from "./security-urls.ts";
import type { LiveListing, LiveSearchRequest, ListingFreshness } from "./live-search.ts";
import { estimateCommuteToSantaMonica, estimatePassesLimit, isSantaMonicaCommute } from "./commute-estimates.ts";
import { assessStyle, styleText } from "./style.ts";
import { LA_NEIGHBORHOODS } from "./neighborhoods.ts";

const RENTCAST_URL = "https://api.rentcast.io/v1/listings/rental/long-term";
const GOOGLE_ROUTES_URL = "https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix";
export const LA_CENTER = { latitude: 34.0522, longitude: -118.2437 };
const SEARCHABLE_CITIES = new Set(["beverly hills", "burbank", "culver city", "glendale", "long beach", "los angeles", "pasadena", "santa monica", "torrance", "west hollywood"]);
/** One provider request returns at most this many records (RentCast maximum); the byte cap still applies. */
export const MAX_PROVIDER_RECORDS = 500;
/** Widest circle a multi-area search may request; wider briefs fall back to the metro query. */
const MAX_CLUSTER_RADIUS_MILES = 12;
type Coordinate = { latitude: number; longitude: number };
export type AreaCenter = Coordinate & { radiusMiles: number; label: string };
/**
 * Approximate centres and radii (straight-line miles) for areas the intent
 * parser recognises. They bound the provider query and the post-filter; they
 * are not authoritative neighbourhood boundaries. Cities with their own
 * provider query are also listed so mixed briefs can be served in one call.
 */
export const AREA_CENTERS: Record<string, AreaCenter> = Object.fromEntries(
  LA_NEIGHBORHOODS.map(({ key, label, latitude, longitude, radiusMiles }) => [key, { label, latitude, longitude, radiusMiles }]),
);
type UnknownRecord = Record<string, unknown>;
export type ProviderConfig = { rentCastApiKey: string; googleRoutesApiKey?: string };

export function distanceMiles(a: Coordinate, b: Coordinate) {
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = toRadians(b.latitude - a.latitude), dLon = toRadians(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRadians(a.latitude)) * Math.cos(toRadians(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 3958.8 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}
/** Requested areas with known coordinates, in the order the brief named them. */
export function requestedAreas(intent: LiveSearchRequest["intent"]): AreaCenter[] {
  return intent.locations.flatMap(key => AREA_CENTERS[key] ? [AREA_CENTERS[key]] : []);
}
/** Smallest practical circle covering every requested area, or null when the brief is too spread out for one bounded query. */
export function enclosingCircle(areas: AreaCenter[]): (Coordinate & { radiusMiles: number }) | null {
  if (areas.length === 0) return null;
  const center = { latitude: areas.reduce((sum, a) => sum + a.latitude, 0) / areas.length, longitude: areas.reduce((sum, a) => sum + a.longitude, 0) / areas.length };
  const radiusMiles = Math.ceil(Math.max(...areas.map(a => distanceMiles(center, a) + a.radiusMiles)) * 10) / 10;
  return radiusMiles > MAX_CLUSTER_RADIUS_MILES ? null : { ...center, radiusMiles };
}
/** The nearest requested area whose radius contains the coordinate, if any. */
export function nearestArea(coordinate: Coordinate | null, areas: AreaCenter[]) {
  if (!coordinate || areas.length === 0) return null;
  const ranked = areas.map(area => ({ area, miles: distanceMiles(coordinate, area) })).sort((a, b) => a.miles - b.miles);
  return ranked[0].miles <= ranked[0].area.radiusMiles ? ranked[0] : null;
}

function text(value: unknown) { return typeof value === "string" && value.trim() ? value.trim() : undefined; }
function number(value: unknown) { return typeof value === "number" && Number.isFinite(value) ? value : undefined; }
export class ProviderError extends Error {
  code: string;
  constructor(code: string, message: string) { super(message); this.name = "ProviderError"; this.code = code; }
}
async function providerJson(response: Response, provider: 'rentcast' | 'routes', maxBytes: number): Promise<unknown> {
  const oversized = () => new ProviderError(`${provider}_response_too_large`, 'Provider response exceeded its size limit');
  if (Number(response.headers.get('content-length')) > maxBytes) {
    await response.body?.cancel();
    throw oversized();
  }
  const reader = response.body?.getReader();
  if (!reader) throw new ProviderError(`${provider}_invalid_payload`, 'Provider returned no JSON body');
  let bytes = 0, body = '';
  const decoder = new TextDecoder('utf-8', { fatal: true });
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) { await reader.cancel(); throw oversized(); }
      body += decoder.decode(value, { stream: true });
    }
    return JSON.parse(body + decoder.decode());
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    throw new ProviderError(`${provider}_invalid_payload`, 'Provider returned invalid or incomplete JSON');
  } finally { reader.releaseLock(); }
}
function nestedText(value: unknown, key: string) { return value && typeof value === "object" ? text((value as UnknownRecord)[key]) : undefined; }
function dateValue(value: unknown) { const valueText = text(value); if (!valueText || Number.isNaN(Date.parse(valueText))) return undefined; return new Date(valueText); }
function freshness(lastSeen: Date | undefined, now: Date): ListingFreshness { if (!lastSeen) return "needs-verification"; if (lastSeen.getTime() > now.getTime() + 300_000) return "needs-verification"; const ageDays = (now.getTime() - lastSeen.getTime()) / 86_400_000; if (ageDays <= 1) return "live"; if (ageDays <= 7) return "recent"; if (ageDays <= 30) return "needs-verification"; return "stale"; }

function listingHaystack(record: UnknownRecord) {
  const values = Array.isArray(record.features) ? record.features : [];
  return [record.propertyType, record.addressLine1, record.formattedAddress, record.description, record.petPolicy, record.furnishing, ...values]
    .filter((value): value is string => typeof value === "string").join(" ").toLowerCase();
}

function style(record: UnknownRecord) {
  // Style evidence must come from the listing's own description, type, or
  // feature list. A street name such as "Industrial St" is not evidence.
  const values = Array.isArray(record.features) ? record.features : [];
  return assessStyle(styleText([record.propertyType, record.description, ...values]), number(record.yearBuilt));
}

function features(record: UnknownRecord) { return detectFeatures(listingHaystack(record)); }
/** Canonical amenity labels from provider text; negations win over mentions. */
export function detectFeatures(haystack: string) {
  haystack = haystack.toLowerCase();
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
  const negated = new Set<string>();
  for (const [label, pattern] of [
    ["Parking", /(?:no|without) (?:assigned )?(?:parking|garage|carport)/],
    ["Laundry", /(?:no|without) (?:laundry|washer|dryer)/],
    ["Pet friendly", /no pets|pets (?:are )?(?:not allowed|prohibited)|not pet[- ]?friendly/],
    ["Furnished", /unfurnished|not furnished|no furnishings/],
  ] as const) if (pattern.test(haystack)) negated.add(label);
  return [...new Set(detected)].filter(label => !negated.has(label));
}

function listingAddress(record: UnknownRecord) { return text(record.formattedAddress) ?? [text(record.addressLine1), text(record.city), text(record.state), text(record.zipCode)].filter(Boolean).join(", "); }
function exactSourceUrl(record: UnknownRecord) { return trustedUrl(record.listingUrl, "sources") ?? trustedUrl(record.url, "sources"); }

export function normalizeRentCastListing(value: unknown, now = new Date()): LiveListing | null {
  if (!value || typeof value !== "object") return null;
  const record = value as UnknownRecord; const rent = number(record.price); const address = listingAddress(record); const id = text(record.id); const city = text(record.city); const listingUrl = exactSourceUrl(record);
  if (!id || !address || !city || rent === undefined || rent <= 0 || !listingUrl || number(record.bedrooms) === undefined || number(record.bathrooms) === undefined || Number(record.bedrooms) < 0 || Number(record.bathrooms) < 0) return null;
  const lastSeen = dateValue(record.lastSeenDate); const freshnessDate = lastSeen;
  const image = trustedUrl(record.imageUrl, "images") ?? (Array.isArray(record.photos) ? record.photos.map(value => trustedUrl(value, "images")).find(Boolean) : undefined); if (!image) return null;
  return { id: `rentcast:${id}`, title: text(record.addressLine1) ?? address, neighborhood: text(record.neighborhood) ?? city, city, rent, beds: number(record.bedrooms) ?? 0, baths: number(record.bathrooms) ?? 1, sqft: number(record.squareFootage), available: text(record.status) === "Active" ? "Listed as active" : text(record.status), source: nestedText(record.listingOffice, "name") ?? "RentCast feed", sourceUrl: listingUrl, image, features: features(record), freshness: freshness(freshnessDate, now), capturedAt: now.toISOString(), lastSeenAt: lastSeen?.toISOString(), yearBuilt: number(record.yearBuilt), ...styleFields(style(record)) };
}

function titleCase(value: string) { return value.replace(/\b\w/g, (letter) => letter.toUpperCase()); }
/** A brief naming exactly one provider-searchable city uses the provider's own city filter; everything else is a bounded circle. */
function singleCity(intent: LiveSearchRequest["intent"]) { return intent.locations.length === 1 && SEARCHABLE_CITIES.has(intent.locations[0]) ? intent.locations[0] : undefined; }
export function buildRentCastUrl(request: LiveSearchRequest) {
  const url = new URL(RENTCAST_URL); const { intent } = request; const city = singleCity(intent); const circle = city ? null : enclosingCircle(requestedAreas(intent));
  const setCircle = (center: Coordinate, radiusMiles: number) => { url.searchParams.set("latitude", center.latitude.toFixed(4)); url.searchParams.set("longitude", center.longitude.toFixed(4)); url.searchParams.set("radius", String(radiusMiles)); };
  if (city) { url.searchParams.set("city", titleCase(city)); url.searchParams.set("state", "CA"); }
  else if (circle) setCircle(circle, circle.radiusMiles);
  else if (intent.locationQuery && requestedAreas(intent).length === 0) { url.searchParams.set("address", `${titleCase(intent.locationQuery)}, Los Angeles, CA`); url.searchParams.set("radius", "3"); }
  else setCircle(LA_CENTER, 40);
  url.searchParams.set("status", "Active"); url.searchParams.set("propertyType", "Apartment|Condo|Multi-Family|Townhouse");
  if (intent.maxRent !== undefined) url.searchParams.set("price", `0:${intent.maxRent}`);
  if (intent.minBedrooms !== undefined) url.searchParams.set("bedrooms", `${intent.minBedrooms}:*`);
  url.searchParams.set("limit", String(MAX_PROVIDER_RECORDS)); return url;
}
function coordinate(listing: unknown) { if (!listing || typeof listing !== "object") return null; const record = listing as UnknownRecord; const latitude = number(record.latitude); const longitude = number(record.longitude); return latitude === undefined || longitude === undefined || Math.abs(latitude) > 90 || Math.abs(longitude) > 180 ? null : { latitude, longitude }; }
function durationMinutes(value: unknown) { const duration = text(value); const match = duration?.match(/^([\d.]+)s$/); return match ? Math.ceil(Number(match[1]) / 60) : undefined; }
function regionalPreference(item: { coordinate: { latitude: number; longitude: number } | null }, regions: Array<"south" | "east">) { if (!item.coordinate || regions.length === 0) return 0; const south = item.coordinate.latitude < 34.02; const east = item.coordinate.longitude > -118.20; return Number((regions.includes("south") && south) || (regions.includes("east") && east)); }

export function styleFields(evidence: ReturnType<typeof assessStyle>): Pick<LiveListing, "warehouseSignals" | "styleGrade" | "cautions"> {
  return { warehouseSignals: evidence.signals, styleGrade: evidence.grade, cautions: evidence.cautions };
}
export type Candidate = { index: number; listing: LiveListing | null; coordinate: Coordinate | null };
const GRADE_WEIGHT = { A: 6, B: 4, C: 1, D: 0 } as const;
/**
 * Shared post-processing for every provider: hard requirements (rent, beds,
 * features, loft evidence when asked for, requested areas), de-duplication,
 * and ranking. Ranking prefers stronger loft evidence for loft briefs, then
 * free-text term matches and regional hints, then distance to the area.
 */
export function rankCandidates(input: Candidate[], request: LiveSearchRequest): Array<Candidate & { listing: LiveListing }> {
  const seen = new Set<string>();
  const areas = requestedAreas(request.intent); const geoFilter = areas.length > 0 && !singleCity(request.intent);
  return input
    .filter((item): item is Candidate & { listing: LiveListing } => item.listing !== null)
    .filter(({ listing }) => (request.intent.maxRent === undefined || listing.rent <= request.intent.maxRent) && (request.intent.minBedrooms === undefined || listing.beds >= request.intent.minBedrooms))
    .filter(({ listing }) => request.intent.requiredFeatures.every((feature) => listing.features.includes(feature)))
    // A loft brief excludes records with no loft evidence at all; weak evidence (grade C) stays but ranks last.
    .filter(({ listing }) => !request.intent.warehouseStyle || (listing.warehouseSignals.length > 0 && listing.styleGrade !== "D"))
    // Location is a hard requirement: a listing must fall inside one of the requested areas. Records without coordinates cannot qualify.
    .map(item => { const nearest = nearestArea(item.coordinate, areas); return nearest ? { ...item, listing: { ...item.listing, area: nearest.area.label, distanceMiles: Math.round(nearest.miles * 10) / 10 } } : item; })
    .filter(({ listing }) => !geoFilter || listing.area !== undefined)
    .filter(({ listing }) => { const key = [listing.title, listing.city, listing.rent, listing.beds].join("|").toLowerCase().replace(/\s+/g, " "); if (seen.has(key)) return false; seen.add(key); return true; })
    .sort((a, b) => { const relevance = (item: typeof a) => { const listing = item.listing; const haystack = `${listing.title} ${listing.neighborhood} ${listing.city} ${listing.features.join(" ")} ${listing.warehouseSignals.join(" ")}`.toLowerCase(); return request.intent.searchTerms.filter((term) => haystack.includes(term)).length + regionalPreference(item, request.intent.preferredRegions) * 2 + (request.intent.warehouseStyle ? GRADE_WEIGHT[listing.styleGrade ?? "D"] : 0) - (listing.cautions?.some(c => c.startsWith("Short-term")) ? 3 : 0); }; return relevance(b) - relevance(a) || (a.listing.distanceMiles ?? Infinity) - (b.listing.distanceMiles ?? Infinity); });
}

export async function searchRentCast(request: LiveSearchRequest, config: ProviderConfig, fetcher: typeof fetch = fetch, now = new Date()): Promise<LiveListing[]> {
  const rentCastResponse = await fetcher(buildRentCastUrl(request), { headers: { "X-Api-Key": config.rentCastApiKey, accept: "application/json" }, redirect: "error", signal: AbortSignal.timeout(12_000) });
  if (!rentCastResponse.ok) throw new ProviderError(`rentcast_http_${rentCastResponse.status}`, `RentCast returned ${rentCastResponse.status}`);
  const payload = await providerJson(rentCastResponse, 'rentcast', 2_000_000); if (!Array.isArray(payload)) throw new ProviderError('rentcast_invalid_payload', 'RentCast returned an invalid listing payload');
  if (payload.length && !payload.some(item => normalizeRentCastListing(item, now))) throw new ProviderError("source_evidence_unavailable", "Provider records lack required source evidence");
  const candidates = rankCandidates(payload.slice(0, MAX_PROVIDER_RECORDS).map((item, index) => ({ index, listing: normalizeRentCastListing(item, now), coordinate: coordinate(item) })), request);

  const needsCommute = request.intent.commute; if (!needsCommute || candidates.length === 0) return candidates.map(({ listing }) => listing);

  if (!config.googleRoutesApiKey && isSantaMonicaCommute(needsCommute.origin)) {
    return candidates.flatMap(({ listing }) => {
      // RentCast records carry no neighbourhood, so the requested-area match (from coordinates) is the usable key.
      const estimate = estimateCommuteToSantaMonica(listing.area ?? listing.neighborhood, listing.city);
      if (!estimate || !estimatePassesLimit(estimate, needsCommute.maxMinutes)) return [];
      return [{ ...listing, commute: { origin: needsCommute.origin, minutes: estimate.maxMinutes, verifiedAt: now.toISOString(), estimated: true, range: [estimate.minMinutes, estimate.maxMinutes] as [number, number] } }];
    });
  }

  if (!config.googleRoutesApiKey) throw new Error("Google Routes is not configured for this commute-constrained search");
  const routable = candidates.filter((item) => item.coordinate).slice(0, 49); if (routable.length === 0) return [];
  const routesResponse = await fetcher(GOOGLE_ROUTES_URL, { method: "POST", headers: { "content-type": "application/json", "X-Goog-Api-Key": config.googleRoutesApiKey, "X-Goog-FieldMask": "originIndex,destinationIndex,status,condition,duration" }, redirect: "error", signal: AbortSignal.timeout(12_000), body: JSON.stringify({ origins: routable.map((item) => ({ waypoint: { location: { latLng: item.coordinate } } })), destinations: [{ waypoint: { address: `${needsCommute.origin}, CA` } }], travelMode: "DRIVE", routingPreference: "TRAFFIC_AWARE", departureTime: now.toISOString(), languageCode: "en-US", regionCode: "US" }) });
  if (!routesResponse.ok) throw new ProviderError(`routes_http_${routesResponse.status}`, `Google Routes returned ${routesResponse.status}`);
  const routes = await providerJson(routesResponse, 'routes', 100_000); if (!Array.isArray(routes)) throw new ProviderError('routes_invalid_payload', 'Google Routes returned an invalid route matrix');
  const commuteByCandidate = new Map<number, number>(); for (const value of routes) { if (!value || typeof value !== "object") continue; const route = value as UnknownRecord; const originIndex = number(route.originIndex); const minutes = durationMinutes(route.duration); if (route.condition !== "ROUTE_EXISTS" || (route.status && typeof route.status === "object" && Number((route.status as UnknownRecord).code ?? 0) !== 0) || originIndex === undefined || !Number.isInteger(originIndex) || minutes === undefined || minutes <= 0 || !Number.isFinite(minutes)) continue; const candidate = routable[originIndex]; if (candidate) commuteByCandidate.set(candidate.index, minutes); }
  return routable.flatMap(({ listing, index }) => { const minutes = commuteByCandidate.get(index); if (minutes === undefined || minutes > needsCommute.maxMinutes) return []; return [{ ...listing, commute: { origin: needsCommute.origin, minutes, verifiedAt: now.toISOString(), estimated: false } }]; });
}
