import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { buildLiveSearchRequest } from "../app/live-search.ts";
import { assessStyle } from "../app/style.ts";
import { actorInput, normalizeZillowListing, planRuns, pollZillowRuns, startZillowRuns, MAX_RUNS, MAX_ITEMS_PER_RUN } from "../app/zillow-apify.ts";

// Real dataset rows returned by igolaizola/zillow-scraper-ppe on 2026-09-15 (Arts District, 1 mi, keyword "loft"; UCLA, 2 mi),
// trimmed to the fields the adapter reads. Public listing text; no account data.
const sample = JSON.parse(await readFile(new URL("./fixtures/zillow-apify-sample.json", import.meta.url), "utf8"));
const byStreet = (street) => sample.find((item) => item.address.streetAddress === street);
const now = new Date("2026-09-15T08:00:00.000Z");

test("normalises a real Zillow row with an exact listing URL, zillowstatic photo, and style evidence", () => {
  const hewitt = normalizeZillowListing(byStreet("130 S Hewitt St APT 31"), now);
  assert.ok(hewitt);
  assert.equal(hewitt.id, "zillow:122236602");
  assert.equal(hewitt.sourceUrl, "https://www.zillow.com/homedetails/130-S-Hewitt-St-APT-31-Los-Angeles-CA-90012/122236602_zpid/");
  assert.match(hewitt.image, /^https:\/\/photos\.zillowstatic\.com\//);
  assert.ok(Array.isArray(hewitt.images) && hewitt.images.length >= 1);
  assert.equal(hewitt.images[0], hewitt.image);
  assert.ok(hewitt.images.every((url) => /^https:\/\/photos\.zillowstatic\.com\//.test(url)));
  assert.equal(hewitt.rent, 3000); assert.equal(hewitt.beds, 1); assert.equal(hewitt.sqft, 1201); assert.equal(hewitt.yearBuilt, 1936);
  assert.equal(hewitt.styleGrade, "A", hewitt.warehouseSignals.join(","));
  assert.ok(hewitt.warehouseSignals.includes("Concrete") && hewitt.warehouseSignals.includes("High ceilings") && hewitt.warehouseSignals.includes("Built 1936"));
  assert.ok(hewitt.features.includes("Laundry"));
  assert.equal(hewitt.freshness, "live"); assert.equal(hewitt.listedDaysAgo, 4);
  assert.match(hewitt.available, /4 days ago/);
});

test("grades the real Arts District sample the way a loft hunter would", () => {
  const grade = (street) => normalizeZillowListing(byStreet(street), now)?.styleGrade ?? "skipped";
  assert.equal(grade("130 S Hewitt St APT 31"), "A");           // 1936, concrete floor, 24-ft ceiling, wall of glass
  assert.equal(grade("1850 Industrial St APT 706"), "B");        // Biscuit Company Lofts penthouse, no year built in record
  assert.equal(grade("201 S Santa Fe Ave Suite 211"), "B");      // title says live/work lofts; description is boilerplate, so not A
  assert.equal(grade("100 S Alameda St UNIT 424"), "D");         // generic condo with a "cozy upstairs loft"
  assert.equal(grade("1375 Midvale Ave APT 313"), "D");          // Westwood "1 BR with loft"
  assert.equal(grade("601 E 2nd St"), "skipped");                // apartment-community group row without unit facts
  const barker = normalizeZillowListing(byStreet("(undisclosed Address)"), now);
  assert.equal(barker.styleGrade, "A");
  assert.ok(barker.cautions.some((caution) => caution.startsWith("Short-term")), "furnished-monthly language is surfaced as a caution");
});

test("style grading rejects loft-inspired marketing and modern buildings without heavy evidence", () => {
  assert.equal(assessStyle("Brand new luxury apartments with loft-inspired layouts and high ceilings", 2022).grade, "C");
  assert.equal(assessStyle("Converted 1920s warehouse loft with exposed brick and 14 ft ceilings", 1924).grade, "A");
  assert.equal(assessStyle("Spacious two bedroom with in-unit laundry and parking").grade, "D");
  assert.equal(assessStyle("Industrial live/work loft with polished concrete floors and steel windows").grade, "A");
});

test("plans exactly one bounded actor run for the selected MVP neighborhood", () => {
  const request = buildLiveSearchRequest("warehouse conversion with exposed brick", "arts district");
  const plans = planRuns(request);
  assert.equal(plans.length, 1);
  assert.deepEqual(plans.map((plan) => plan.label), ["Arts District"]);
  const broadInput = actorInput(plans[0], request);
  assert.equal(broadInput.operation, "rent"); assert.equal(broadInput.keywords, undefined); assert.equal(broadInput.fetchDetails, true);
  assert.ok(broadInput.distanceMiles >= 1 && broadInput.maxItems === MAX_ITEMS_PER_RUN);
  const loftInput = actorInput(plans[0], buildLiveSearchRequest("warehouse loft under $3,500", "arts district"));
  assert.equal(loftInput.keywords, "loft");
  assert.equal(MAX_RUNS, 1);
  assert.throws(() => planRuns(buildLiveSearchRequest("loft near UCLA, USC, or Arts District")), /exactly one supported neighborhood/);
});

test("starts runs with a bearer token, never in the URL, and polls to ranked results", async () => {
  const calls = [];
  const fetcher = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).includes("/acts/") && init?.method === "POST") return Response.json({ data: { id: `run-${calls.length}`, defaultDatasetId: `ds-${calls.length}` } }, { status: 201 });
    if (String(url).includes("/actor-runs/")) return Response.json({ data: { status: "SUCCEEDED", usageTotalUsd: 0.021 } });
    if (String(url).includes("/datasets/")) return Response.json(sample);
    return new Response("unexpected", { status: 500 });
  };
  const request = buildLiveSearchRequest("warehouse loft under $3,500", "arts district");
  const runs = await startZillowRuns(request, { apifyToken: "secret-token" }, fetcher);
  assert.equal(runs.length, 1);
  for (const call of calls) { assert.doesNotMatch(call.url, /secret-token/); assert.equal(call.init.headers.authorization, "Bearer secret-token"); assert.equal(call.init.redirect, "error"); }
  const startBody = JSON.parse(calls[0].init.body);
  assert.equal(startBody.keywords, "loft");
  assert.match(calls[0].url, /maxTotalChargeUsd=0\.5/);
  const result = await pollZillowRuns(runs, request, { apifyToken: "secret-token" }, fetcher, now);
  assert.equal(result.status, "done");
  // Under $3,500, inside the Arts District circle, loft evidence required: Hewitt (A) first, then RiverFront (B). Savoy (D) and Westwood are out.
  assert.deepEqual(result.results.map((listing) => [listing.title, listing.styleGrade]), [["130 S Hewitt St APT 31", "A"], ["201 S Santa Fe Ave Suite 211", "B"]]);
  assert.equal(result.results[0].area, "Arts District");
  assert.equal(result.usageUsd, 0.021);
});

test("reports running, failed, and evidence-less runs distinctly", async () => {
  const request = buildLiveSearchRequest("loft", "arts district");
  const runs = [{ id: "r1", datasetId: "d1", area: "Arts District" }];
  const config = { apifyToken: "t" };
  assert.deepEqual(await pollZillowRuns(runs, request, config, async () => Response.json({ data: { status: "RUNNING" } })), { status: "running", finished: 0, total: 1 });
  assert.deepEqual(await pollZillowRuns(runs, request, config, async () => Response.json({ data: { status: "TIMED-OUT" } })), { status: "failed", code: "apify_run_timed_out" });
  await assert.rejects(pollZillowRuns(runs, request, config, async (url) => String(url).includes("/datasets/") ? Response.json([{ zpid: 1, address: { streetAddress: "x", city: "Los Angeles" }, price: { value: 1 }, bedrooms: 1, bathrooms: 1 }]) : Response.json({ data: { status: "SUCCEEDED" } })), (error) => error.code === "source_evidence_unavailable");
  await assert.rejects(pollZillowRuns(runs, request, config, async () => new Response("denied", { status: 401 })), (error) => error.code === "apify_http_401" && !error.message.includes("denied"));
  await assert.rejects(startZillowRuns(request, config, async () => Response.json({ data: {} }, { status: 201 })), (error) => error.code === "apify_invalid_payload");
});
