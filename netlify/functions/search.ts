import { buildLiveSearchRequest, isLiveSearchResponse, type LiveSearchRequest, type LiveSearchResponse } from "../../app/live-search.ts";

type Config = {
  path: string;
  method: ["POST"];
};

type Context = {
  requestId?: string;
};

declare const Netlify: {
  env: {
    get(key: string): string | undefined;
  };
};

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
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

/**
 * The connected provider receives the normalized search intent and must return
 * a LiveSearchResponse. This keeps provider credentials and provider-specific
 * scraping or licensed-feed details on the server, never in the browser.
 */
export default async (request: Request, context: Context) => {
  if (request.method !== "POST") {
    return response(unavailable("method_not_allowed", "Use POST to run a live apartment search."), 405);
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

  const providerUrl = Netlify.env.get("RECEIVER_SEARCH_PROVIDER_URL");
  const providerApiKey = Netlify.env.get("RECEIVER_SEARCH_PROVIDER_API_KEY");
  if (!providerUrl || !providerApiKey) {
    return response(
      unavailable(
        "search_not_configured",
        "Live search is not connected yet. Receiver is showing its source-backed research snapshot instead.",
      ),
      503,
    );
  }

  try {
    const providerResponse = await fetch(providerUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${providerApiKey}`,
        "x-receiver-request-id": context.requestId ?? "",
      },
      body: JSON.stringify(normalized),
    });
    const result: unknown = await providerResponse.json().catch(() => null);
    if (!providerResponse.ok || !isLiveSearchResponse(result)) {
      return response(
        unavailable("search_provider_error", "The live-search provider could not return a usable result. Please try again shortly."),
        502,
      );
    }

    return response(result, result.status === "ok" ? 200 : 503);
  } catch {
    return response(
      unavailable("search_provider_unreachable", "The live-search provider is temporarily unavailable. Please try again shortly."),
      503,
    );
  }
};

export const config: Config = {
  path: "/api/search",
  method: ["POST"],
};
