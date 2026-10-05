import { getStore } from '@netlify/blobs';
import { createHash } from 'node:crypto';
import type { LiveListing } from './live-search.ts';
import type { SearchIntent } from './search-intent.ts';
import { ProviderError } from './providers.ts';
import type { StartedRun } from './zillow-apify.ts';
import { isNeighborhoodKey, isNeighborhoodSelection, type NeighborhoodKey } from './neighborhoods.ts';

/**
 * Durable records for asynchronous live searches. A record holds the provider
 * run identifiers, the original query text (so results can be re-ranked with
 * the same intent), and, once finished, the normalised results. Records hold
 * no credentials, IPs, or account data; the query text is what the user typed.
 */
export type SearchRecord = {
  id: string;
  createdAt: string;
  query: string;
  provider: 'zillow-apify';
  cacheKey: string;
  runs: StartedRun[];
  status: 'running' | 'done' | 'failed';
  results?: LiveListing[];
  code?: string;
  completedAt?: string;
  usageUsd?: number;
} & ({ version: 2; neighborhood: NeighborhoodKey; neighborhoods?: never }
  | { version: 3; neighborhoods: NeighborhoodKey[]; neighborhood?: never });

export type SearchStore = {
  get(id: string): Promise<SearchRecord | null>;
  put(record: SearchRecord): Promise<void>;
  cachedSearchId(cacheKey: string): Promise<string | null>;
  rememberCache(cacheKey: string, searchId: string): Promise<void>;
};

export const SEARCH_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** Completed searches for the same normalised brief are reused for this long. */
export const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

/** Cache complete ranked results only for the same normalized scope and ranking intent. */
export function cacheKeyFor(intent: SearchIntent, _query = ""): string {
  // Retain the query argument for existing callers; parsed intent defines cache identity.
  void _query;
  const canonical = JSON.stringify({
    version: 4,
    locations: [...new Set(intent.locations)].sort(),
    searchTerms: [...intent.searchTerms].sort(),
    bachelorPad: intent.bachelorPad,
    preferredRegions: [...intent.preferredRegions].sort(),
    minRent: intent.minRent ?? null,
    maxRent: intent.maxRent ?? null,
    minBedrooms: intent.minBedrooms ?? null,
    features: [...intent.requiredFeatures].sort(),
    warehouseStyle: intent.warehouseStyle,
    commute: intent.commute ?? null,
  });
  return createHash('sha256').update(canonical).digest('hex').slice(0, 32);
}

export function isFreshRecord(record: SearchRecord, now = Date.now()): boolean {
  return record.status === 'done' && !!record.completedAt && now - Date.parse(record.completedAt) < CACHE_TTL_MS;
}

export function readSearchRecord(value: unknown): SearchRecord | null {
    if (!value || typeof value !== 'object') return null;
    const candidate = value as SearchRecord;
    if (![2, 3].includes(candidate.version) || !SEARCH_ID_PATTERN.test(candidate.id) || typeof candidate.query !== 'string' || !(candidate.version === 2 ? isNeighborhoodKey(candidate.neighborhood) : isNeighborhoodSelection(candidate.neighborhoods)) || !Array.isArray(candidate.runs) || !['running', 'done', 'failed'].includes(candidate.status)) return null;
    return candidate;
}

function unavailable(): never { throw new ProviderError('search_store_unavailable', 'Search storage is unavailable'); }

export function searchStore(options: { name?: string; siteID?: string; token?: string; fetcher?: typeof fetch; signal?: AbortSignal } = {}): SearchStore {
  const store = getStore({
    name: options.name ?? 'receiver-live-searches-v1',
    consistency: 'strong',
    ...(options.siteID ? { siteID: options.siteID } : {}),
    ...(options.token ? { token: options.token } : {}),
    fetch: async (input, init) => {
      const signal = options.signal ?? AbortSignal.timeout(8_000);
      if (signal.aborted) unavailable();
      const result = await (options.fetcher ?? fetch)(input, { ...init, redirect: 'error', signal });
      const method = init?.method?.toUpperCase() ?? 'GET';
      if (result.status !== 200 && !(method === 'GET' && result.status === 404)) unavailable();
      return result;
    },
  });

  return {
    get: async (id) => readSearchRecord(await store.get(`search/${id}`, { type: 'json', consistency: 'strong' })),
    put: async (value) => { await store.setJSON(`search/${value.id}`, value); },
    cachedSearchId: async (cacheKey) => {
      const value = await store.get(`cache/${cacheKey}`, { type: 'json', consistency: 'strong' }) as { searchId?: unknown } | null;
      return value && typeof value.searchId === 'string' && SEARCH_ID_PATTERN.test(value.searchId) ? value.searchId : null;
    },
    rememberCache: async (cacheKey, searchId) => { await store.setJSON(`cache/${cacheKey}`, { searchId, savedAt: new Date().toISOString() }); },
  };
}
