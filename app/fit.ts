import { assessStyle } from "./style.ts";
import type { LiveListing } from "./live-search.ts";
import type { SearchIntent } from "./search-intent.ts";

const STYLE_FIT = { A: 30, B: 20, C: 8, D: 0 } as const;
const STYLE_BONUS = { A: 8, B: 5, C: 2, D: 0 } as const;

/**
 * A 1–99 evidence score, not a probability. Location, style, source freshness,
 * and commute retain their existing weights. The active brief also rewards
 * rent headroom (2–10), confirmed bedrooms (+5), and requested amenities (up
 * to +6). Missing evidence earns no points. Identical evidence can still tie.
 */
export function scoreFit(
  l: Pick<LiveListing, "area" | "warehouseSignals" | "freshness" | "commute"> & Partial<Pick<LiveListing, "styleGrade" | "cautions" | "rent" | "beds" | "features" | "distanceMiles" | "city" | "neighborhood">>,
  intent: Pick<SearchIntent, "warehouseStyle" | "locations"> & Partial<Pick<SearchIntent, "maxRent" | "minRent" | "minBedrooms" | "requiredFeatures">>,
): number {
  const namedCity = intent.locations.some(location => [l.city, l.neighborhood].some(value => value?.toLowerCase() === location.toLowerCase()));
  const proximityPenalty = intent.locations.length && Number.isFinite(l.distanceMiles) ? Math.min(8, Math.floor(Math.max(0, l.distanceMiles!) / 2)) : 0;
  const locationFit = l.area || namedCity ? 20 - proximityPenalty : intent.locations.length ? 0 : 10;
  let budgetFit = 0;
  if (Number.isFinite(l.rent) && l.rent! > 0) {
    if (intent.maxRent !== undefined && intent.maxRent > 0) {
      // Headroom is bounded so a cheap generic unit cannot outrank a true loft
      // just on price. No budget means no automatic preference for cheaper rent.
      budgetFit = l.rent! > intent.maxRent ? -15 : 2 + Math.round(8 * Math.min(1, (intent.maxRent - l.rent!) / (intent.maxRent * 0.4)));
    }
    if (intent.minRent !== undefined && l.rent! < intent.minRent) budgetFit -= 10;
  }
  const bedroomFit = intent.minBedrooms !== undefined && Number.isFinite(l.beds) ? (l.beds! >= intent.minBedrooms ? 5 : -10) : 0;
  const requestedFeatures = intent.requiredFeatures ?? [];
  const featureFit = requestedFeatures.length ? Math.round(6 * requestedFeatures.filter(feature => l.features?.includes(feature)).length / requestedFeatures.length) : 0;
  const grade = l.styleGrade ?? (l.warehouseSignals.length >= 2 ? "A" : l.warehouseSignals.length === 1 ? "B" : "D");
  const styleFit = intent.warehouseStyle ? STYLE_FIT[grade] : STYLE_BONUS[grade];
  const freshnessFit = l.freshness === "live" ? 10 : l.freshness === "recent" ? 7 : l.freshness === "stale" ? -10 : 0;
  const commuteFit = l.commute ? Math.max(0, 10 - Math.floor(l.commute.minutes / 6)) : 0;
  const cautionPenalty = l.cautions?.some((caution) => caution.startsWith("Short-term")) ? 10 : 0;
  return Math.max(1, Math.min(99, 40 + locationFit + styleFit + freshnessFit + commuteFit + budgetFit + bedroomFit + featureFit - cautionPenalty));
}

/** Snapshot cards must reflect the active brief, without claiming live freshness. */
export function presentSnapshot<T extends {
  title: string; features: string[]; fit: number; why: string[]; unknowns: string[];
  warehouseSignals?: string[]; styleGrade?: import('./style.ts').StyleGrade; yearBuilt?: number; rent?: number; beds?: number; city?: string; neighborhood?: string;
}>(listing: T, intent: SearchIntent): T {
  const style = assessStyle([listing.title, ...listing.features, ...(listing.warehouseSignals ?? [])].join(' '), listing.yearBuilt);
  const why = [
    'Research snapshot; current availability is unconfirmed',
    ...(intent.maxRent !== undefined ? [`Within your $${intent.maxRent.toLocaleString('en-US')} ceiling`] : []),
    ...(intent.minRent !== undefined ? [`Meets your $${intent.minRent.toLocaleString('en-US')} minimum`] : []),
    ...intent.requiredFeatures.filter(feature => listing.features.includes(feature)).map(feature => `${feature} is represented in the source`),
    ...(style.grade !== 'D' ? [`Style ${style.grade}: ${style.signals.join(' · ')}`] : []),
  ];
  return {
    ...listing,
    warehouseSignals: style.signals,
    styleGrade: style.grade,
    fit: scoreFit({ ...listing, warehouseSignals: style.signals, styleGrade: style.grade, freshness: 'needs-verification' }, intent),
    why,
    unknowns: [...new Set([...listing.unknowns, 'Current availability needs confirmation', ...(intent.warehouseStyle && style.grade === 'D' ? ['No loft or industrial evidence in the snapshot'] : [])])],
  };
}
