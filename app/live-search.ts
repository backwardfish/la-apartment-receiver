import { parseSearchIntent, type SearchIntent } from "./search-intent.ts";
import { isNeighborhoodKey, type NeighborhoodKey } from "./neighborhoods.ts";

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
  /** A–D loft/warehouse grade derived from the listing's own text and build year. */
  styleGrade?: "A" | "B" | "C" | "D";
  /** Provider-text cautions such as short-term rental language; shown, never hidden. */
  cautions?: string[];
  yearBuilt?: number;
  /** Days the listing has been on the source site, when the source reports it. */
  listedDaysAgo?: number;
  /** Requested area this listing falls inside, when the search named areas with known coordinates. */
  area?: string;
  /** Straight-line miles from the centre of `area`. */
  distanceMiles?: number;
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
  neighborhood: NeighborhoodKey;
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

/** An asynchronous provider accepted the search; poll `/api/search-status?id=` until it resolves. */
export type LiveSearchPending = {
  status: "pending";
  searchId: string;
  pollAfterMs: number;
  provider: string;
  finished?: number;
  total?: number;
  elapsedMs?: number;
};

export type LiveSearchResponse = LiveSearchSuccess | LiveSearchUnavailable | LiveSearchPending;
export type LiveSearchOutcome = LiveSearchSuccess | LiveSearchUnavailable;

export function buildLiveSearchRequest(query: string, neighborhood: unknown): LiveSearchRequest {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) throw new Error("Describe the apartment you want before searching.");
  if (trimmedQuery.length > 500) throw new Error("Keep the apartment search under 500 characters.");
  if (!isNeighborhoodKey(neighborhood)) throw new Error("Choose a supported Los Angeles neighborhood.");
  const parsed = parseSearchIntent(trimmedQuery);
  return {
    query: trimmedQuery,
    neighborhood,
    intent: { ...parsed, locations: [neighborhood], locationQuery: neighborhood },
  };
}

export function isLiveSearchResponse(value: unknown): value is LiveSearchResponse {
  if (!value || typeof value !== "object" || !("status" in value)) return false;
  const response = value as { status?: unknown; results?: unknown; query?: unknown; searchedAt?: unknown; provider?: unknown };
  if (response.status === "unconfigured" || response.status === "unavailable") {
    const unavailable = value as { code?: unknown; message?: unknown };
    return typeof unavailable.code === "string" && typeof unavailable.message === "string";
  }
  if (response.status === "pending") {
    const pending = value as { searchId?: unknown; pollAfterMs?: unknown };
    return typeof pending.searchId === "string" && /^[0-9a-f-]{36}$/.test(pending.searchId) && typeof pending.pollAfterMs === "number" && typeof response.provider === "string";
  }
  return response.status === "ok"
    && typeof response.query === "string"
    && typeof response.searchedAt === "string"
    && typeof response.provider === "string"
    && Array.isArray(response.results);
}

/** Give up on an asynchronous search after this long; the server keeps its own deadline. */
export const CLIENT_SEARCH_DEADLINE_MS = 165_000;

export type SearchProgress = { elapsedMs: number; finished?: number; total?: number; provider: string };

async function readEnvelope(response: Response): Promise<LiveSearchResponse> {
  const body: unknown = await response.json().catch(() => null);
  if (isLiveSearchResponse(body) && (response.ok || (body.status !== 'ok' && body.status !== 'pending'))) return body;
  if (response.status === 429) return { status: 'unavailable', code: 'rate_limited', message: 'Too many searches. Please wait a minute and try again.' };
  throw new Error("Receiver received an invalid response from the live-search service.");
}

export async function requestLiveSearch(query: string, neighborhood: NeighborhoodKey, signal?: AbortSignal, onProgress?: (progress: SearchProgress) => void, fetcher: typeof fetch = fetch, wait: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms))): Promise<LiveSearchOutcome> {
  const payload = buildLiveSearchRequest(query, neighborhood);
  const response = await fetcher("/api/search", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: payload.query, neighborhood: payload.neighborhood }),
    signal,
  });
  let envelope = await readEnvelope(response);
  const startedAt = Date.now();
  while (envelope.status === "pending") {
    if (signal?.aborted) throw new Error("Search cancelled");
    const elapsedMs = Date.now() - startedAt;
    onProgress?.({ elapsedMs, finished: envelope.finished, total: envelope.total, provider: envelope.provider });
    if (elapsedMs > CLIENT_SEARCH_DEADLINE_MS) return { status: "unavailable", code: "search_timeout", message: "The live search is taking longer than expected. Try again in a minute; a finished search will be reused for a few hours." };
    await wait(Math.min(Math.max(envelope.pollAfterMs, 1_000), 10_000));
    const poll = await fetcher(`/api/search-status?id=${encodeURIComponent(envelope.searchId)}`, { headers: { accept: "application/json" }, signal });
    envelope = await readEnvelope(poll);
  }
  return envelope;
}
