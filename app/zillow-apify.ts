/**
 * Zillow rental listings retrieved through the Apify actor
 * `igolaizola/zillow-scraper-ppe`. The server talks only to api.apify.com with
 * a bearer token; it never fetches listing pages, photos, or any URL that came
 * back from the provider. Returned listing and photo URLs still have to pass
 * the trusted-origin allowlist (zillow.com, zillowstatic.com).
 *
 * Runs are asynchronous: `startZillowRuns` reserves nothing and starts one
 * bounded actor run per selected neighborhood; `pollZillowRuns`
 * reports progress and, once every run has succeeded, returns ranked results.
 */
import type { LiveListing, LiveSearchRequest } from "./live-search.ts";
import { ProviderError, rankCandidates, requestedAreas, styleFields, detectFeatures, type Candidate } from "./providers.ts";
import { normalizeNeighborhoodSelection, MAX_NEIGHBORHOODS } from "./neighborhoods.ts";
import { trustedUrl } from "./security-urls.ts";
import { assessStyle, styleText } from "./style.ts";

export const APIFY_API = "https://api.apify.com/v2";
export const ZILLOW_ACTOR = "igolaizola~zillow-scraper-ppe";
/** One independently capped run per area, with a hard ceiling on total fan-out. */
export const MAX_RUNS = MAX_NEIGHBORHOODS;
export const MAX_ITEMS_PER_RUN = 20;
export const MAX_RUN_CHARGE_USD = 0.5;
export const RUN_TIMEOUT_SECONDS = 120;
/** Wall-clock limit for a whole search before it is reported as failed. */
export const SEARCH_DEADLINE_MS = 150_000;
const ITEMS_BYTE_CAP = 2_000_000;
const RUN_TERMINAL = new Set(["SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT", "TIMING-OUT", "ABORTING"]);

type UnknownRecord = Record<string, unknown>;
export type ZillowConfig = { apifyToken: string };
export type ActorInput = { maxItems: number; latitude: number; longitude: number; distanceMiles: number; operation: "rent"; sortBy: "newest"; fetchDetails: true; space: "entirePlace"; keywords?: string; minBeds?: number };
export type StartedRun = { id: string; datasetId: string; area: string };

function record(value: unknown): UnknownRecord | undefined { return value && typeof value === "object" && !Array.isArray(value) ? (value as UnknownRecord) : undefined; }
function text(value: unknown) { return typeof value === "string" && value.trim() ? value.trim() : undefined; }
function num(value: unknown) { return typeof value === "number" && Number.isFinite(value) ? value : undefined; }

/** Only explicit supported selections can start paid work; text cannot widen the scope. */
export function planRuns(request: LiveSearchRequest): Array<{ label: string; latitude: number; longitude: number; radiusMiles: number }> {
  let selected;
  try { selected = normalizeNeighborhoodSelection(request.neighborhoods ?? request.neighborhood); }
  catch { throw new ProviderError("invalid_neighborhood_scope", "Choose 1 to 5 distinct supported neighborhoods"); }
  const areas = requestedAreas({ ...request.intent, locations: selected });
  return areas.map(area => ({ label: area.label, latitude: area.latitude, longitude: area.longitude, radiusMiles: area.radiusMiles }));
}

export function actorInput(plan: ReturnType<typeof planRuns>[number], request: LiveSearchRequest): ActorInput {
  const input: ActorInput = {
    maxItems: MAX_ITEMS_PER_RUN,
    latitude: Number(plan.latitude.toFixed(5)),
    longitude: Number(plan.longitude.toFixed(5)),
    distanceMiles: Math.max(1, Math.ceil(plan.radiusMiles)),
    operation: "rent",
    sortBy: "newest",
    fetchDetails: true,
    space: "entirePlace",
  };
  // Use the provider keyword filter only when the user explicitly asks for a loft.
  // Broader industrial/warehouse intent is graded from listing evidence after retrieval.
  if (/\blofts?\b/i.test(request.query)) input.keywords = "loft";
  if (request.intent.minBedrooms !== undefined && request.intent.minBedrooms > 0) input.minBeds = request.intent.minBedrooms;
  return input;
}

async function apify<T>(path: string, config: ZillowConfig, init: RequestInit & { maxBytes?: number } = {}, fetcher: typeof fetch = fetch): Promise<T> {
  const response = await fetcher(`${APIFY_API}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${config.apifyToken}`, accept: "application/json", ...(init.body ? { "content-type": "application/json" } : {}), ...(init.headers ?? {}) },
    redirect: "error",
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new ProviderError(`apify_http_${response.status}`, `Apify returned ${response.status}`);
  const maxBytes = init.maxBytes ?? 200_000;
  if (Number(response.headers.get("content-length")) > maxBytes) { await response.body?.cancel(); throw new ProviderError("apify_response_too_large", "Apify response exceeded its size limit"); }
  const reader = response.body?.getReader();
  if (!reader) throw new ProviderError("apify_invalid_payload", "Apify returned no body");
  let bytes = 0, body = "";
  const decoder = new TextDecoder("utf-8", { fatal: true });
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) { await reader.cancel(); throw new ProviderError("apify_response_too_large", "Apify response exceeded its size limit"); }
      body += decoder.decode(value, { stream: true });
    }
    return JSON.parse(body + decoder.decode()) as T;
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    throw new ProviderError("apify_invalid_payload", "Apify returned invalid or incomplete JSON");
  } finally { reader.releaseLock(); }
}

/** Zero-cost readiness probe: verifies the configured token can read the selected Actor. */
export async function probeZillowActor(config: ZillowConfig, fetcher: typeof fetch = fetch): Promise<void> {
  await apify<unknown>(`/acts/${ZILLOW_ACTOR}`, config, { maxBytes: 500_000 }, fetcher);
}

/** Best-effort cleanup; already-started work stays charged against the allowance. */
export async function abortZillowRuns(runs: StartedRun[], config: ZillowConfig, fetcher: typeof fetch = fetch): Promise<void> {
  await Promise.allSettled(runs.map(run => apify(`/actor-runs/${encodeURIComponent(run.id)}/abort`, config, { method: "POST" }, fetcher)));
}

/** Start at most five runs concurrently, keeping slow starts within one request deadline. */
export async function startZillowRuns(request: LiveSearchRequest, config: ZillowConfig, fetcher: typeof fetch = fetch): Promise<StartedRun[]> {
  const started = await Promise.allSettled(planRuns(request).map(async plan => {
    const query = new URLSearchParams({ timeout: String(RUN_TIMEOUT_SECONDS), maxTotalChargeUsd: String(MAX_RUN_CHARGE_USD) });
    const result = await apify<{ data?: { id?: unknown; defaultDatasetId?: unknown } }>(`/acts/${ZILLOW_ACTOR}/runs?${query}`, config, { method: "POST", body: JSON.stringify(actorInput(plan, request)) }, fetcher);
    const id = text(result?.data?.id), datasetId = text(result?.data?.defaultDatasetId);
    if (!id || !datasetId) {
      if (id) await abortZillowRuns([{ id, datasetId: "", area: plan.label }], config, fetcher);
      throw new ProviderError("apify_invalid_payload", "Apify did not return a run identifier");
    }
    return { id, datasetId, area: plan.label };
  }));
  const runs = started.flatMap(result => result.status === "fulfilled" ? [result.value] : []);
  const failed = started.find(result => result.status === "rejected");
  if (failed?.status === "rejected") {
    await abortZillowRuns(runs, config, fetcher);
    throw failed.reason;
  }
  return runs;
}

export type PollResult =
  | { status: "running"; finished: number; total: number }
  | { status: "failed"; code: string }
  | { status: "done"; results: LiveListing[]; usageUsd?: number };

/** Check every run; when all have succeeded, download, normalise, and rank the items. */
export async function pollZillowRuns(runs: StartedRun[], request: LiveSearchRequest, config: ZillowConfig, fetcher: typeof fetch = fetch, now = new Date()): Promise<PollResult> {
  if (runs.length < 1 || runs.length > MAX_RUNS) throw new ProviderError("invalid_neighborhood_scope", "Invalid number of provider runs");
  let finished = 0, usageUsd = 0;
  const statuses = await Promise.all(runs.map(run => apify<{ data?: { status?: unknown; usageTotalUsd?: unknown } }>(`/actor-runs/${encodeURIComponent(run.id)}`, config, {}, fetcher)));
  for (const status of statuses) {
    const state = text(status?.data?.status) ?? "UNKNOWN";
    if (state === "SUCCEEDED") { finished++; usageUsd += num(status?.data?.usageTotalUsd) ?? 0; continue; }
    if (RUN_TERMINAL.has(state)) {
      await abortZillowRuns(runs, config, fetcher);
      return { status: "failed", code: `apify_run_${state.toLowerCase().replace(/[^a-z]/g, "_")}` };
    }
  }
  if (finished < runs.length) return { status: "running", finished, total: runs.length };
  const candidates: Candidate[] = [];
  const datasets = await Promise.all(runs.map(async run => {
    const query = new URLSearchParams({ clean: "true", format: "json", limit: String(MAX_ITEMS_PER_RUN), fields: "zpid,_type,title,url,hdpUrl,address,price,bedrooms,bathrooms,livingArea,yearBuilt,propertyType,daysOnZillow,listingDateTimeOnZillow,location,media,rental,_details" });
    const items = await apify<unknown>(`/datasets/${encodeURIComponent(run.datasetId)}/items?${query}`, config, { maxBytes: ITEMS_BYTE_CAP }, fetcher);
    if (!Array.isArray(items)) throw new ProviderError("apify_invalid_payload", "Apify dataset was not a list");
    return items.slice(0, MAX_ITEMS_PER_RUN);
  }));
  for (const items of datasets) for (const item of items) candidates.push({ index: candidates.length, listing: normalizeZillowListing(item, now), coordinate: coordinateOf(item) });
  if (candidates.length && !candidates.some((candidate) => candidate.listing)) throw new ProviderError("source_evidence_unavailable", "Provider records lack required source evidence");
  return { status: "done", results: rankCandidates(candidates, request).map(({ listing }) => listing), usageUsd: Math.round(usageUsd * 1000) / 1000 };
}

export function coordinateOf(item: unknown) {
  const root = record(item); if (!root) return null;
  const location = record(root.location), details = record(root._details);
  const latitude = num(location?.latitude) ?? num(details?.latitude), longitude = num(location?.longitude) ?? num(details?.longitude);
  return latitude === undefined || longitude === undefined || Math.abs(latitude) > 90 || Math.abs(longitude) > 180 ? null : { latitude, longitude };
}

function flattenFacts(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(flattenFacts);
  const object = record(value);
  if (!object) return [];
  return Object.entries(object).flatMap(([key, entry]) => typeof entry === "boolean" ? (entry ? [key.replace(/^has/, "")] : []) : flattenFacts(entry));
}

/**
 * Turn one actor dataset item into the Receiver listing contract. Building-level
 * "propertyGroup" rows (apartment communities without unit facts) are skipped,
 * as is anything without an exact zillow.com listing URL and a zillowstatic photo.
 */
export function normalizeZillowListing(item: unknown, now = new Date()): LiveListing | null {
  const root = record(item); if (!root) return null;
  if (root._type === "propertyGroup") return null;
  const zpid = num(root.zpid) ?? (text(root.zpid) ? Number(root.zpid) : undefined);
  const address = record(root.address), price = record(root.price), rental = record(root.rental), details = record(root._details), media = record(root.media);
  const street = text(address?.streetAddress), city = text(address?.city);
  const rent = num(price?.value) ?? num(rental?.baseRent) ?? num(details?.price);
  const beds = num(root.bedrooms), baths = num(root.bathrooms);
  const sourceUrl = trustedUrl(root.hdpUrl, "sources") ?? trustedUrl(root.url, "sources");
  const photos = record(media?.allPropertyPhotos);
  const primaryImage = trustedUrl(record(media?.propertyPhotoLinks)?.highResolutionLink, "images");
  const galleryImages = Array.isArray(photos?.highResolution) ? photos.highResolution.map((value) => trustedUrl(value, "images")).filter((value): value is string => Boolean(value)) : [];
  const images = [...new Set([primaryImage, ...galleryImages].filter((value): value is string => Boolean(value)))].slice(0, 30);
  const image = images[0];
  if (!zpid || !Number.isFinite(zpid) || !street || !city || rent === undefined || rent <= 0 || beds === undefined || baths === undefined || beds < 0 || baths < 0 || !sourceUrl || !image) return null;
  if (rental?.isRoomForRent === true) return null;
  const resoFacts = record(details?.resoFacts);
  const description = text(details?.description);
  const facts = flattenFacts([resoFacts?.parkingFeatures, resoFacts?.laundryFeatures, resoFacts?.flooring, resoFacts?.atAGlanceFacts, resoFacts?.appliances, resoFacts?.hasCooling ? "air conditioning" : undefined, resoFacts?.furnished === true ? "furnished" : undefined]);
  const yearBuilt = num(root.yearBuilt) ?? num(resoFacts?.yearBuilt);
  const style = assessStyle(styleText([text(root.title), description, text(root.propertyType), ...facts]), yearBuilt);
  const listedDaysAgo = num(root.daysOnZillow);
  const status = text(details?.homeStatus);
  const listedAt = num(root.listingDateTimeOnZillow);
  return {
    id: `zillow:${zpid}`,
    title: street === "(undisclosed Address)" ? `Undisclosed address · ${text(address?.zipcode) ?? city}` : street,
    neighborhood: city,
    city,
    rent,
    beds,
    baths,
    sqft: num(root.livingArea),
    available: status === "FOR_RENT" ? `Listed for rent on Zillow${listedDaysAgo !== undefined ? ` · ${listedDaysAgo === 0 ? "today" : `${listedDaysAgo} day${listedDaysAgo === 1 ? "" : "s"} ago`}` : ""}` : status ? `Zillow status: ${status}` : "Availability needs confirmation",
    source: text(record(details?.attributionInfo)?.brokerName) ? `Zillow · ${text(record(details?.attributionInfo)?.brokerName)}` : "Zillow",
    sourceUrl,
    image,
    images,
    features: detectFeatures([description ?? "", ...facts].join(" ")),
    // The listing was active on Zillow at scrape time; that is the last-seen moment.
    freshness: status === "FOR_RENT" ? "live" : "needs-verification",
    capturedAt: now.toISOString(),
    lastSeenAt: status === "FOR_RENT" ? now.toISOString() : listedAt ? new Date(listedAt).toISOString() : undefined,
    yearBuilt,
    listedDaysAgo,
    ...styleFields(style),
  };
}
