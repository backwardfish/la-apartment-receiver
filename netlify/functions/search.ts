import { buildLiveSearchRequest, type LiveSearchRequest, type LiveSearchResponse } from "../../app/live-search.ts";
import { searchRentCast } from "../../app/providers.ts";

type Config = {
  path: string;
  method: ["POST"];
  rateLimit: {
    windowLimit: number;
    windowSize: number;
    aggregateBy: ["ip", "domain"];
  };
};

declare const Netlify: {
  env: {
    get(key: string): string | undefined;
  };
};

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
};

function response(body: LiveSearchResponse, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function unavailable(code: string, message: string): LiveSearchResponse {
  return { status: code === "search_not_configured" ? "unconfigured" : "unavailable", code, message };
}

function hasLiveSearchRequest(value: unknown): value is LiveSearchRequest {
  return !!value
    && typeof value === "object"
    && "query" in value
    && typeof (value as { query?: unknown }).query === "string";
}

export default async (request: Request) => {
  if (request.method !== "POST") {
    return response(unavailable("method_not_allowed", "Use POST to run a live apartment search."), 405);
  }

  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > 20_000) {
    return response(unavailable("payload_too_large", "The apartment search request is too large."), 413);
  }
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    return response(unavailable("unsupported_media_type", "Send the apartment search as JSON."), 415);
  }

  const payload: unknown = await request.json().catch(() => null);
  if (!hasLiveSearchRequest(payload)) {
    return response(unavailable("invalid_request", "A non-empty apartment search is required."), 400);
  }

  let normalized: LiveSearchRequest;
  try {
    normalized = buildLiveSearchRequest(payload.query);
  } catch (error) {
    const message = error instanceof Error ? error.message : "A non-empty apartment search is required.";
    return response(unavailable("invalid_request", message), 400);
  }

  const rentCastApiKey = Netlify.env.get("RENTCAST_API_KEY");
  const googleRoutesApiKey = Netlify.env.get("GOOGLE_ROUTES_API_KEY");
  if (!rentCastApiKey || (normalized.intent.commute && !googleRoutesApiKey)) {
    const missing = [
      !rentCastApiKey ? "RENTCAST_API_KEY" : null,
      normalized.intent.commute && !googleRoutesApiKey ? "GOOGLE_ROUTES_API_KEY" : null,
    ].filter(Boolean).join(" and ");
    return response(
      unavailable(
        "search_not_configured",
        `Live search needs ${missing} configured in Netlify. Receiver is showing its source-backed research snapshot instead.`,
      ),
      503,
    );
  }

  try {
    const results = await searchRentCast(normalized, { rentCastApiKey, googleRoutesApiKey });
    return response({
      status: "ok",
      query: normalized.query,
      searchedAt: new Date().toISOString(),
      results,
      provider: normalized.intent.commute ? "RentCast + Google Routes" : "RentCast",
    });
  } catch (error) {
    console.error("Live apartment search failed", error);
    return response(
      unavailable("search_provider_error", "The live-search provider could not return a usable result. Please try again shortly."),
      502,
    );
  }
};

export const config: Config = {
  path: "/api/search",
  method: ["POST"],
  rateLimit: {
    windowLimit: 15,
    windowSize: 60,
    aggregateBy: ["ip", "domain"],
  },
};
