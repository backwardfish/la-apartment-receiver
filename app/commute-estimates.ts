export type NeighborhoodCommuteEstimate = {
  minMinutes: number;
  maxMinutes: number;
};

// Conservative MVP estimates for a typical drive to Santa Monica. These are
// deliberately broad ranges, not live traffic claims. Google Routes can
// supersede them later when configured.
const SANTA_MONICA_COMMUTES: Record<string, NeighborhoodCommuteEstimate> = {
  "santa monica": { minMinutes: 5, maxMinutes: 10 },
  venice: { minMinutes: 10, maxMinutes: 15 },
  "mar vista": { minMinutes: 15, maxMinutes: 20 },
  "culver city": { minMinutes: 15, maxMinutes: 20 },
  brentwood: { minMinutes: 15, maxMinutes: 20 },
  westwood: { minMinutes: 20, maxMinutes: 25 },
  "playa vista": { minMinutes: 20, maxMinutes: 25 },
  "beverly hills": { minMinutes: 25, maxMinutes: 30 },
  "west hollywood": { minMinutes: 30, maxMinutes: 35 },
  inglewood: { minMinutes: 30, maxMinutes: 35 },
  hollywood: { minMinutes: 35, maxMinutes: 40 },
  koreatown: { minMinutes: 35, maxMinutes: 45 },
  "silver lake": { minMinutes: 40, maxMinutes: 45 },
  "los feliz": { minMinutes: 40, maxMinutes: 45 },
  "echo park": { minMinutes: 40, maxMinutes: 45 },
  "downtown los angeles": { minMinutes: 40, maxMinutes: 45 },
  "arts district": { minMinutes: 45, maxMinutes: 50 },
  "highland park": { minMinutes: 50, maxMinutes: 55 },
  glendale: { minMinutes: 55, maxMinutes: 65 },
  burbank: { minMinutes: 55, maxMinutes: 65 },
  torrance: { minMinutes: 55, maxMinutes: 60 },
  pasadena: { minMinutes: 65, maxMinutes: 70 },
  "long beach": { minMinutes: 70, maxMinutes: 75 },
};

function normalize(value: string) {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ");
}

export function estimateCommuteToSantaMonica(neighborhood: string, city: string): NeighborhoodCommuteEstimate | undefined {
  const candidates = [normalize(neighborhood), normalize(city)];
  for (const candidate of candidates) {
    if (SANTA_MONICA_COMMUTES[candidate]) return SANTA_MONICA_COMMUTES[candidate];
  }
  return undefined;
}

export function isSantaMonicaCommute(origin: string) {
  return normalize(origin) === "santa monica";
}

export function estimatePassesLimit(estimate: NeighborhoodCommuteEstimate, maxMinutes: number) {
  // Use the upper end of the range so a result only passes when the baked-in
  // estimate is conservatively within the requested ceiling.
  return estimate.maxMinutes <= maxMinutes;
}
