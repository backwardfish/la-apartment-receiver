import type { LiveListing } from "./live-search.ts";
import type { SearchIntent } from "./search-intent.ts";

const STYLE_FIT = { A: 30, B: 20, C: 8, D: 0 } as const;
const STYLE_BONUS = { A: 8, B: 5, C: 2, D: 0 } as const;

/**
 * Fit is a 0–99 evidence score, not a probability. It starts at 40 and only
 * rises on evidence the provider actually supplied: inside a requested area
 * (+20), loft evidence (grade A +30 / B +20 / C +8 when the brief asked for
 * loft character; a small bonus otherwise), provider freshness (+10 live /
 * +7 recent / −10 stale), and a verified commute (up to +10). Short-term or
 * furnished-monthly language costs 10. A generic listing therefore cannot
 * score like a match.
 */
export function scoreFit(
  l: Pick<LiveListing, "area" | "warehouseSignals" | "freshness" | "commute"> & Partial<Pick<LiveListing, "styleGrade" | "cautions">>,
  intent: Pick<SearchIntent, "warehouseStyle" | "locations">,
): number {
  const locationFit = l.area ? 20 : intent.locations.length ? 0 : 10;
  const grade = l.styleGrade ?? (l.warehouseSignals.length >= 2 ? "A" : l.warehouseSignals.length === 1 ? "B" : "D");
  const styleFit = intent.warehouseStyle ? STYLE_FIT[grade] : STYLE_BONUS[grade];
  const freshnessFit = l.freshness === "live" ? 10 : l.freshness === "recent" ? 7 : l.freshness === "stale" ? -10 : 0;
  const commuteFit = l.commute ? Math.max(0, 10 - Math.floor(l.commute.minutes / 6)) : 0;
  const cautionPenalty = l.cautions?.some((caution) => caution.startsWith("Short-term")) ? 10 : 0;
  return Math.max(1, Math.min(99, 40 + locationFit + styleFit + freshnessFit + commuteFit - cautionPenalty));
}
