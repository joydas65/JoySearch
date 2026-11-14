import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";
import { withMeteredEvaluation } from "../../../lib/evaluation.ts";
import { AnswerContextError, readAnswerSession, verifyAnswerContext } from "../../../lib/answer/context.ts";
import { generateCitedAnswer, prepareEvidence, type PreparedEvidence } from "../../../lib/answer/generate.ts";
import { ANSWER_DEADLINE_MS, ANSWER_RESERVATION_MICROS, DEFAULT_ANSWER_MODEL } from "../../../lib/answer/model.ts";
import type { AnswerEvent } from "../../../lib/answer/types.ts";
import { assertLocalRequest, readBoundedJson, RequestPolicyError } from "../../../lib/local-request.ts";
import { assertHostedRequest, hostedSessionBudgetKey, readHostedSession } from "../../../lib/hosted-request.ts";
import { HostedBudgetError, withHostedBudget } from "../../../lib/hosted-budget.ts";
import type { MeteringProgress } from "../../../lib/evaluation.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 20;

export async function POST(request: Request): Promise<Response> {
  const requestId = randomUUID();
  const headers = { "Cache-Control": "no-store", "X-Request-Id": requestId };
  let evidence: PreparedEvidence;
  const apiKey = process.env.AI_GATEWAY_API_KEY;
  const hosted = Boolean(process.env.VERCEL) || process.env.NODE_ENV === "production";
  let operationId: string | undefined;
  let sessionKey: string | undefined;
  try {
    if (hosted) assertHostedRequest(request);
    else assertLocalRequest(request);
    if (!apiKey || !process.env.ANSWER_CONTEXT_SECRET) return Response.json({ error: "Cited answers are not configured.", requestId }, { status: 503, headers });
    const body = await readBoundedJson(request, 25_000);
    const token = body && typeof body === "object" && "contextToken" in body ? body.contextToken : undefined;
    const session = hosted ? readHostedSession(request.headers.get("cookie"), process.env.ANSWER_CONTEXT_SECRET) : readAnswerSession(request.headers.get("cookie"));
    const context = verifyAnswerContext(token, session, process.env.ANSWER_CONTEXT_SECRET);
    if (hosted) {
      operationId = createHash("sha256").update(`answer:${token}`).digest("hex");
      sessionKey = hostedSessionBudgetKey(session!, process.env.ANSWER_CONTEXT_SECRET);
    }
    // A prompt update may reduce available passage space while an older receipt is still valid.
    // Inspectable sources must match this generation's packed evidence, not the older receipt.
    evidence = prepareEvidence(context.query, context.sources);
  } catch (error) {
    const status = error instanceof AnswerContextError ? (error.code === "expired_context" ? 410 : 403) : error instanceof RequestPolicyError ? error.status : 400;
    return Response.json({ error: error instanceof AnswerContextError || error instanceof RequestPolicyError ? error.message : "Send a valid answer request.", requestId }, { status, headers });
  }
  const controller = new AbortController();
  const signal = AbortSignal.any([request.signal, controller.signal, AbortSignal.timeout(ANSWER_DEADLINE_MS)]);
  const encoder = new TextEncoder();
  const started = performance.now();
  let closed = false;
  const stream = new ReadableStream<Uint8Array>({
    async start(output) {
      const emit = (event: AnswerEvent) => {
        if (!closed && !signal.aborted) output.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };
      try {
        signal.throwIfAborted();
        const work = async (report: (progress: MeteringProgress) => void) => {
          signal.throwIfAborted();
          emit({ type: "start", requestId, sources: evidence.sources });
          return generateCitedAnswer({ query: evidence.query, sources: evidence.sources, apiKey, model: DEFAULT_ANSWER_MODEL, signal,
            onMetering: report,
            onEvent: event => { if (event.type === "claim") emit(event); },
          });
        };
        const result = hosted ? await withHostedBudget({ operationId: operationId!, sessionKey: sessionKey!, kind: "answer" }, work) : await withMeteredEvaluation({
          directory: join(process.cwd(), ".evaluation"), callId: `answer/${requestId}`, provider: "ai-gateway", reservedMicros: ANSWER_RESERVATION_MICROS,
        }, work);
        signal.throwIfAborted();
        emit({ type: "done", kind: result.kind, ...(result.message ? { message: result.message } : {}) });
        console.info(JSON.stringify({ event: "answer_completed", requestId, elapsedMs: Math.round(performance.now() - started), kind: result.kind, claims: result.claims.length, inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens, callCount: result.callCount, providerRequestIds: result.providerRequestIds }));
      } catch (error) {
        const timedOut = signal.aborted && signal.reason?.name === "TimeoutError";
        if (!closed) {
          output.enqueue(encoder.encode(`${JSON.stringify({ type: "error", code: timedOut ? "timeout" : signal.aborted ? "cancelled" : "answer_unavailable", message: timedOut ? "The answer took too long. Your search results are still available." : signal.aborted ? "Answer generation stopped. Your search results are still available." : error instanceof HostedBudgetError ? error.message : "The answer could not be completed. Your search results are still available.", requestId } satisfies AnswerEvent)}\n`));
        }
        console.info(JSON.stringify({ event: "answer_failed", requestId, elapsedMs: Math.round(performance.now() - started), reason: timedOut ? "timeout" : signal.aborted ? "cancelled" : "provider_or_budget" }));
      } finally {
        if (!closed) { closed = true; output.close(); }
      }
    },
    cancel() { closed = true; controller.abort(new DOMException("Client disconnected", "AbortError")); },
  });
  return new Response(stream, { headers: { ...headers, "Content-Type": "application/x-ndjson; charset=utf-8", "X-Content-Type-Options": "nosniff" } });
}
