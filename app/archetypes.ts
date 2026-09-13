export type ArchetypeListing = {
  title: string;
  neighborhood: string;
  city: string;
  rent: number;
  beds: number;
  baths: number;
  sqft?: number;
  features: string[];
  warehouseSignals?: string[];
  description?: string;
};

export type ArchetypeScore = {
  id: "bachelor-pad";
  label: "Bachelor Pad";
  score: number;
  tier: "exceptional" | "strong" | "some" | "weak";
  reasons: string[];
};

function includesAny(haystack: string, terms: string[]) {
  return terms.some((term) => haystack.includes(term));
}

export function scoreBachelorPad(listing: ArchetypeListing): ArchetypeScore {
  const haystack = [listing.title, listing.neighborhood, listing.city, listing.description, ...listing.features, ...(listing.warehouseSignals ?? [])]
    .filter(Boolean).join(" ").toLowerCase();

  let character = 0;
  let entertaining = 0;
  let location = 0;
  let convenience = 0;
  let valueSpace = 0;
  const reasons: string[] = [];

  if (includesAny(haystack, ["loft", "industrial", "warehouse", "factory conversion", "live/work", "exposed brick", "concrete", "high ceiling", "large windows"])) {
    character = 30;
    reasons.push("Distinctive architectural character");
  } else if (includesAny(haystack, ["renovated", "modern", "designer", "views", "penthouse"])) {
    character = 18;
    reasons.push("Strong visual character");
  }

  if (includesAny(haystack, ["balcony", "patio", "rooftop", "outdoor space", "open floor", "island", "bar", "great room"])) {
    entertaining = 25;
    reasons.push("Good entertaining setup");
  } else if ((listing.sqft ?? 0) >= 700 || listing.beds >= 1) entertaining = 14;

  const socialNeighborhoods = ["arts district", "downtown los angeles", "dtla", "west hollywood", "hollywood", "silver lake", "echo park", "los feliz", "venice", "santa monica", "culver city", "highland park", "koreatown"];
  if (socialNeighborhoods.some((name) => `${listing.neighborhood} ${listing.city}`.toLowerCase().includes(name))) {
    location = 20;
    reasons.push("Strong social / neighborhood access");
  } else location = 8;

  const convenienceSignals = ["Parking", "Laundry", "Dishwasher", "Air conditioning"];
  const convenienceCount = convenienceSignals.filter((feature) => listing.features.includes(feature)).length;
  convenience = Math.min(15, convenienceCount * 4);
  if (convenienceCount >= 3) reasons.push("Low-friction day-to-day setup");

  const sqft = listing.sqft ?? 0;
  if (sqft >= 900 && listing.rent <= 3500) valueSpace = 10;
  else if (sqft >= 700 && listing.rent <= 3200) valueSpace = 8;
  else if (listing.beds <= 1 && listing.rent <= 3000) valueSpace = 5;

  let score = character + entertaining + location + convenience + valueSpace;
  if (listing.beds >= 3) score -= 8;
  if (listing.rent > 4500) score -= 6;
  if (sqft > 0 && sqft < 450) score -= 8;
  score = Math.max(0, Math.min(100, score));

  const tier = score >= 90 ? "exceptional" : score >= 80 ? "strong" : score >= 60 ? "some" : "weak";
  return { id: "bachelor-pad", label: "Bachelor Pad", score, tier, reasons: reasons.slice(0, 3) };
}
