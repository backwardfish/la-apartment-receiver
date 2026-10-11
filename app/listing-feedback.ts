import type { PersistedListing } from './workspace-state.ts';

export const FEEDBACK_REASONS = ['Not for me', 'Price', 'Location', 'Style', 'Layout', 'Amenities'] as const;
export type FeedbackReason = typeof FEEDBACK_REASONS[number];
export type ListingFeedback = { listing: PersistedListing; reason: FeedbackReason };

export function isHidden(listing: Pick<PersistedListing, 'id' | 'sourceUrl'>, feedback: ListingFeedback[]): boolean {
  return feedback.some(item => item.listing.id === listing.id || item.listing.sourceUrl === listing.sourceUrl);
}

function similarity(a: PersistedListing, b: PersistedListing, reason: FeedbackReason): number {
  const sameArea = (a.area ?? a.neighborhood).toLowerCase() === (b.area ?? b.neighborhood).toLowerCase() && a.city.toLowerCase() === b.city.toLowerCase();
  const sameStyle = a.styleGrade !== undefined && a.styleGrade === b.styleGrade;
  const sameLayout = a.beds === b.beds;
  const sharedFeatures = a.features.filter(feature => b.features.includes(feature)).length;
  const similarRent = a.rent > 0 && Math.abs(a.rent - b.rent) / a.rent <= 0.15;
  if (reason === 'Price') return b.rent >= a.rent ? 1 : 0;
  if (reason === 'Location') return sameArea ? 1 : 0;
  if (reason === 'Style') return sameStyle ? 1 : 0;
  if (reason === 'Layout') return sameLayout ? 1 : 0;
  if (reason === 'Amenities') return sharedFeatures >= 2 ? 1 : 0;
  // An unspecified dismissal is weak evidence: require several shared traits
  // instead of assuming every individual attribute was disliked.
  const overlap = Number(sameArea) + Number(sameStyle) + Number(sameLayout) + Number(similarRent) + Number(sharedFeatures >= 2);
  return overlap >= 3 ? 0.5 : 0;
}

/** Local, reversible ranking hints. They never change source data or hard search filters. */
export function preferenceAdjustment(listing: PersistedListing, hidden: ListingFeedback[], saved: PersistedListing[]): number {
  const dislikes = hidden.reduce((sum, item) => sum + similarity(item.listing, listing, item.reason), 0);
  const likes = [...new Map(saved.map(item => [item.sourceUrl, item])).values()]
    .filter(item => item.sourceUrl !== listing.sourceUrl && item.id !== listing.id)
    .reduce((sum, item) => sum + similarity(item, listing, 'Not for me'), 0);
  return Math.max(-8, Math.min(8, Math.round(likes * 2 - dislikes * 2)));
}

export function personalizeListing<T extends PersistedListing>(listing: T, hidden: ListingFeedback[], saved: PersistedListing[]): T {
  const adjustment = preferenceAdjustment(listing, hidden, saved);
  if (!adjustment) return listing;
  return { ...listing, fit: Math.max(1, Math.min(99, listing.fit + adjustment)), why: [
    `${adjustment > 0 ? '+' : ''}${adjustment} fit from similarities to your saves and hides`, ...listing.why,
  ] };
}
