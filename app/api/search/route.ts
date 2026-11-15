import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";
import { withEvaluationBudget } from "../../../lib/evaluation.ts";
import { normalizeQuery, searchWeb, SearchError } from "../../../lib/search/providers.ts";
import { prepareEvidence } from "../../../lib/answer/generate.ts";
import { ANSWER_SESSION_COOKIE, createAnswerContext, newAnswerSession, readAnswerSession } from "../../../lib/answer/context.ts";
import { assertLocalRequest, readBoundedJson, RequestPolicyError } from "../../../lib/local-request.ts";
import { assertHostedRequest, getOrCreateHostedSession, hostedSessionBudgetKey } from "../../../lib/hosted-request.ts";
import { HostedBudgetError, withHostedBudget } from "../../../lib/hosted-budget.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 20;

function failure(message: string, status: number, requestId: string, sessionCookie?: string): Response {
  return Response.json({ error: message, requestId }, { status, headers: { "Cache-Control": "no-store", "X-Request-Id": requestId, ...(sessionCookie ? { "Set-Cookie": sessionCookie } : {}) } });
}

export async function POST(request: Request): Promise<Response> {
  const requestId = randomUUID();
  const started = performance.now();
  let external: URL;
  let query: string;
  const hosted = Boolean(process.env.VERCEL) || process.env.NODE_ENV === "production";
  let sessionId: string | undefined;
  let sessionCookie: string | undefined;
  let operationId: string | undefined;
  try {
    external = hosted ? assertHostedRequest(request) : assertLocalRequest(request);
    const input = await readBoundedJson(request, 8192);
    query = normalizeQuery(input && typeof input === "object" && "query" in input ? input.query : undefined);
    if (hosted) {
      const id = input && typeof input === "object" && "operationId" in input ? input.operationId : undefined;
      if (typeof id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
        throw new RequestPolicyError("Send a valid search request.", 400);
      }
      const session = getOrCreateHostedSession(request.headers.get("cookie"), process.env.ANSWER_CONTEXT_SECRET ?? "");
      sessionId = session.id;
      sessionCookie = session.setCookie;
      operationId = createHash("sha256").update(`search:${sessionId}:${id}`).digest("hex");
    }
  } catch (error) {
    return failure(error instanceof Error ? error.message : "Send a valid search query.", error instanceof RequestPolicyError ? error.status : 400, requestId);
  }
  const configured = process.env.SEARCH_PROVIDER ?? "exa";
  if (configured !== "exa" && configured !== "brave") return failure("Search is not configured correctly.", 503, requestId);
  const apiKey = process.env[configured === "exa" ? "EXA_API_KEY" : "BRAVE_SEARCH_API_KEY"];
  if (!apiKey?.trim()) return failure("Search credentials are not configured.", 503, requestId);

  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(3_000)]);
  try {
    signal.throwIfAborted();
    const work = () => { signal.throwIfAborted(); return searchWeb(query, { provider: configured, apiKey, signal }); };
    const response = hosted ? await withHostedBudget({
      operationId: operationId!, sessionKey: hostedSessionBudgetKey(sessionId!, process.env.ANSWER_CONTEXT_SECRET!), kind: configured === "exa" ? "search_exa" : "search_brave",
    }, work) : await withEvaluationBudget({
      directory: join(process.cwd(), ".evaluation"), callId: `interactive/${requestId}`, provider: configured,
    }, work);
    const headers = new Headers({ "Cache-Control": "no-store", "X-Request-Id": requestId });
    if (sessionCookie) headers.set("Set-Cookie", sessionCookie);
    let answerContext: string | undefined;
    const secret = process.env.ANSWER_CONTEXT_SECRET;
    if (process.env.AI_GATEWAY_API_KEY && secret && /^[a-f0-9]{64,}$/i.test(secret)) {
      // Failure to prepare optional evidence must never discard useful search results.
      try {
        const prepared = prepareEvidence(query, response.results.filter(result => result.excerpt.trim()).slice(0, 5).map((result, index) => ({ ...result, id: `S${index + 1}` })));
        if (prepared.sources.length) {
          const session = sessionId ?? readAnswerSession(request.headers.get("cookie")) ?? newAnswerSession();
          answerContext = createAnswerContext(prepared.query, prepared.sources, session, secret);
          if (!hosted) headers.set("Set-Cookie", `${ANSWER_SESSION_COOKIE}=${session}; HttpOnly; SameSite=Strict; Path=/; Max-Age=600${external.protocol === "https:" ? "; Secure" : ""}`);
        }
      } catch { /* Search remains usable when optional answer preparation fails. */ }
    }
    console.info(JSON.stringify({ event: "search_completed", requestId, provider: configured, elapsedMs: Math.round(performance.now() - started), resultCount: response.results.length, answerAvailable: Boolean(answerContext) }));
    return Response.json({ provider: response.provider, results: response.results, ...(answerContext ? { answerContext } : {}) }, { headers });
  } catch (error) {
    console.info(JSON.stringify({ event: "search_failed", requestId, provider: configured, elapsedMs: Math.round(performance.now() - started), reason: signal.aborted ? "cancelled_or_timeout" : error instanceof SearchError ? "provider" : "budget_unavailable" }));
    if (signal.aborted) return failure("Search took too long or was cancelled. Please try again.", 504, requestId, sessionCookie);
    if (error instanceof HostedBudgetError) {
      const response = failure(error.message, error.status, requestId);
      if (sessionCookie) response.headers.set("Set-Cookie", sessionCookie);
      if (error.retryAfterSeconds) response.headers.set("Retry-After", String(error.retryAfterSeconds));
      return response;
    }
    if (error instanceof SearchError) return failure(error.status === 429 ? "The search provider is busy. Please try again shortly." : error.message, error.status === 429 ? 429 : 502, requestId, sessionCookie);
    return failure("The demo is busy or its spending allowance is unavailable. Please try again later.", 503, requestId, sessionCookie);
  }
}
