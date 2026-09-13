import { parseSearchIntent, type SearchIntent } from "./search-intent.ts";

export type ListingFreshness = "live" | "recent" | "needs-verification" | "stale";

export type LiveListing = {
  id: string;
  title: string;
  neighborhood: string;
  city: string;
  rent: number;
  beds: number;
  baths: number;
  sqft?: number;
  available?: string;
  source: string;
  sourceUrl: string;
  image: string;
  features: string[];
  freshness: ListingFreshness;
  capturedAt: string;
  lastSeenAt?: string;
  warehouseSignals: string[];
  commute?: {
    origin: string;
    minutes: number;
    verifiedAt: string;
    estimated?: boolean;
    range?: [number, number];
  };
};

export type LiveSearchRequest = {
  query: string;
  intent: SearchIntent;
};

export type LiveSearchSuccess = {
  status: "ok";
  query: string;
  searchedAt: string;
  results: LiveListing[];
  provider: string;
};

export type LiveSearchUnavailable = {
  status: "unconfigured" | "unavailable";
  code: string;
  message: string;
};

export type LiveSearchResponse = LiveSearchSuccess | LiveSearchUnavailable;

export function buildLiveSearchRequest(query: string): LiveSearchRequest {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) throw new Error("Describe the apartment you want before searching.");
  if (trimmedQuery.length > 500) throw new Error("Keep the apartment search under 500 characters.");
  return { query: trimmedQuery, intent: parseSearchIntent(trimmedQuery) };
}

export function isLiveSearchResponse(value: unknown): value is LiveSearchResponse {
  if (!value || typeof value !== "object" || !("status" in value)) return false;
  const response = value as { status?: unknown; results?: unknown; query?: unknown; searchedAt?: unknown; provider?: unknown };
  if (response.status === "unconfigured" || response.status === "unavailable") {
    const unavailable = value as { code?: unknown; message?: unknown };
    return typeof unavailable.code === "string" && typeof unavailable.message === "string";
  }
  return response.status === "ok"
    && typeof response.query === "string"
    && typeof response.searchedAt === "string"
    && typeof response.provider === "string"
    && Array.isArray(response.results);
}

export async function requestLiveSearch(query: string, signal?: AbortSignal): Promise<LiveSearchResponse> {
  const payload = buildLiveSearchRequest(query);
  const response = await fetch("/api/search", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    signal,
  });

  const body: unknown = await response.json().catch(() => null);
  if (!isLiveSearchResponse(body)) {
    throw new Error("Receiver received an invalid response from the live-search service.");
  }
  return body;
}
