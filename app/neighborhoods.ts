export type Neighborhood = {
  key: string;
  label: string;
  latitude: number;
  longitude: number;
  radiusMiles: number;
  mvp: boolean;
};

/**
 * Single source of truth for LA-area geography. The MVP UI exposes only rows
 * marked mvp; provider planning, post-filtering, labels, and API validation
 * consume the same registry so the browser cannot request an unsupported area.
 */
export const LA_NEIGHBORHOODS = [
  { key: "arts district", label: "Arts District", latitude: 34.0405, longitude: -118.2325, radiusMiles: 1.0, mvp: true },
  { key: "downtown los angeles", label: "Downtown LA", latitude: 34.0450, longitude: -118.2500, radiusMiles: 1.6, mvp: true },
  { key: "historic core", label: "Historic Core", latitude: 34.0470, longitude: -118.2490, radiusMiles: 0.6, mvp: true },
  { key: "little tokyo", label: "Little Tokyo", latitude: 34.0500, longitude: -118.2400, radiusMiles: 0.6, mvp: true },
  { key: "fashion district", label: "Fashion District", latitude: 34.0350, longitude: -118.2530, radiusMiles: 0.8, mvp: false },
  { key: "chinatown", label: "Chinatown", latitude: 34.0625, longitude: -118.2380, radiusMiles: 0.7, mvp: false },
  { key: "boyle heights", label: "Boyle Heights", latitude: 34.0340, longitude: -118.2050, radiusMiles: 1.3, mvp: false },
  { key: "usc", label: "University Park / USC", latitude: 34.0224, longitude: -118.2851, radiusMiles: 1.5, mvp: true },
  { key: "west adams", label: "West Adams", latitude: 34.0330, longitude: -118.3220, radiusMiles: 1.2, mvp: true },
  { key: "ucla", label: "Westwood / UCLA", latitude: 34.0689, longitude: -118.4452, radiusMiles: 1.5, mvp: true },
  { key: "westwood", label: "Westwood", latitude: 34.0561, longitude: -118.4320, radiusMiles: 1.4, mvp: false },
  { key: "brentwood", label: "Brentwood", latitude: 34.0520, longitude: -118.4732, radiusMiles: 1.8, mvp: true },
  { key: "echo park", label: "Echo Park", latitude: 34.0782, longitude: -118.2606, radiusMiles: 1.1, mvp: true },
  { key: "silver lake", label: "Silver Lake", latitude: 34.0869, longitude: -118.2702, radiusMiles: 1.2, mvp: true },
  { key: "los feliz", label: "Los Feliz", latitude: 34.1064, longitude: -118.2900, radiusMiles: 1.2, mvp: true },
  { key: "koreatown", label: "Koreatown", latitude: 34.0577, longitude: -118.3009, radiusMiles: 1.2, mvp: true },
  { key: "hollywood", label: "Hollywood", latitude: 34.0928, longitude: -118.3287, radiusMiles: 1.8, mvp: true },
  { key: "west hollywood", label: "West Hollywood", latitude: 34.0900, longitude: -118.3617, radiusMiles: 1.6, mvp: true },
  { key: "beverly hills", label: "Beverly Hills", latitude: 34.0736, longitude: -118.4004, radiusMiles: 1.8, mvp: true },
  { key: "highland park", label: "Highland Park", latitude: 34.1116, longitude: -118.1923, radiusMiles: 1.4, mvp: true },
  { key: "eagle rock", label: "Eagle Rock", latitude: 34.1392, longitude: -118.2110, radiusMiles: 1.4, mvp: true },
  { key: "mar vista", label: "Mar Vista", latitude: 34.0027, longitude: -118.4316, radiusMiles: 1.2, mvp: true },
  { key: "venice", label: "Venice", latitude: 33.9850, longitude: -118.4695, radiusMiles: 1.4, mvp: true },
  { key: "playa vista", label: "Playa Vista", latitude: 33.9750, longitude: -118.4180, radiusMiles: 1.1, mvp: true },
  { key: "marina del rey", label: "Marina del Rey", latitude: 33.9803, longitude: -118.4517, radiusMiles: 1.1, mvp: true },
  { key: "inglewood", label: "Inglewood", latitude: 33.9617, longitude: -118.3531, radiusMiles: 2.4, mvp: true },
  { key: "santa monica", label: "Santa Monica", latitude: 34.0195, longitude: -118.4912, radiusMiles: 2.4, mvp: true },
  { key: "culver city", label: "Culver City", latitude: 34.0211, longitude: -118.3965, radiusMiles: 1.8, mvp: true },
  { key: "pasadena", label: "Pasadena", latitude: 34.1478, longitude: -118.1445, radiusMiles: 3.0, mvp: false },
  { key: "glendale", label: "Glendale", latitude: 34.1425, longitude: -118.2551, radiusMiles: 3.0, mvp: false },
  { key: "burbank", label: "Burbank", latitude: 34.1808, longitude: -118.3090, radiusMiles: 3.0, mvp: false },
  { key: "torrance", label: "Torrance", latitude: 33.8358, longitude: -118.3406, radiusMiles: 3.0, mvp: false },
  { key: "long beach", label: "Long Beach", latitude: 33.7701, longitude: -118.1937, radiusMiles: 4.0, mvp: false },
] as const satisfies readonly Neighborhood[];

export type NeighborhoodKey = (typeof LA_NEIGHBORHOODS)[number]["key"];
export const MVP_NEIGHBORHOODS = LA_NEIGHBORHOODS.filter((area) => area.mvp);
export const DEFAULT_NEIGHBORHOOD: NeighborhoodKey = "arts district";

const byKey = new Map<string, (typeof LA_NEIGHBORHOODS)[number]>(LA_NEIGHBORHOODS.map((area) => [area.key, area]));

export function neighborhoodByKey(value: unknown) {
  return typeof value === "string" ? byKey.get(value) : undefined;
}

export function isNeighborhoodKey(value: unknown): value is NeighborhoodKey {
  return neighborhoodByKey(value) !== undefined;
}

export function neighborhoodLabel(value: string): string {
  return neighborhoodByKey(value)?.label ?? value.replace(/\b\w/g, (letter) => letter.toUpperCase());
}
