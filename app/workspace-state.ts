export type PersistedListing = {
  id: string;
  title: string;
  neighborhood: string;
  city: string;
  rent: number;
  beds: number;
  baths: number;
  sqft?: number;
  available: string;
  source: string;
  sourceUrl: string;
  image: string;
  features: string[];
  status: "verified" | "needs-verification" | "stale";
  capturedAt?: string;
  lastSeenAt?: string;
  fit: number;
  why: string[];
  unknowns: string[];
  redFlags: string[];
};

export type StoredWorkspaceV2 = {
  version: 2;
  saved: string[];
  rejected: string[];
  compare: string[];
  activeQuery: string;
  liveListings: PersistedListing[] | null;
};

function text(value: unknown): value is string {
  return typeof value === "string";
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(text);
}

export function sanitizePersistedListings(value: unknown): PersistedListing[] | null {
  if (value === null) return null;
  if (!Array.isArray(value)) return null;

  return value.filter((item): item is PersistedListing => {
    if (!item || typeof item !== "object") return false;
    const listing = item as Record<string, unknown>;
    return text(listing.id)
      && text(listing.title)
      && text(listing.neighborhood)
      && text(listing.city)
      && finite(listing.rent)
      && finite(listing.beds)
      && finite(listing.baths)
      && text(listing.available)
      && text(listing.source)
      && text(listing.sourceUrl)
      && text(listing.image)
      && stringArray(listing.features)
      && (listing.status === "verified" || listing.status === "needs-verification" || listing.status === "stale")
      && finite(listing.fit)
      && stringArray(listing.why)
      && stringArray(listing.unknowns)
      && stringArray(listing.redFlags);
  });
}

export function validWorkspaceIds(value: unknown, allowedIds: Set<string>, limit = Number.POSITIVE_INFINITY): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((id): id is string => typeof id === "string" && allowedIds.has(id)))].slice(0, limit);
}
