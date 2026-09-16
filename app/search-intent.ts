export type SearchIntent = {
  raw: string;
  maxRent?: number;
  minBedrooms?: number;
  requiredFeatures: string[];
  /** First requested area (kept for compatibility); see `locations` for every requested area. */
  locationQuery?: string;
  /** Every requested area, in the order written. Areas are alternatives ("near UCLA, USC, or the Arts District"). */
  locations: string[];
  preferredRegions: Array<"south" | "east">;
  warehouseStyle: boolean;
  bachelorPad: boolean;
  commute?: {
    origin: string;
    maxMinutes: number;
  };
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
  "Pet friendly": ["pet friendly", "pets allowed", "cats allowed", "dogs allowed"],
  Furnished: ["furnished"],
};

const STOP_WORDS = new Set([
  "a", "an", "and", "apartment", "apartments", "around", "at", "be", "bed",
  "bedroom", "bedrooms", "br", "eight", "feel", "find", "five", "for", "four", "home", "i", "ideally", "in", "is", "kind", "like", "looking",
  "max", "maximum", "me", "month", "near", "of", "or", "place", "please", "plus", "preferably",
  "nine", "one", "rent", "rental", "rentals", "seven", "show", "six", "something", "the",
  "three", "to", "two", "type", "under", "up", "vibe", "want", "with",
]);

const BEDROOM_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
};

// Canonical area keys. Every key here should have coordinates in
// `providers.ts` (AREA_CENTERS) so live searches can filter by distance.
export const LOCATION_ALIASES: Record<string, string[]> = {
  "arts district": ["arts district"],
  "beverly hills": ["beverly hills"],
  "boyle heights": ["boyle heights"],
  brentwood: ["brentwood"],
  burbank: ["burbank"],
  chinatown: ["chinatown"],
  "culver city": ["culver city"],
  "downtown los angeles": ["downtown la", "dtla", "downtown los angeles"],
  "eagle rock": ["eagle rock"],
  "echo park": ["echo park"],
  "fashion district": ["fashion district"],
  glendale: ["glendale"],
  "highland park": ["highland park"],
  "historic core": ["historic core"],
  hollywood: ["hollywood"],
  inglewood: ["inglewood"],
  koreatown: ["koreatown", "k town", "ktown"],
  "little tokyo": ["little tokyo"],
  "long beach": ["long beach"],
  "los feliz": ["los feliz"],
  "mar vista": ["mar vista"],
  "marina del rey": ["marina del rey"],
  pasadena: ["pasadena"],
  "playa vista": ["playa vista"],
  "santa monica": ["santa monica"],
  "silver lake": ["silver lake", "silverlake"],
  torrance: ["torrance"],
  ucla: ["ucla", "westwood village", "university of california los angeles", "university of california, los angeles"],
  usc: ["usc", "university park", "exposition park", "university of southern california"],
  venice: ["venice"],
  "west adams": ["west adams"],
  "west hollywood": ["west hollywood", "weho"],
  westwood: ["westwood"],
};

const WAREHOUSE_STYLE_ALIASES = [
  "warehouse",
  "industrial",
  "factory conversion",
  "converted factory",
  "live work",
  "live/work",
  "loft",
  "exposed brick",
  "high ceiling",
  "open floor plan",
  "converted building",
];

const BACHELOR_PAD_ALIASES = ["bachelor pad", "bachelor-pad", "bachelorpad"];

/**
 * Find every known area named in the text, longest alias first so that
 * "West Hollywood" is not also read as "Hollywood". Returns canonical keys in
 * the order they appear.
 */
export function findKnownLocations(haystack: string): string[] {
  let masked = haystack;
  const found: Array<{ key: string; index: number }> = [];
  const aliases = Object.entries(LOCATION_ALIASES)
    .flatMap(([key, list]) => list.map((alias) => ({ key, alias: ` ${alias} ` })))
    .sort((a, b) => b.alias.length - a.alias.length);
  for (const { key, alias } of aliases) {
    let index = masked.indexOf(alias);
    while (index !== -1) {
      if (!found.some((entry) => entry.key === key)) found.push({ key, index });
      masked = masked.slice(0, index + 1) + " ".repeat(alias.length - 2) + masked.slice(index + alias.length - 1);
      index = masked.indexOf(alias);
    }
  }
  return found.sort((a, b) => a.index - b.index).map((entry) => entry.key);
}

function parseCommute(normalized: string) {
  const match = normalized.match(
    /\b(?:within|under|less than|up to|no more than)\s+(?:(?:an?|one)\s+hour'?s?|([\d]+)\s*(minutes?|mins?|hours?|hrs?))\s*(?:drive|driving)?\s*(?:of|from|to)\s+([a-z][a-z\s'-]*?)(?=[,.;!?]|$)/,
  );
  if (!match) return undefined;

  const amount = match[1] ? Number(match[1]) : 1;
  const unit = match[2] ?? "hour";
  const origin = match[3]?.trim().replace(/\s+/g, " ");
  if (!origin) return undefined;
  return {
    origin,
    maxMinutes: /^h/.test(unit) ? amount * 60 : amount,
  };
}

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
  const commute = parseCommute(normalized);
  // A commute destination is not the requested neighborhood. Keep the search
  // broad enough to include both sides of the commute cutoff.
  const locationInput = commute ? normalized.replace(/\b(?:within|under|less than|up to|no more than)\s+(?:(?:an?|one)\s+hour'?s?|[\d]+\s*(?:minutes?|mins?|hours?|hrs?))\s*(?:drive|driving)?\s*(?:of|from|to)\s+[a-z][a-z\s'-]*?(?=[,.;!?]|$)/, ' ') : normalized;
  const rentMatch = normalized.match(
    /(?:under|up to|max(?:imum)?(?: of)?)\s*\$?\s*([\d,]{3,})|\$\s*([\d,]{3,})\s*(?:max|maximum|or less|and under)?/,
  );
  const rentValue = rentMatch?.[1] ?? rentMatch?.[2];
  const bedroomMatch = normalized.match(/\b(\d+)\s*(?:\+|plus)?\s*(?:bed(?:room)?s?|br)\b/);
  const wordBedroomMatch = normalized.match(/\b(one|two|three|four|five)\s*(?:-|\s)*(?:bed(?:room)?s?|br)\b/);
  const locationMatch = locationInput.match(/\b(?:in|near|around)\s+([a-z][a-z\s'-]*?)(?=\s+(?:under|up to|max(?:imum)?|with|and|for)\b|[,.;!?]|$)/);
  const explicitLocation = locationMatch?.[1]?.trim().replace(/\s+/g, " ");
  const locationHaystack = (" " + locationInput.replace(/[^a-z0-9]+/g, " ") + " ").replace(/\s+/g, " ");
  // Known areas win over the free-text capture so "near UCLA, USC, or the
  // Arts District" yields three areas instead of one garbled address.
  const knownLocations = findKnownLocations(locationHaystack);
  const locations = knownLocations.length ? knownLocations : explicitLocation ? [explicitLocation] : [];
  const locationQuery = locations[0];
  const preferredRegions = (["south", "east"] as const).filter((region) =>
    new RegExp(`\\b${region}(?:ern)?(?:\s+la)?\\b`).test(normalized),
  );
  const styleHaystack = normalized.replace(/-/g, " ");
  const warehouseStyle = WAREHOUSE_STYLE_ALIASES.some((alias) => styleHaystack.includes(alias.replace(/-/g, " ")));
  const bachelorPad = BACHELOR_PAD_ALIASES.some((alias) => normalized.includes(alias));
  const requiredFeatures = Object.entries(FEATURE_ALIASES)
    .filter(([feature, aliases]) => aliases.some((alias) => normalized.includes(alias)) && !(feature === 'Furnished' && /\bunfurnished\b|\bnot furnished\b/.test(normalized)))
    .map(([feature]) => feature);

  const featureWords = new Set(
    Object.values(FEATURE_ALIASES)
      .flat()
      .flatMap((alias) => alias.trim().split(/\s+/)),
  );
  const locationWords = new Set([
    ...locations.flatMap(normalizedWords),
    ...locations.flatMap((key) => (LOCATION_ALIASES[key] ?? []).flatMap(normalizedWords)),
  ]);
  const semanticWords = new Set([
    ...WAREHOUSE_STYLE_ALIASES.flatMap(normalizedWords),
    ...BACHELOR_PAD_ALIASES.flatMap(normalizedWords),
    ...preferredRegions,
    ...(commute ? normalizedWords(commute.origin) : []),
    "within",
    "style",
    "hour",
    "hour's",
    "hours",
    "minute",
    "minutes",
    "min",
    "mins",
    "drive",
    "driving",
    "south",
    "east",
    "la",
  ]);
  const searchTerms = [...new Set(normalizedWords(raw).filter((word) =>
    !featureWords.has(word) && !locationWords.has(word) && !semanticWords.has(word),
  ))];

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
    locations,
    preferredRegions,
    warehouseStyle,
    bachelorPad,
    commute,
    searchTerms,
  };
}

/** Text evidence that a listing has warehouse, loft, or industrial character. */
export function hasWarehouseEvidence(text: string): boolean {
  const haystack = ` ${text.toLowerCase().replace(/-/g, " ")} `;
  return WAREHOUSE_STYLE_ALIASES.some((alias) => haystack.includes(alias.replace(/-/g, " ")));
}

export function tailorListings<T extends IntentListing>(listings: T[], intent: SearchIntent): T[] {
  if (!intent.raw) return [...listings];

  // Suggestions often name an area without saying "in" or "near". When a
  // neighborhood or city from this snapshot appears verbatim, treat it as the
  // requested area just like an explicitly phrased location.
  const rawSearch = intent.raw.toLowerCase().replace(/[^a-z0-9]+/g, " ");
  const inferredLocation = [...new Set(listings.flatMap((listing) => [listing.neighborhood, listing.city]))]
    .map((location) => location.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim())
    .filter((location) => location.length > 2 && rawSearch.includes(location) && location !== intent.commute?.origin)
    .sort((a, b) => b.length - a.length)[0];
  const requestedLocations = intent.locations.length
    ? intent.locations.map((location) => location.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim())
    : inferredLocation ? [inferredLocation] : [];
  const requestedLocation = requestedLocations[0];

  const locationMatches = (listing: T) => {
    if (!requestedLocations.length) return true;
    const location = `${listing.neighborhood} ${listing.city}`.toLowerCase().replace(/[^a-z0-9]+/g, " ");
    return requestedLocations.some((requested) => location.includes(requested));
  };
  // "Loft" is a hard requirement, not a ranking hint: a generic apartment must
  // not be presented as a match for a warehouse/loft brief.
  const styleMatches = (listing: T) =>
    !intent.warehouseStyle || hasWarehouseEvidence(`${listing.title} ${listing.features.join(" ")} ${(listing as { warehouseSignals?: string[] }).warehouseSignals?.join(" ") ?? ""}`);

  return listings
    .filter((listing) => intent.maxRent === undefined || listing.rent <= intent.maxRent)
    .filter((listing) => intent.minBedrooms === undefined || listing.beds >= intent.minBedrooms)
    .filter((listing) =>
      intent.requiredFeatures.every((feature) => listing.features.includes(feature)),
    )
    .filter(locationMatches)
    .filter(styleMatches)
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

/** Human-readable area name for a canonical location key or free-text area. */
export function displayArea(key: string): string {
  if (key === "usc") return "USC";
  if (key === "ucla") return "UCLA";
  if (key === "downtown los angeles") return "Downtown LA";
  return key.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function describeSearchIntent(intent: SearchIntent): string {
  const parts: string[] = [];
  if (intent.maxRent !== undefined) parts.push(`up to $${intent.maxRent.toLocaleString("en-US")}`);
  if (intent.minBedrooms !== undefined) {
    parts.push(intent.minBedrooms === 0 ? "studio or larger" : `${intent.minBedrooms}+ bedroom`);
  }
  if (intent.requiredFeatures.length) parts.push(intent.requiredFeatures.join(" + ").toLowerCase());
  if (intent.locations.length) parts.push(`near ${intent.locations.map(displayArea).join(" / ")}`);
  if (intent.warehouseStyle) parts.push("warehouse-style");
  if (intent.bachelorPad) parts.push("bachelor-pad feel");
  if (intent.preferredRegions.length) parts.push(`${intent.preferredRegions.join(" / ")} LA`);
  if (intent.commute) parts.push(`within ${intent.commute.maxMinutes} min drive of ${intent.commute.origin}`);
  if (intent.searchTerms.length) parts.push(intent.searchTerms.join(" "));
  return parts.length ? parts.join(" · ") : "your current request";
}
