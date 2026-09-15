import type { LiveListing } from "./live-search.ts";
import type { SearchIntent } from "./search-intent.ts";

/**
 * Fit is a 0–99 evidence score, not a probability. It starts at 40 and only
 * rises on evidence the provider actually supplied: inside a requested area
 * (+20), loft/industrial signals (+15 each, max 30, when the brief asked for
 * them), provider freshness (+10 live / +7 recent / −10 stale), and a verified
 * commute (up to +10). A generic listing therefore cannot score like a match.
 */
export function scoreFit(
  l: Pick<LiveListing, "area" | "warehouseSignals" | "freshness" | "commute">,
  intent: Pick<SearchIntent, "warehouseStyle" | "locations">,
): number {
  const locationFit = l.area ? 20 : intent.locations.length ? 0 : 10;
  const styleFit = intent.warehouseStyle ? Math.min(l.warehouseSignals.length * 15, 30) : Math.min(l.warehouseSignals.length * 4, 8);
  const freshnessFit = l.freshness === "live" ? 10 : l.freshness === "recent" ? 7 : l.freshness === "stale" ? -10 : 0;
  const commuteFit = l.commute ? Math.max(0, 10 - Math.floor(l.commute.minutes / 6)) : 0;
  return Math.max(1, Math.min(99, 40 + locationFit + styleFit + freshnessFit + commuteFit));
}
