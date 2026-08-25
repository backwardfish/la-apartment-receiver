import type { LiveListing, LiveSearchRequest, ListingFreshness } from "./live-search.ts";

const RENTCAST_URL = "https://api.rentcast.io/v1/listings/rental/long-term";
const GOOGLE_ROUTES_URL = "https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix";
const LA_CENTER = { latitude: 34.0522, longitude: -118.2437 };

type UnknownRecord = Record<string, unknown>;

export type ProviderConfig = {
  rentCastApiKey: string;
  googleRoutesApiKey?: string;
};

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function number(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function dateValue(value: unknown) {
  const valueText = text(value);
  if (!valueText || Number.isNaN(Date.parse(valueText))) return undefined;
  return new Date(valueText);
}

function freshness(lastSeen: Date | undefined, now: Date): ListingFreshness {
  if (!lastSeen) return "needs-verification";
  const ageDays = Math.max(0, (now.getTime() - lastSeen.getTime()) / 86_400_000);
  if (ageDays <= 1) return "live";
  if (ageDays <= 7) return "recent";
  if (ageDays <= 30) return "needs-verification";
  return "stale";
}

function warehouseSignals(record: UnknownRecord) {
  const haystack = [
    record.propertyType,
    record.addressLine1,
    record.formattedAddress,
    record.description,
  ].filter((value): value is string => typeof value === "string").join(" ").toLowerCase();
  return [
    ["Loft", /\bloft\b/],
    ["Industrial conversion", /\bindustrial|warehouse|factory conversion|converted factory\b/],
    ["Live/work", /\blive[ /-]?work\b/],
  ].filter(([, pattern]) => (pattern as RegExp).test(haystack)).map(([label]) => label as string);
}

function features(record: UnknownRecord) {
  const values = Array.isArray(record.features) ? record.features.filter((value): value is string => typeof value === "string") : [];
  const haystack = [record.description, ...values].filter((value): value is string => typeof value === "string").join(" ").toLowerCase();
  const detected = [
    ["Parking", /parking|garage|carport/],
    ["Laundry", /laundry|washer|dryer/],
    ["Pool", /\bpool\b/],
    ["Balcony", /balcony/],
    ["Patio", /patio|outdoor space/],
    ["Dishwasher", /dishwasher/],
    ["Air conditioning", /air conditioning|\ba\/c\b|\bac\b/],
  ].filter(([, pattern]) => (pattern as RegExp).test(haystack)).map(([label]) => label as string);
  return [...new Set([...values, ...detected])];
}

function listingAddress(record: UnknownRecord) {
  return text(record.formattedAddress)
    ?? [text(record.addressLine1), text(record.city), text(record.state), text(record.zipCode)].filter(Boolean).join(", ");
}

function nestedWebsite(value: unknown) {
  return value && typeof value === "object" ? text((value as UnknownRecord).website) : undefined;
}

function sourceUrl(record: UnknownRecord, address: string) {
  return text(record.listingUrl)
    ?? text(record.url)
    ?? nestedWebsite(record.listingOffice)
    ?? nestedWebsite(record.listingAgent)
    ?? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}

export function normalizeRentCastListing(value: unknown, now = new Date()): LiveListing | null {
  if (!value || typeof value !== "object") return null;
  const record = value as UnknownRecord;
  const rent = number(record.price);
  const address = listingAddress(record);
  const id = text(record.id);
  const city = text(record.city);
  if (!id || !address || !city || rent === undefined) return null;

  const lastSeen = dateValue(record.lastSeenDate) ?? dateValue(record.listedDate);
  const image = text(record.imageUrl)
    ?? (Array.isArray(record.photos) ? record.photos.find((item): item is string => typeof item === "string") : undefined);
  return {
    id: `rentcast:${id}`,
    title: text(record.addressLine1) ?? address,
    neighborhood: text(record.neighborhood) ?? city,
    city,
    rent,
    beds: number(record.bedrooms) ?? 0,
    baths: number(record.bathrooms) ?? 1,
    sqft: number(record.squareFootage),
    available: text(record.status) === "Active" ? "Listed as active" : text(record.status),
    source: "RentCast",
    sourceUrl: sourceUrl(record, address),
    image,
    features: features(record),
    freshness: freshness(lastSeen, now),
    capturedAt: (lastSeen ?? now).toISOString(),
    warehouseSignals: warehouseSignals(record),
  };
}

export function buildRentCastUrl(request: LiveSearchRequest) {
  const url = new URL(RENTCAST_URL);
  const { intent } = request;
  if (intent.locationQuery) {
    url.searchParams.set("address", `${intent.locationQuery}, CA`);
    url.searchParams.set("radius", "12");
  } else {
    url.searchParams.set("latitude", String(LA_CENTER.latitude));
    url.searchParams.set("longitude", String(LA_CENTER.longitude));
    url.searchParams.set("radius", "40");
  }
  url.searchParams.set("status", "Active");
  url.searchParams.set("propertyType", "Apartment,Condo,Multi-Family,Townhouse");
  if (intent.maxRent !== undefined) url.searchParams.set("price", `0:${intent.maxRent}`);
  if (intent.minBedrooms !== undefined) url.searchParams.set("bedrooms", `${intent.minBedrooms}:`);
  url.searchParams.set("limit", "50");
  return url;
}

function coordinate(listing: unknown) {
  if (!listing || typeof listing !== "object") return null;
  const record = listing as UnknownRecord;
  const latitude = number(record.latitude);
  const longitude = number(record.longitude);
  return latitude === undefined || longitude === undefined ? null : { latitude, longitude };
}

function durationMinutes(value: unknown) {
  const duration = text(value);
  const match = duration?.match(/^([\d.]+)s$/);
  return match ? Math.ceil(Number(match[1]) / 60) : undefined;
}

export async function searchRentCast(
  request: LiveSearchRequest,
  config: ProviderConfig,
  fetcher: typeof fetch = fetch,
  now = new Date(),
): Promise<LiveListing[]> {
  const rentCastResponse = await fetcher(buildRentCastUrl(request), {
    headers: { "X-Api-Key": config.rentCastApiKey, accept: "application/json" },
  });
  if (!rentCastResponse.ok) throw new Error(`RentCast returned ${rentCastResponse.status}`);

  const payload: unknown = await rentCastResponse.json();
  if (!Array.isArray(payload)) throw new Error("RentCast returned an invalid listing payload");

  const candidates = payload.map((item, index) => ({
    item,
    index,
    listing: normalizeRentCastListing(item, now),
    coordinate: coordinate(item),
  })).filter((item): item is typeof item & { listing: LiveListing } => item.listing !== null);

  const needsCommute = request.intent.commute;
  if (!needsCommute || !config.googleRoutesApiKey || candidates.length === 0) {
    return candidates.map(({ listing }) => listing);
  }

  const routable = candidates.filter((item) => item.coordinate).slice(0, 49);
  if (routable.length === 0) return candidates.map(({ listing }) => listing);

  const routesResponse = await fetcher(GOOGLE_ROUTES_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "X-Goog-Api-Key": config.googleRoutesApiKey,
      "X-Goog-FieldMask": "originIndex,destinationIndex,status,condition,duration",
    },
    body: JSON.stringify({
      origins: routable.map((item) => ({ waypoint: { location: { latLng: item.coordinate } } })),
      destinations: [{ waypoint: { address: `${needsCommute.origin}, CA` } }],
      travelMode: "DRIVE",
      routingPreference: "TRAFFIC_AWARE",
      departureTime: now.toISOString(),
      languageCode: "en-US",
      regionCode: "US",
    }),
  });
  if (!routesResponse.ok) return candidates.map(({ listing }) => listing);

  const routes: unknown = await routesResponse.json();
  if (!Array.isArray(routes)) return candidates.map(({ listing }) => listing);

  const commuteByCandidate = new Map<number, number>();
  for (const value of routes) {
    if (!value || typeof value !== "object") continue;
    const route = value as UnknownRecord;
    const originIndex = number(route.originIndex);
    const minutes = durationMinutes(route.duration);
    if (route.condition !== "ROUTE_EXISTS" || originIndex === undefined || minutes === undefined) continue;
    const candidate = routable[originIndex];
    if (candidate) commuteByCandidate.set(candidate.index, minutes);
  }

  return candidates
    .map(({ listing, index }) => {
      const minutes = commuteByCandidate.get(index);
      return minutes === undefined ? listing : {
        ...listing,
        commute: { origin: needsCommute.origin, minutes, verifiedAt: now.toISOString() },
      };
    })
    .filter((listing) => !listing.commute || listing.commute.minutes <= needsCommute.maxMinutes);
}
