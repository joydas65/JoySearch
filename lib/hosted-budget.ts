import { neon } from "@neondatabase/serverless";
import type { MeteringProgress } from "./evaluation.ts";

export const HOSTED_BUDGET_MICROS = 1_000_000;
const RESERVATIONS = { search_exa: 7_000, search_brave: 5_000, answer: 10_000 } as const;
export type HostedOperationKind = keyof typeof RESERVATIONS;
export type HostedBudgetOptions = { operationId: string; sessionKey: string; kind: HostedOperationKind };
type Execute = (query: string, parameters: unknown[]) => Promise<Record<string, unknown>[]>;
type Metrics = Record<string, number | boolean | string[]>;

export class HostedBudgetError extends Error {
  readonly code: string;
  readonly status: number;
  readonly retryAfterSeconds?: number;
  constructor(code = "unavailable", retryAfterSeconds?: number) {
    const messages: Record<string, string> = {
      budget_exhausted: "The live demo allowance has been used.",
      session_exhausted: "This session has used its live demo allowance.",
      rate_limited: "Please wait briefly before trying again.",
      duplicate: "This request has already been submitted. Run a new search to continue.",
      operation_conflict: "This request has already been submitted.",
      disabled: "Live requests are currently paused.",
    };
    super(messages[code] ?? "Live requests are temporarily unavailable.");
    this.name = "HostedBudgetError";
    this.code = code;
    this.status = code === "duplicate" || code === "operation_conflict" ? 409
      : code === "session_exhausted" || code === "rate_limited" ? 429 : 503;
    if (Number.isInteger(retryAfterSeconds) && retryAfterSeconds! > 0 && retryAfterSeconds! <= 60) this.retryAfterSeconds = retryAfterSeconds;
  }
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function integer(value: unknown, maximum = 1_000_000_000): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= maximum;
}

function validateProgress(progress: MeteringProgress, metrics: Metrics) {
  const usage = progress?.usage;
  if (!progress || !integer(progress.callCount, 2) || progress.callCount < (Number(metrics.callCount) || 0)
      || typeof progress.usageComplete !== "boolean" || !Array.isArray(progress.providerRequestIds)
      || progress.providerRequestIds.length > progress.callCount || new Set(progress.providerRequestIds).size !== progress.providerRequestIds.length
      || progress.providerRequestIds.some(id => typeof id !== "string" || !/^[a-zA-Z0-9_:-]{1,160}$/.test(id))
      || ((metrics.providerRequestIds ?? []) as string[]).some(id => !progress.providerRequestIds.includes(id))
      || !usage || [usage.inputTokens, usage.outputTokens, usage.totalTokens].some(value => !integer(value))
      || usage.inputTokens < (Number(metrics.inputTokens) || 0) || usage.outputTokens < (Number(metrics.outputTokens) || 0)
      || usage.totalTokens < (Number(metrics.totalTokens) || 0)
      || (usage.reasoningTokens !== undefined && (!integer(usage.reasoningTokens) || usage.reasoningTokens > usage.outputTokens))) {
    throw new HostedBudgetError("invalid_metering");
  }
  Object.assign(metrics, { callCount: progress.callCount, providerRequestIds: [...progress.providerRequestIds], usageComplete: progress.usageComplete,
    inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, totalTokens: usage.totalTokens });
  if (usage.reasoningTokens !== undefined) metrics.reasoningTokens = usage.reasoningTokens;
  else delete metrics.reasoningTokens;
}

async function command(execute: Execute, query: string, parameters: unknown[]): Promise<Record<string, unknown>> {
  let rows: Record<string, unknown>[];
  try { rows = await execute(query, parameters); }
  catch { throw new HostedBudgetError(); }
  if (!Array.isArray(rows) || rows.length !== 1 || !object(rows[0]?.result)) throw new HostedBudgetError();
  return rows[0].result;
}

/** Injectable SQL boundary for tests; production only uses the fixed stored functions below. */
export function createHostedBudget(execute: Execute) {
  return async function withBudget<T>(options: HostedBudgetOptions, work: (report: (progress: MeteringProgress) => void) => Promise<T>): Promise<T> {
    if (!/^[a-f0-9]{64}$/.test(options.operationId) || !/^[a-f0-9]{64}$/.test(options.sessionKey)
        || !Object.hasOwn(RESERVATIONS, options.kind)) throw new HostedBudgetError("invalid_request");
    const reservation = await command(execute, "SELECT joysearch_budget.reserve($1, $2, $3) AS result", [options.operationId, options.sessionKey, options.kind]);
    if (reservation.accepted !== true) {
      throw new HostedBudgetError(typeof reservation.code === "string" ? reservation.code : undefined,
        typeof reservation.retryAfterSeconds === "number" ? reservation.retryAfterSeconds : undefined);
    }
    if (reservation.operationId !== options.operationId || reservation.reservedMicros !== RESERVATIONS[options.kind]
        || reservation.capMicros !== HOSTED_BUDGET_MICROS || !integer(reservation.committedMicros, HOSTED_BUDGET_MICROS)
        || reservation.committedMicros < RESERVATIONS[options.kind]) throw new HostedBudgetError();

    const started = performance.now();
    const metrics: Metrics = { resultCount: 0 };
    let status = "provider_error";
    try {
      const result = await work(progress => validateProgress(progress, metrics));
      if (object(result)) {
        const count = Array.isArray(result.results) ? result.results.length : Array.isArray(result.claims) ? result.claims.length : 0;
        metrics.resultCount = Math.min(count, 100);
        if (!metrics.providerRequestIds && typeof result.requestId === "string" && /^[a-zA-Z0-9_:-]{1,160}$/.test(result.requestId)) metrics.providerRequestIds = [result.requestId];
        if (typeof result.reportedCostUsd === "number" && Number.isFinite(result.reportedCostUsd) && result.reportedCostUsd >= 0) {
          const amount = Math.ceil(result.reportedCostUsd * 1_000_000);
          if (!integer(amount)) throw new HostedBudgetError("invalid_metering");
          metrics.reportedCostMicros = amount;
        }
      }
      status = "success";
      return result;
    } catch (error) {
      if (error instanceof Error && error.name === "TimeoutError") status = "timeout";
      else if (error instanceof Error && error.name === "AbortError") status = "cancelled";
      throw error;
    } finally {
      metrics.elapsedMs = Math.min(1_000_000_000, Math.max(0, Math.ceil(performance.now() - started)));
      const settlement = await command(execute, "SELECT joysearch_budget.settle($1, $2, $3::jsonb) AS result", [options.operationId, status, JSON.stringify(metrics)]);
      if (settlement.accepted !== true) throw new HostedBudgetError();
    }
  };
}

export function validateBudgetDatabaseUrl(value: string | undefined): string {
  if (!value) throw new HostedBudgetError();
  try {
    const url = new URL(value);
    if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname.endsWith(".neon.tech")
        || url.username !== "joysearch_runtime" || !url.password || !/^\/[a-zA-Z0-9_-]+$/.test(url.pathname)
        || (url.port && url.port !== "5432") || !["require", "verify-full"].includes(url.searchParams.get("sslmode") ?? "")
        || url.hash) throw new Error("Invalid database URL");
    return value;
  } catch { throw new HostedBudgetError(); }
}

export async function withHostedBudget<T>(options: HostedBudgetOptions, work: (report: (progress: MeteringProgress) => void) => Promise<T>): Promise<T> {
  // No database or credentials are evaluated at module import/build time. One HTTP request per function,
  // no transaction held during inference, and no retries after an uncertain reservation response.
  const sql = neon(validateBudgetDatabaseUrl(process.env.BUDGET_DATABASE_URL));
  const execute: Execute = async (query, parameters) => {
    return await sql.query(query, parameters, { fetchOptions: { signal: AbortSignal.timeout(3_000) } }) as Record<string, unknown>[];
  };
  return createHostedBudget(execute)(options, work);
}
