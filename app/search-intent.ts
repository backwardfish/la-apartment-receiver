export type SearchIntent = {
  raw: string;
  maxRent?: number;
  minBedrooms?: number;
  requiredFeatures: string[];
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

function normalizedWords(value: string) {
  return value
    .toLowerCase()
    .replace(/\$[\d,]+/g, " ")
    .replace(/\b\d+(?:\.\d+)?\b/g, " ")
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
  const requiredFeatures = Object.entries(FEATURE_ALIASES)
    .filter(([, aliases]) => aliases.some((alias) => normalized.includes(alias)))
    .map(([feature]) => feature);

  const featureWords = new Set(
    Object.values(FEATURE_ALIASES)
      .flat()
      .flatMap((alias) => alias.trim().split(/\s+/)),
  );
  const searchTerms = [...new Set(normalizedWords(raw).filter((word) => !featureWords.has(word)))];

  return {
    raw: raw.trim(),
    maxRent: rentValue ? Number(rentValue.replaceAll(",", "")) : undefined,
    minBedrooms: /\bstudio\b/.test(normalized)
      ? 0
      : bedroomMatch
        ? Number(bedroomMatch[1])
        : undefined,
    requiredFeatures,
    searchTerms,
  };
}

export function tailorListings<T extends IntentListing>(listings: T[], intent: SearchIntent): T[] {
  if (!intent.raw) return [...listings];

  return listings
    .filter((listing) => intent.maxRent === undefined || listing.rent <= intent.maxRent)
    .filter((listing) => intent.minBedrooms === undefined || listing.beds >= intent.minBedrooms)
    .filter((listing) =>
      intent.requiredFeatures.every((feature) => listing.features.includes(feature)),
    )
    .map((listing) => {
      const haystack = `${listing.title} ${listing.neighborhood} ${listing.city} ${listing.features.join(" ")}`.toLowerCase();
      const termMatches = intent.searchTerms.filter((term) => haystack.includes(term)).length;
      const relevance = termMatches * 10 + intent.requiredFeatures.length * 4;
      return { listing, relevance, termMatches };
    })
    .filter(({ termMatches }) => intent.searchTerms.length === 0 || termMatches > 0)
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
  if (intent.searchTerms.length) parts.push(intent.searchTerms.join(" "));
  return parts.length ? parts.join(" · ") : "your current request";
}
