// Server/CLI boundary. Browser code imports types.ts and client.ts only.
import type { ProviderResponse, SearchProvider, WebSearchResult } from "./types.ts";

export class SearchError extends Error {
  code: string;
  status?: number;

  constructor(code: string, message: string, status?: number) {
    super(message);
    this.name = "SearchError";
    this.code = code;
    this.status = status;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizeQuery(value: unknown): string {
  if (typeof value !== "string") throw new SearchError("input", "Enter a search query.");
  const query = value.trim().replace(/\s+/g, " ");
  if (!query || query.length > 600 || query.split(" ").length > 75) {
    throw new SearchError("input", "Use a query of 1–600 characters and at most 75 words.");
  }
  return query;
}

function webUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return;
  try {
    const url = new URL(value);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) return;
    return url.href;
  } catch {
    return;
  }
}

function plainText(value: unknown, braveMarkup = false): string {
  if (typeof value !== "string") return "";
  const entities: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  const text = braveMarkup ? value.replace(/<\/?(?:b|strong|em|mark)>/gi, "") : value;
  return text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (match, entity: string) => {
    if (!entity.startsWith("#")) return entities[entity.toLowerCase()] ?? match;
    const code = entity.toLowerCase().startsWith("#x") ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
    return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
  }).trim();
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export function parseProviderResponse(provider: SearchProvider, value: unknown): ProviderResponse {
  if (!isRecord(value)) throw new SearchError("invalid_response", "Search returned an unexpected response.");
  let items: unknown;
  if (provider === "exa") {
    items = value.results;
  } else if (value.web == null && (value.type === "search" || isRecord(value.query))) {
    items = [];
  } else {
    items = isRecord(value.web) ? value.web.results : undefined;
  }
  if (!Array.isArray(items)) throw new SearchError("invalid_response", "Search returned an unexpected response.");

  const seen = new Set<string>();
  const results: WebSearchResult[] = [];
  for (const item of items.slice(0, 10)) {
    if (!isRecord(item)) continue;
    const url = webUrl(item.url);
    const title = plainText(item.title, provider === "brave").replace(/\s+/g, " ").slice(0, 500);
    if (!url || !title || seen.has(url)) continue;
    seen.add(url);
    const passages = provider === "exa"
      ? stringList(item.highlights)
      : [typeof item.description === "string" ? item.description : "", ...stringList(item.extra_snippets)];
    const result: WebSearchResult = {
      id: `${provider}:${url}`,
      title,
      url,
      // Keep evidence available to the caller; the UI controls excerpt length.
      excerpt: [...new Set(passages.map((passage) => plainText(passage, provider === "brave")).filter(Boolean))].join("\n\n"),
    };
    // Brave page_age can be publication OR modification; do not label it as publication.
    if (provider === "exa" && typeof item.publishedDate === "string" && Number.isFinite(Date.parse(item.publishedDate))) {
      result.publishedAt = new Date(item.publishedDate).toISOString();
    }
    results.push(result);
  }
  if (items.length > 0 && results.length === 0) {
    throw new SearchError("invalid_response", "Search returned no usable result records.");
  }
  const response: ProviderResponse = { provider, results };
  if (typeof value.requestId === "string") response.requestId = value.requestId;
  if (provider === "exa" && isRecord(value.costDollars)) {
    const total = value.costDollars.total;
    if (typeof total === "number" && Number.isFinite(total) && total >= 0) response.reportedCostUsd = total;
  }
  return response;
}

type SearchOptions = {
  provider: SearchProvider;
  apiKey: string;
  country?: string;
  signal?: AbortSignal;
  fetcher?: typeof fetch;
};

export async function searchWeb(queryInput: string, options: SearchOptions): Promise<ProviderResponse> {
  const query = normalizeQuery(queryInput);
  if (!options.apiKey.trim()) throw new SearchError("configuration", "Search credentials are not configured.");
  if (options.country !== undefined && !/^[A-Z]{2}$/.test(options.country)) {
    throw new SearchError("input", "Use a two-letter country code.");
  }
  options.signal?.throwIfAborted();
  const fetcher = options.fetcher ?? fetch;
  const headers: Record<string, string> = { Accept: "application/json" };
  let url: string;
  let body: string | undefined;
  if (options.provider === "exa") {
    url = "https://api.exa.ai/search";
    headers["Content-Type"] = "application/json";
    headers["x-api-key"] = options.apiKey;
    body = JSON.stringify({
      query,
      type: "auto",
      contents: { highlights: true },
      ...(options.country ? { userLocation: options.country } : {}),
    });
  } else {
    const endpoint = new URL("https://api.search.brave.com/res/v1/web/search");
    endpoint.search = new URLSearchParams({
      q: query,
      count: "10",
      offset: "0",
      result_filter: "web",
      extra_snippets: "true",
      text_decorations: "false",
      search_lang: "en",
      ...(options.country ? { country: options.country } : {}),
    }).toString();
    url = endpoint.href;
    headers["X-Subscription-Token"] = options.apiKey;
  }
  let response: Response;
  try {
    response = await fetcher(url, { method: body ? "POST" : "GET", headers, body, signal: options.signal, cache: "no-store" });
  } catch (error) {
    if (options.signal?.aborted) throw options.signal.reason;
    if (error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name)) throw error;
    throw new SearchError("network", "Could not reach the search provider.");
  }
  if (!response.ok) {
    // Never forward provider error bodies, request headers, or credentials.
    await response.body?.cancel();
    throw new SearchError("upstream", "The search provider could not complete this request.", response.status);
  }
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    if (options.signal?.aborted) throw options.signal.reason;
    throw new SearchError("invalid_response", "Search returned an unexpected response.");
  }
  options.signal?.throwIfAborted();
  return parseProviderResponse(options.provider, value);
}
