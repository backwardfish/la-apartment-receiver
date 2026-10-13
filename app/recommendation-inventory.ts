import { DIRECT_SOURCES, STALE_LIMIT_MS, fetchInventory, type SourceInventory, type SourceReport } from './direct-sources.ts';
export type RecommendationInventory = { version: 1; refreshedAt: string; inventories: SourceInventory[]; sources: SourceReport[] };
export type RecommendationCache = { get(): Promise<RecommendationInventory | null>; put(value: RecommendationInventory): Promise<void> };
export function usableRecommendationInventory(value: RecommendationInventory | null, now = Date.now()): value is RecommendationInventory {
  return !!value && value.version === 1 && Number.isFinite(Date.parse(value.refreshedAt)) && now >= Date.parse(value.refreshedAt) && now - Date.parse(value.refreshedAt) <= STALE_LIMIT_MS && Array.isArray(value.inventories) && value.inventories.length <= DIRECT_SOURCES.length && value.inventories.every(item => item.version === 1 && DIRECT_SOURCES.some(source => source.id === item.sourceId) && Array.isArray(item.listings) && item.listings.length <= 500 && Number.isFinite(Date.parse(item.checkedAt)) && now >= Date.parse(item.checkedAt) && now - Date.parse(item.checkedAt) <= STALE_LIMIT_MS);
}
export async function refreshRecommendationInventory(cache: RecommendationCache, fetcher: typeof fetch = fetch, now = new Date()): Promise<RecommendationInventory> {
  const stored = await cache.get();
  const previous = usableRecommendationInventory(stored, now.getTime()) ? stored : null;
  const parts = await Promise.all(DIRECT_SOURCES.map(async source => {
    try {
      const inventory = await fetchInventory(source, fetcher, now);
      return { inventory, report: { name: source.name, url: source.url, status: 'checked', checkedAt: inventory.checkedAt, count: inventory.listings.length } as SourceReport };
    } catch {
      const inventory = previous?.inventories.find(item => item.sourceId === source.id) ?? null;
      return { inventory, report: { name: source.name, url: source.url, status: inventory ? 'stale' : 'unavailable', ...(inventory ? { checkedAt: inventory.checkedAt } : {}), count: inventory?.listings.length ?? 0 } as SourceReport };
    }
  }));
  if (parts.every(part => !part.inventory)) throw new Error('Manager sources are unavailable; the queue was not refreshed.');
  const value: RecommendationInventory = { version: 1, refreshedAt: now.toISOString(), inventories: parts.flatMap(part => part.inventory ? [part.inventory] : []), sources: parts.map(part => part.report) };
  await cache.put(value);
  return value;
}
export function nextRecommendationRefresh(now = Date.now()): string { return new Date((Math.floor(now / 3_600_000) + 1) * 3_600_000).toISOString(); }
