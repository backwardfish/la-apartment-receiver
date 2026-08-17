export type SearchIntent = {
  raw: string;
  maxRent?: number;
  minBedrooms?: number;
  requiredFeatures: string[];
  locationQuery?: string;
  searchTerms: string[];
};

export type IntentListing = {
  title: string;
  neighborhood: string;
  city: string;
  rent: number;
  beds: number;
  features: string[];
};

const FEATURE_ALIASES: Record<string, string[]> = {
  Parking: ["parking", "garage", "carport"],
  Laundry: ["laundry", "washer", "dryer"],
  Pool: ["pool"],
  Balcony: ["balcony"],
  Patio: ["patio", "outdoor space"],
  Dishwasher: ["dishwasher"],
  "Air conditioning": ["air conditioning", "a/c", " ac "],
};

const STOP_WORDS = new Set([
  "a", "an", "and", "apartment", "apartments", "around", "at", "be", "bed",
  "bedroom", "bedrooms", "br", "eight", "five", "for", "four", "home", "i", "in", "is", "looking",
  "max", "maximum", "me", "month", "near", "of", "or", "place", "plus",
  "nine", "one", "rent", "rental", "rentals", "seven", "show", "six", "the",
  "three", "to", "two", "under", "up", "want", "with",
]);

const BEDROOM_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
};

function normalizedWords(value: string) {
  return value
    .toLowerCase()
    .replace(/\$[\d,]+/g, " ")
    .replace(/\b\d+(?:\.\d+)?\b/g, " ")
    .replace(/-/g, " ")
    .replace(/[^a-z0-9/+'-]+/g, " ")
    .split(/\s+/)
    .map((word) => word.replace(/^['-]+|['-]+$/g, ""))
    .filter((word) => word.length > 1 && !STOP_WORDS.has(word));
}

export function parseSearchIntent(raw: string): SearchIntent {
  const normalized = ` ${raw.trim().toLowerCase()} `;
  const rentMatch = normalized.match(
    /(?:under|up to|max(?:imum)?(?: of)?)\s*\$?\s*([\d,]{3,})|\$\s*([\d,]{3,})\s*(?:max|maximum|or less|and under)?/,
  );
  const rentValue = rentMatch?.[1] ?? rentMatch?.[2];
  const bedroomMatch = normalized.match(/\b(\d+)\s*(?:\+|plus)?\s*(?:bed(?:room)?s?|br)\b/);
  const wordBedroomMatch = normalized.match(/\b(one|two|three|four|five)\s*(?:-|\s)*(?:bed(?:room)?s?|br)\b/);
  const locationMatch = normalized.match(/\b(?:in|near|around)\s+([a-z][a-z\s'-]*?)(?=\s+(?:under|up to|max(?:imum)?|with|and|for)\b|[,.;!?]|$)/);
  const locationQuery = locationMatch?.[1]?.trim().replace(/\s+/g, " ");
  const requiredFeatures = Object.entries(FEATURE_ALIASES)
    .filter(([, aliases]) => aliases.some((alias) => normalized.includes(alias)))
    .map(([feature]) => feature);

  const featureWords = new Set(
    Object.values(FEATURE_ALIASES)
      .flat()
      .flatMap((alias) => alias.trim().split(/\s+/)),
  );
  const locationWords = new Set(locationQuery ? normalizedWords(locationQuery) : []);
  const searchTerms = [...new Set(normalizedWords(raw).filter((word) => !featureWords.has(word) && !locationWords.has(word)))];

  return {
    raw: raw.trim(),
    maxRent: rentValue ? Number(rentValue.replaceAll(",", "")) : undefined,
    minBedrooms: /\bstudio\b/.test(normalized)
      ? 0
      : bedroomMatch
        ? Number(bedroomMatch[1])
        : wordBedroomMatch
          ? BEDROOM_WORDS[wordBedroomMatch[1]]
        : undefined,
    requiredFeatures,
    locationQuery,
    searchTerms,
  };
}

export function tailorListings<T extends IntentListing>(listings: T[], intent: SearchIntent): T[] {
  if (!intent.raw) return [...listings];

  // Suggestions often name an area without saying "in" or "near". When a
  // neighborhood or city from this snapshot appears verbatim, treat it as the
  // requested area just like an explicitly phrased location.
  const rawSearch = intent.raw.toLowerCase().replace(/[^a-z0-9]+/g, " ");
  const inferredLocation = [...new Set(listings.flatMap((listing) => [listing.neighborhood, listing.city]))]
    .map((location) => location.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim())
    .filter((location) => location.length > 2 && rawSearch.includes(location))
    .sort((a, b) => b.length - a.length)[0];
  const requestedLocation = intent.locationQuery?.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() ?? inferredLocation;

  const locationMatches = (listing: T) => {
    if (!requestedLocation) return true;
    const location = `${listing.neighborhood} ${listing.city}`.toLowerCase().replace(/[^a-z0-9]+/g, " ");
    return location.includes(requestedLocation);
  };

  return listings
    .filter((listing) => intent.maxRent === undefined || listing.rent <= intent.maxRent)
    .filter((listing) => intent.minBedrooms === undefined || listing.beds >= intent.minBedrooms)
    .filter((listing) =>
      intent.requiredFeatures.every((feature) => listing.features.includes(feature)),
    )
    .filter(locationMatches)
    .map((listing) => {
      const haystack = `${listing.title} ${listing.neighborhood} ${listing.city} ${listing.features.join(" ")}`.toLowerCase();
      const termMatches = intent.searchTerms.filter((term) => haystack.includes(term)).length;
      const relevance = termMatches * 10 + intent.requiredFeatures.length * 4 + (requestedLocation ? 8 : 0);
      return { listing, relevance, termMatches };
    })
    // Free-form words such as "quiet" are ranking hints, not requirements that
    // should hide otherwise valid rent, bedroom, or amenity matches.
    .sort((a, b) => b.relevance - a.relevance)
    .map(({ listing }) => listing);
}

export function describeSearchIntent(intent: SearchIntent): string {
  const parts: string[] = [];
  if (intent.maxRent !== undefined) parts.push(`up to $${intent.maxRent.toLocaleString("en-US")}`);
  if (intent.minBedrooms !== undefined) {
    parts.push(intent.minBedrooms === 0 ? "studio or larger" : `${intent.minBedrooms}+ bedroom`);
  }
  if (intent.requiredFeatures.length) parts.push(intent.requiredFeatures.join(" + ").toLowerCase());
  if (intent.locationQuery) parts.push(`in ${intent.locationQuery}`);
  if (intent.searchTerms.length) parts.push(intent.searchTerms.join(" "));
  return parts.length ? parts.join(" · ") : "your current request";
}
