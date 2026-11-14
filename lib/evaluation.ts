import { mkdir, open, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";

export type EvaluationProvider = "exa" | "brave";
export type LedgerProvider = EvaluationProvider | "ai-gateway" | "hosted-budget";
export type EvaluationPhase = "development" | "holdout" | "all";

export const EVALUATION_BUDGET_MICROS = 5_000_000;
export const SEARCH_COST_MICROS: Record<EvaluationProvider, number> = {
  exa: 7_000,
  brave: 5_000,
};
export const EVALUATION_DEADLINE_MS = 3_000;

export type EvaluationQuery = {
  id: string;
  category: string;
  split: "development" | "holdout";
  query: string;
  country: string;
  language: string;
  freshness: string;
  answerSample: boolean;
};

export type PlannedSearch = {
  callId: string;
  provider: EvaluationProvider;
  query: EvaluationQuery;
  repetition: number;
  reservedMicros: number;
};

function shuffle<T>(items: readonly T[], seed: number): T[] {
  let state = seed >>> 0;
  const output = [...items];
  for (let i = output.length - 1; i > 0; i -= 1) {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    const j = Math.floor((state / 0x1_0000_0000) * (i + 1));
    [output[i], output[j]] = [output[j], output[i]];
  }
  return output;
}

export function buildEvaluationPlan(
  queries: readonly EvaluationQuery[],
  options: { phase: EvaluationPhase; seed: number; campaign: string; limit?: number },
): PlannedSearch[] {
  const selected = queries
    .filter((query) => options.phase === "all" || query.split === options.phase)
    .slice(0, options.limit);
  const plan: PlannedSearch[] = [];
  for (const split of ["development", "holdout"] as const) {
    const subset = selected.filter((query) => query.split === split);
    const repetitions = split === "holdout" ? 3 : 1;
    for (let repetition = 1; repetition <= repetitions; repetition += 1) {
      const ordered = shuffle(subset, options.seed + repetition + (split === "holdout" ? 100 : 0));
      ordered.forEach((query, index) => {
        const providers: EvaluationProvider[] = (index + repetition + options.seed) % 2 === 0
          ? ["exa", "brave"]
          : ["brave", "exa"];
        for (const provider of providers) {
          plan.push({
            callId: `${options.campaign}/${split}/${repetition}/${query.id}/${provider}`,
            provider,
            query,
            repetition,
            reservedMicros: SEARCH_COST_MICROS[provider],
          });
        }
      });
    }
  }
  return plan;
}

export type EvaluationOutcome = "success" | "timeout" | "cancelled" | "provider_error";
export type Reservation = {
  kind: "reserve";
  callId: string;
  invocationId: string;
  at: string;
  provider: LedgerProvider;
  queryId: string;
  split: "development" | "holdout" | "interactive";
  repetition: number;
  amountMicros: number;
};
export type Settlement = {
  kind: "settle";
  callId: string;
  invocationId: string;
  at: string;
  amountMicros: number;
  status: EvaluationOutcome;
  elapsedMs: number;
  resultCount: number;
  normalizedPayloadBytes?: number;
  evidenceCharacters?: number;
  httpStatus?: number;
  reportedCostMicros?: number;
  providerRequestId?: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  reasoningTokens?: number;
  callCount?: number;
  providerRequestIds?: string[];
  usageComplete?: boolean;
};
export type MeteringProgress = {
  callCount: number;
  providerRequestIds: string[];
  usage: { inputTokens: number; outputTokens: number; totalTokens: number; reasoningTokens?: number };
  usageComplete: boolean;
};
export type LedgerEntry = Reservation | Settlement;

export function ledgerState(entries: readonly LedgerEntry[]) {
  const reservations = new Map<string, Reservation>();
  const settlements = new Map<string, Settlement>();
  for (const entry of entries) {
    if (!entry || typeof entry !== "object" || typeof entry.callId !== "string" ||
        !Number.isSafeInteger(entry.amountMicros) || entry.amountMicros < 0) {
      throw new Error("Invalid evaluation ledger; refusing paid work.");
    }
    if (entry.kind === "reserve") {
      if (reservations.has(entry.callId) || !["exa", "brave", "ai-gateway", "hosted-budget"].includes(entry.provider)) {
        throw new Error("Invalid or duplicate evaluation reservation; refusing paid work.");
      }
      reservations.set(entry.callId, entry);
    } else if (entry.kind === "settle") {
      if (!reservations.has(entry.callId) || settlements.has(entry.callId) ||
          !["success", "timeout", "cancelled", "provider_error"].includes(entry.status) ||
          !Number.isFinite(entry.elapsedMs) || entry.elapsedMs < 0 ||
          !Number.isSafeInteger(entry.resultCount) || entry.resultCount < 0 ||
          (entry.callCount !== undefined && (!Number.isInteger(entry.callCount) || entry.callCount < 0 || entry.callCount > 2)) ||
          (entry.usageComplete !== undefined && typeof entry.usageComplete !== "boolean") ||
          (entry.providerRequestIds !== undefined && (!Array.isArray(entry.providerRequestIds) ||
            entry.providerRequestIds.length > (entry.callCount ?? 2) || new Set(entry.providerRequestIds).size !== entry.providerRequestIds.length ||
            entry.providerRequestIds.some(id => typeof id !== "string" || !/^[a-zA-Z0-9_:-]{1,160}$/.test(id))))) {
        throw new Error("Invalid evaluation settlement; refusing paid work.");
      }
      settlements.set(entry.callId, entry);
    } else {
      throw new Error("Unknown evaluation ledger entry; refusing paid work.");
    }
  }
  let committedMicros = 0;
  for (const [id, reservation] of reservations) {
    // Never assume a timeout, local failure, or lower reported charge is a refund.
    committedMicros += Math.max(reservation.amountMicros, settlements.get(id)?.amountMicros ?? 0);
  }
  if (!Number.isSafeInteger(committedMicros)) throw new Error("Evaluation ledger cost overflow.");
  return { reservations, settlements, committedMicros };
}

export function assertReservationFits(entries: readonly LedgerEntry[], amountMicros: number) {
  if (!Number.isSafeInteger(amountMicros) || amountMicros <= 0) {
    throw new Error("A positive integer cost reservation is required.");
  }
  const { committedMicros } = ledgerState(entries);
  if (committedMicros + amountMicros > EVALUATION_BUDGET_MICROS) {
    throw new Error("The next request would exceed the shared $5 evaluation budget.");
  }
}

export function percentile(values: readonly number[], fraction: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
}

export function summarizeEvaluation(entries: readonly LedgerEntry[], campaign?: string) {
  const state = ledgerState(entries);
  const byProvider = Object.fromEntries((["exa", "brave"] as const).map((provider) => {
    const reservations = [...state.reservations.values()].filter((entry) =>
      entry.provider === provider && (!campaign || entry.callId.startsWith(`${campaign}/`)),
    );
    const completed = reservations.map((entry) => state.settlements.get(entry.callId))
      .filter((entry): entry is Settlement => entry !== undefined);
    const successes = completed.filter((entry) => entry.status === "success");
    const costs = reservations.reduce((sum, entry) => sum + Math.max(
      entry.amountMicros, state.settlements.get(entry.callId)?.amountMicros ?? 0,
    ), 0);
    return [provider, {
      attempts: reservations.length,
      validResponses: successes.length,
      emptyResponses: successes.filter((entry) => entry.resultCount === 0).length,
      timeouts: completed.filter((entry) => entry.status === "timeout").length,
      errors: completed.filter((entry) => entry.status === "provider_error").length,
      cancelled: completed.filter((entry) => entry.status === "cancelled").length,
      unsettled: reservations.length - completed.length,
      validResponseMedianMs: percentile(successes.map((entry) => entry.elapsedMs), 0.5),
      validResponseP95Ms: percentile(successes.map((entry) => entry.elapsedMs), 0.95),
      reservedGrossUsd: costs / 1_000_000,
      reservedCostPerValidResponseUsd: successes.length ? costs / 1_000_000 / successes.length : null,
    }];
  }));
  return {
    budgetUsd: EVALUATION_BUDGET_MICROS / 1_000_000,
    totalCommittedUsd: state.committedMicros / 1_000_000,
    remainingBudgetUsd: Math.max(0, EVALUATION_BUDGET_MICROS - state.committedMicros) / 1_000_000,
    byProvider,
    notes: [
      "Gross committed cost is conservative, before credits; it is not a reconciled invoice.",
      "Latency percentiles cover valid responses only. Timeouts are right-censored at the deadline.",
      "Search relevance, answer quality, and provider selection require separate review; no quality grades are inferred here.",
    ],
  };
}

export async function readLedger(file: string): Promise<LedgerEntry[]> {
  let contents: string;
  try { contents = await readFile(file, "utf8"); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw new Error("Cannot read evaluation accounting; refusing paid work.");
  }
  if (contents && !contents.endsWith("\n")) throw new Error("Incomplete evaluation ledger; refusing paid work.");
  let entries: LedgerEntry[];
  try { entries = contents.split("\n").filter(Boolean).map((line) => JSON.parse(line)); }
  catch { throw new Error("Invalid evaluation ledger JSON; refusing paid work."); }
  ledgerState(entries);
  return entries;
}

export async function appendLedger(file: string, entry: LedgerEntry) {
  const handle = await open(file, "a", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(entry)}\n`);
    await handle.sync();
  } finally { await handle.close(); }
}

export async function withEvaluationLock<T>(directory: string, action: () => Promise<T>): Promise<T> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const lockPath = join(directory, "run.lock");
  let handle;
  try { handle = await open(lockPath, "wx", 0o600); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error("Evaluation lock exists. Inspect the recorded process before removing a stale lock; do not run concurrently.");
    }
    throw error;
  }
  try {
    await handle.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
    await handle.sync();
    return await action();
  } finally {
    await handle.close();
    await unlink(lockPath);
  }
}

export async function reserveSearch(
  ledgerFile: string, entries: LedgerEntry[], planned: PlannedSearch, invocationId: string,
): Promise<boolean> {
  if (ledgerState(entries).reservations.has(planned.callId)) return false;
  assertReservationFits(entries, planned.reservedMicros);
  const reservation: Reservation = {
    kind: "reserve", callId: planned.callId, invocationId, at: new Date().toISOString(),
    provider: planned.provider, queryId: planned.query.id, split: planned.query.split,
    repetition: planned.repetition, amountMicros: planned.reservedMicros,
  };
  await appendLedger(ledgerFile, reservation);
  entries.push(reservation);
  return true;
}

/** Local-only ledger, shared by the evaluator and development route. Not a distributed quota store. */
export async function withEvaluationBudget<T>(
  options: { directory: string; callId: string; provider: EvaluationProvider },
  work: () => Promise<T>,
): Promise<T> {
  return withMeteredEvaluation({ ...options, reservedMicros: SEARCH_COST_MICROS[options.provider] }, work);
}

/** Reserve before dispatch; failed or interrupted model calls still consume their allowance. */
export async function withMeteredEvaluation<T>(
  options: { directory: string; callId: string; provider: LedgerProvider; reservedMicros: number },
  work: (report: (progress: MeteringProgress) => void) => Promise<T>,
): Promise<T> {
  return withEvaluationLock(options.directory, async () => {
    const file = join(options.directory, "ledger.jsonl");
    const entries = await readLedger(file);
    if (ledgerState(entries).reservations.has(options.callId)) {
      throw new Error("This operation already has a cost reservation; refusing duplicate dispatch.");
    }
    const reservedMicros = options.reservedMicros;
    assertReservationFits(entries, reservedMicros);
    const reservation: Reservation = {
      kind: "reserve", callId: options.callId, invocationId: options.callId,
      at: new Date().toISOString(), provider: options.provider, queryId: "interactive",
      split: "interactive", repetition: 1, amountMicros: reservedMicros,
    };
    await appendLedger(file, reservation);
    const started = performance.now();
    const settlement: Settlement = {
      kind: "settle", callId: options.callId, invocationId: options.callId,
      at: reservation.at, amountMicros: reservedMicros, status: "provider_error",
      elapsedMs: 0, resultCount: 0,
    };
    const report = (progress: MeteringProgress) => {
      const usage = progress.usage;
      if (!Number.isInteger(progress.callCount) || progress.callCount < (settlement.callCount ?? 0) || progress.callCount > 2 ||
          typeof progress.usageComplete !== "boolean" || !Array.isArray(progress.providerRequestIds) ||
          progress.providerRequestIds.length > progress.callCount || new Set(progress.providerRequestIds).size !== progress.providerRequestIds.length ||
          progress.providerRequestIds.some(id => typeof id !== "string" || !/^[a-zA-Z0-9_:-]{1,160}$/.test(id)) ||
          (settlement.providerRequestIds ?? []).some(id => !progress.providerRequestIds.includes(id)) ||
          !usage || [usage.inputTokens, usage.outputTokens, usage.totalTokens].some(value => !Number.isSafeInteger(value) || value < 0) ||
          usage.inputTokens < (settlement.inputTokens ?? 0) || usage.outputTokens < (settlement.outputTokens ?? 0) ||
          usage.totalTokens < (settlement.totalTokens ?? 0) ||
          (usage.reasoningTokens !== undefined && (!Number.isSafeInteger(usage.reasoningTokens) || usage.reasoningTokens < 0 || usage.reasoningTokens > usage.outputTokens))) {
        throw new Error("Invalid operation metering; refusing further dispatch.");
      }
      settlement.callCount = progress.callCount;
      settlement.providerRequestIds = [...progress.providerRequestIds];
      settlement.usageComplete = progress.usageComplete;
      settlement.inputTokens = usage.inputTokens;
      settlement.outputTokens = usage.outputTokens;
      settlement.totalTokens = usage.totalTokens;
      if (usage.reasoningTokens !== undefined) settlement.reasoningTokens = usage.reasoningTokens;
      else delete settlement.reasoningTokens;
    };
    try {
      const result = await work(report);
      settlement.status = "success";
      if (result && typeof result === "object" && "results" in result && Array.isArray(result.results)) {
        settlement.resultCount = result.results.length;
      }
      if (result && typeof result === "object" && "claims" in result && Array.isArray(result.claims)) {
        settlement.resultCount = result.claims.length;
      }
      if (result && typeof result === "object" && "usage" in result && result.usage && typeof result.usage === "object") {
        const usage = result.usage as { inputTokens?: unknown; outputTokens?: unknown };
        if (typeof usage.inputTokens === "number" && Number.isSafeInteger(usage.inputTokens) && usage.inputTokens >= 0) settlement.inputTokens = Math.max(settlement.inputTokens ?? 0, usage.inputTokens);
        if (typeof usage.outputTokens === "number" && Number.isSafeInteger(usage.outputTokens) && usage.outputTokens >= 0) settlement.outputTokens = Math.max(settlement.outputTokens ?? 0, usage.outputTokens);
      }
      if (result && typeof result === "object" && "requestId" in result &&
          typeof result.requestId === "string" && /^[a-zA-Z0-9_:-]{1,160}$/.test(result.requestId)) {
        settlement.providerRequestId = result.requestId;
      }
      if (result && typeof result === "object" && "reportedCostUsd" in result &&
          typeof result.reportedCostUsd === "number" && Number.isFinite(result.reportedCostUsd) && result.reportedCostUsd >= 0) {
        settlement.reportedCostMicros = Math.ceil(result.reportedCostUsd * 1_000_000);
        settlement.amountMicros = Math.max(reservedMicros, settlement.reportedCostMicros);
      }
      return result;
    } catch (error) {
      if (error instanceof Error && error.name === "TimeoutError") settlement.status = "timeout";
      else if (error instanceof Error && error.name === "AbortError") settlement.status = "cancelled";
      if (error && typeof error === "object" && "status" in error &&
          typeof error.status === "number" && Number.isInteger(error.status) && error.status >= 400 && error.status <= 599) {
        settlement.httpStatus = error.status;
      }
      throw error;
    } finally {
      settlement.at = new Date().toISOString();
      settlement.elapsedMs = performance.now() - started;
      await appendLedger(file, settlement);
    }
  });
}
