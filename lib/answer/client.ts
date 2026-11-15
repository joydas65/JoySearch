import type { AnswerContentEvent, AnswerEvent, AnswerSource } from "./types";

const STREAM_ERROR = "The answer could not be completed safely. Your search results are still available.";
const MAX_STREAM_BYTES = 65_536;
const MAX_LINE_CHARACTERS = 24_000;

class AnswerStreamError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isText(value: unknown, limit: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= limit;
}

function isWebUrl(value: unknown): value is string {
  if (!isText(value, 4096)) return false;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password;
  } catch { return false; }
}

function invalid(): never { throw new AnswerStreamError(STREAM_ERROR); }

function parseSources(value: unknown): AnswerSource[] {
  if (!Array.isArray(value) || value.length > 5) return invalid();
  const ids = new Set<string>();
  const urls = new Set<string>();
  return value.map((source: unknown) => {
    if (!isRecord(source) || !isText(source.id, 64) || ids.has(source.id) ||
        !isText(source.title, 500) || !isWebUrl(source.url) || urls.has(source.url) ||
        typeof source.excerpt !== "string" || source.excerpt.length > 12_000) return invalid();
    ids.add(source.id);
    urls.add(source.url);
    return { id: source.id, title: source.title, url: source.url, excerpt: source.excerpt };
  });
}

/** The browser accepts citation IDs only; all link destinations come from the source map. */
export async function streamCitedAnswer(
  contextToken: string,
  { signal, onEvent }: { signal?: AbortSignal; onEvent: (event: AnswerEvent) => void },
): Promise<void> {
  if (!isText(contextToken, 24_000)) throw new AnswerStreamError("Search again before generating an answer.");
  signal?.throwIfAborted();
  let response: Response;
  try {
    response = await fetch("/api/answer", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/x-ndjson" },
      body: JSON.stringify({ contextToken }),
      credentials: "same-origin",
      cache: "no-store",
      signal,
    });
  } catch (error) {
    if (signal?.aborted) throw signal.reason;
    if (error instanceof Error && error.name === "AbortError") throw error;
    throw new AnswerStreamError("Could not reach JoySearch. Your search results are still available.");
  }

  if (!response.body) return invalid();
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let receivedBytes = 0;
  let buffer = "";
  let sourceIds: Set<string> | undefined;
  let claimCount = 0;
  let terminal: AnswerContentEvent | undefined;
  let reachedEnd = false;
  const cancel = () => { void reader.cancel().catch(() => undefined); };
  signal?.addEventListener("abort", cancel, { once: true });

  function acceptLine(line: string) {
    if (!line.trim()) return;
    if (line.length > MAX_LINE_CHARACTERS || terminal) return invalid();
    let event: unknown;
    try { event = JSON.parse(line); } catch { return invalid(); }
    if (!isRecord(event)) return invalid();
    if (event.type === "error") {
      if (!isText(event.message, 300) || !isText(event.code, 80) || !isText(event.requestId, 160)) return invalid();
      throw new AnswerStreamError(event.message);
    }
    if (event.type === "start") {
      if (sourceIds || !isText(event.requestId, 160)) return invalid();
      const sources = parseSources(event.sources);
      sourceIds = new Set(sources.map((source) => source.id));
      onEvent({ type: "start", requestId: event.requestId, sources });
    } else if (event.type === "claim") {
      if (!sourceIds || !isRecord(event.claim) || claimCount >= 8 ||
          !isText(event.claim.text, 1600) || !Array.isArray(event.claim.sourceIds) ||
          !event.claim.sourceIds.length || event.claim.sourceIds.length > 5 ||
          event.claim.sourceIds.some((id) => typeof id !== "string" || !sourceIds!.has(id)) ||
          new Set(event.claim.sourceIds).size !== event.claim.sourceIds.length) return invalid();
      claimCount += 1;
      onEvent({ type: "claim", claim: { text: event.claim.text, sourceIds: event.claim.sourceIds as string[] } });
    } else if (event.type === "done") {
      if (!sourceIds || typeof event.kind !== "string" || !["answer", "navigation", "clarify", "insufficient"].includes(event.kind)) return invalid();
      if (event.kind === "answer" || event.kind === "navigation") {
        if (!claimCount || event.message !== undefined) return invalid();
        terminal = { type: "done", kind: event.kind };
      } else {
        if (claimCount || !isText(event.message, 1600)) return invalid();
        terminal = { type: "done", kind: event.kind as "clarify" | "insufficient", message: event.message };
      }
    } else return invalid();
  }

  try {
    if (signal?.aborted) { cancel(); signal.throwIfAborted(); }
    if (response.ok && !response.headers.get("content-type")?.toLowerCase().includes("application/x-ndjson")) return invalid();
    while (true) {
      signal?.throwIfAborted();
      const chunk = await reader.read();
      signal?.throwIfAborted();
      if (chunk.done) { reachedEnd = true; break; }
      receivedBytes += chunk.value.byteLength;
      if (receivedBytes > (response.ok ? MAX_STREAM_BYTES : 4096)) return invalid();
      buffer += decoder.decode(chunk.value, { stream: true });
      if (!response.ok) continue;
      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        acceptLine(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
      }
      if (buffer.length > MAX_LINE_CHARACTERS) return invalid();
    }
    buffer += decoder.decode();
    if (!response.ok) {
      let error: unknown;
      try { error = JSON.parse(buffer); } catch { return invalid(); }
      throw new AnswerStreamError(isRecord(error) && isText(error.error, 300) ? error.error : STREAM_ERROR);
    }
    // A terminal event is committed only after a clean EOF with no trailing events.
    if (buffer.trim()) acceptLine(buffer);
    if (!terminal) return invalid();
    onEvent(terminal);
  } catch (error) {
    if (signal?.aborted) throw signal.reason;
    if (error instanceof AnswerStreamError) throw error;
    throw new AnswerStreamError(STREAM_ERROR);
  } finally {
    signal?.removeEventListener("abort", cancel);
    if (!reachedEnd) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
