import type { SearchResponse, WebSearchResult } from "./types";

const RESPONSE_ERROR = "JoySearch returned an unexpected response. Please try again.";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isWebUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password;
  } catch {
    return false;
  }
}

function parseResponse(value: unknown): SearchResponse {
  if (
    !isRecord(value) ||
    (value.provider !== "exa" && value.provider !== "brave") ||
    !Array.isArray(value.results)
  ) {
    throw new Error(RESPONSE_ERROR);
  }

  const ids = new Set<string>();
  const results = value.results.map((item: unknown): WebSearchResult => {
    if (
      !isRecord(item) ||
      typeof item.id !== "string" ||
      !item.id.trim() ||
      ids.has(item.id) ||
      typeof item.title !== "string" ||
      !item.title.trim() ||
      !isWebUrl(item.url) ||
      typeof item.excerpt !== "string"
    ) {
      throw new Error(RESPONSE_ERROR);
    }
    ids.add(item.id);

    const result: WebSearchResult = {
      id: item.id,
      title: item.title,
      url: item.url,
      excerpt: item.excerpt,
    };
    if (typeof item.publishedAt === "string" && Number.isFinite(Date.parse(item.publishedAt))) {
      result.publishedAt = new Date(item.publishedAt).toISOString();
    }
    return result;
  });

  if (value.answerContext !== undefined && (typeof value.answerContext !== "string" ||
      !value.answerContext.trim() || value.answerContext.length > 24_000)) {
    throw new Error(RESPONSE_ERROR);
  }
  return {
    provider: value.provider,
    results,
    ...(typeof value.answerContext === "string" ? { answerContext: value.answerContext } : {}),
  };
}

export async function searchWeb(
  query: string,
  { signal }: { signal?: AbortSignal } = {},
): Promise<SearchResponse> {
  let response: Response;
  try {
    response = await fetch("/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: query.trim().replace(/\s+/g, " "), operationId: crypto.randomUUID() }),
      cache: "no-store",
      credentials: "same-origin",
      signal,
    });
  } catch (error) {
    if (signal?.aborted || (error instanceof Error && error.name === "AbortError")) throw error;
    throw new Error("Could not reach JoySearch. Check your connection and try again.");
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new Error(response.ok ? RESPONSE_ERROR : "Search is unavailable right now. Please try again shortly.");
  }

  if (!response.ok) {
    throw new Error(
      isRecord(data) && typeof data.error === "string" && data.error.trim() && data.error.length <= 300
        ? data.error
        : "Search is unavailable right now. Please try again shortly.",
    );
  }

  return parseResponse(data);
}
