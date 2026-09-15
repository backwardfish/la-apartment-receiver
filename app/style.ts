/**
 * Style evidence and grading. Every signal comes from the listing's own words
 * (title, description, feature list, property type) or its recorded build
 * year — never from the street name, the neighbourhood, or the photos.
 *
 * Grades:
 *   A — authentic industrial / warehouse loft: loft language plus a converted
 *       industrial building, exposed brick, or concrete / live-work in a
 *       pre-1945 building.
 *   B — strong loft character: loft language plus high ceilings, concrete,
 *       exposed brick, industrial windows, or live/work.
 *   C — some loft features: "loft" or high ceilings appear, loft-inspired
 *       marketing, or a post-1990 building without heavy evidence.
 *   D — no loft evidence, or "loft" only names a sleeping loft.
 */
export type StyleGrade = "A" | "B" | "C" | "D";

export type StyleEvidence = {
  signals: string[];
  grade: StyleGrade;
  /** Text that should make a loft hunter pause; shown as cautions, never hidden. */
  cautions: string[];
};

const SIGNALS: Array<[string, RegExp]> = [
  ["Loft", /\blofts?\b/],
  ["Industrial conversion", /\b(?:industrial|warehouse|factory|converted (?:building|warehouse|factory)|conversion|adaptive reuse)\b/],
  ["Exposed brick", /\bexposed brick|brick walls?\b/],
  ["Concrete", /\b(?:polished|stained|exposed|raw) concrete|concrete (?:floors?|ceilings?|columns?|walls?|and steel|& steel)\b/],
  ["High ceilings", /\b(?:1[2-9]|[2-3]\d)[ -]?(?:ft|foot|feet)\b|\b(?:very )?high ceilings?|soaring ceilings?|double[- ]height|vaulted ceilings?\b/],
  ["Industrial windows", /\b(?:industrial|steel|factory|floor[- ]to[- ]ceiling|wall of|oversized|huge) (?:glass|windows?)\b/],
  ["Open floor plan", /\bopen (?:floor ?plan|plan|space|layout|concept)\b/],
  ["Live/work", /\blive\s*[/-]?\s*work\b/],
];

const CAUTIONS: Array<[string, RegExp]> = [
  ["Short-term or furnished monthly rental", /\b(?:30|thirty)[ -]?(?:nights?|days?)(?: or more| minimum)?\b|short[- ]term|furnished monthly|monthly furnished|nightly rate|late check[- ]?ins?\b/],
  ["\"Loft\" may mean a sleeping loft, not the building", /\b(?:sleeping|upstairs|cozy|bedroom|bonus|mezzanine) loft\b|\bwith (?:a |an )?(?:upstairs |sleeping )?loft\b|\bloft (?:bedroom|area|style bedroom)\b/],
  ["Loft-inspired marketing language", /\bloft[- ]?(?:inspired|style|like|feel)\b/],
];

export function styleText(parts: Array<unknown>): string {
  return parts.filter((value): value is string => typeof value === "string" && value.trim().length > 0).join(" \n ");
}

export function assessStyle(text: string, yearBuilt?: number): StyleEvidence {
  const haystack = ` ${text.toLowerCase()} `;
  const signals = SIGNALS.filter(([, pattern]) => pattern.test(haystack)).map(([label]) => label);
  const cautions = CAUTIONS.filter(([, pattern]) => pattern.test(haystack)).map(([label]) => label);
  const has = (label: string) => signals.includes(label);
  const prewar = typeof yearBuilt === "number" && yearBuilt > 1850 && yearBuilt < 1945;
  const modern = typeof yearBuilt === "number" && yearBuilt >= 1990;
  if (prewar && has("Loft")) signals.push(`Built ${yearBuilt}`);
  const loft = has("Loft");
  const heavy = has("Industrial conversion") || has("Exposed brick") || (prewar && (has("Concrete") || has("Live/work")));
  const character = has("High ceilings") || has("Concrete") || has("Exposed brick") || has("Live/work") || has("Industrial windows");
  const sleepingLoftOnly = loft && cautions.some((caution) => caution.startsWith("\"Loft\"")) && !heavy && !character;
  // "Loft-inspired" only caps the grade when it is the sole loft mention; a real "Lofts building" plus "loft style space" is not marketing alone.
  const loftMentions = (haystack.match(/\blofts?\b/g) ?? []).length, marketingMentions = (haystack.match(/\bloft[- ]?(?:inspired|style|like|feel)\b/g) ?? []).length;
  const marketingOnly = marketingMentions > 0 && loftMentions <= marketingMentions && !heavy;
  let grade: StyleGrade = "D";
  if (loft && heavy) grade = "A";
  else if (loft && character && !sleepingLoftOnly && !marketingOnly && !modern) grade = "B";
  else if (sleepingLoftOnly) grade = "D";
  else if (loft || has("High ceilings") || has("Industrial conversion")) grade = "C";
  return { signals, grade, cautions };
}

export const GRADE_LABEL: Record<StyleGrade, string> = {
  A: "Authentic industrial loft",
  B: "Strong loft character",
  C: "Some loft features",
  D: "No loft evidence",
};
