import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  assertReservationFits, buildEvaluationPlan, EVALUATION_BUDGET_MICROS,
  ledgerState, summarizeEvaluation, type EvaluationQuery, type LedgerEntry, type Reservation,
  appendLedger, readLedger, reserveSearch, withEvaluationLock, withEvaluationBudget, withMeteredEvaluation,
} from "../lib/evaluation.ts";
import { parseOptions } from "../scripts/evaluate-search.ts";

const query: EvaluationQuery = {
  id: "NAV01", category: "navigation", split: "development", query: "example docs",
  country: "US", language: "en", freshness: "any", answerSample: false,
};
const reservation: Reservation = {
  kind: "reserve", callId: "baseline/development/1/NAV01/exa", invocationId: "test",
  at: "2026-11-14T00:00:00Z", provider: "exa", queryId: "NAV01", split: "development",
  repetition: 1, amountMicros: 7_000,
};

test("the real corpus produces 312 calls and $1.872 of reserved search usage", async () => {
  const corpus = JSON.parse(await readFile(new URL("../docs/milestone-1/evaluation-queries.json", import.meta.url), "utf8"));
  const options = { phase: "all" as const, seed: 42, campaign: "baseline" };
  const plan = buildEvaluationPlan(corpus.queries, options);
  assert.equal(plan.length, 312);
  assert.equal(new Set(plan.map((call) => call.callId)).size, 312);
  assert.equal(plan.filter((call) => call.provider === "exa").length, 156);
  assert.equal(plan.reduce((sum, call) => sum + call.reservedMicros, 0), 1_872_000);
  assert.deepEqual(plan, buildEvaluationPlan(corpus.queries, options));
  for (let index = 0; index < plan.length; index += 2) {
    assert.equal(plan[index].query.id, plan[index + 1].query.id);
    assert.notEqual(plan[index].provider, plan[index + 1].provider);
  }
});

test("two-stage accounting preserves known router usage when the writer fails", async () => {
  const directory = await mkdtemp(join(tmpdir(), "joysearch-staged-"));
  try {
    const usage = { inputTokens: 120, outputTokens: 30, totalTokens: 150, reasoningTokens: 5 };
    await assert.rejects(withMeteredEvaluation({ directory, callId: "staged/failure", provider: "ai-gateway", reservedMicros: 10_000 }, async report => {
      report({ callCount: 1, providerRequestIds: ["gen_router"], usage, usageComplete: true });
      report({ callCount: 2, providerRequestIds: ["gen_router"], usage, usageComplete: false });
      throw Object.assign(new Error("writer unavailable"), { status: 500 });
    }), /writer unavailable/);
    const state = ledgerState(await readLedger(join(directory, "ledger.jsonl")));
    const result = state.settlements.get("staged/failure")!;
    assert.equal(result.callCount, 2);
    assert.deepEqual(result.providerRequestIds, ["gen_router"]);
    assert.equal(result.inputTokens, 120);
    assert.equal(result.outputTokens, 30);
    assert.equal(result.reasoningTokens, 5);
    assert.equal(result.usageComplete, false);
    assert.equal(result.httpStatus, 500);
    assert.equal(state.committedMicros, 10_000);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("stage accounting records aggregate usage and rejects invalid or decreasing snapshots", async () => {
  const directory = await mkdtemp(join(tmpdir(), "joysearch-staged-"));
  try {
    await withMeteredEvaluation({ directory, callId: "staged/success", provider: "ai-gateway", reservedMicros: 10_000 }, async report => {
      report({ callCount: 1, providerRequestIds: ["gen_router"], usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120, reasoningTokens: 5 }, usageComplete: true });
      assert.throws(() => report({ callCount: 1, providerRequestIds: ["gen_router"], usage: { inputTokens: 99, outputTokens: 20, totalTokens: 119 }, usageComplete: true }), /Invalid operation metering/);
      assert.throws(() => report({ callCount: 0, providerRequestIds: [], usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 }, usageComplete: true }), /Invalid operation metering/);
      report({ callCount: 2, providerRequestIds: ["gen_router", "gen_writer"], usage: { inputTokens: 250, outputTokens: 60, totalTokens: 310 }, usageComplete: true });
      return { claims: [{ text: "not retained" }] };
    });
    await assert.rejects(withMeteredEvaluation({ directory, callId: "staged/invalid", provider: "ai-gateway", reservedMicros: 10_000 }, async report => {
      report({ callCount: 1, providerRequestIds: ["invalid identifier"], usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 }, usageComplete: false });
    }), /Invalid operation metering/);
    const state = ledgerState(await readLedger(join(directory, "ledger.jsonl")));
    assert.deepEqual(state.settlements.get("staged/success")?.providerRequestIds, ["gen_router", "gen_writer"]);
    assert.equal(state.settlements.get("staged/success")?.totalTokens, 310);
    assert.equal(state.settlements.get("staged/success")?.usageComplete, true);
    assert.equal(state.settlements.get("staged/success")?.reasoningTokens, undefined, "unknown writer reasoning must not retain a router-only total");
    const contents = await readFile(join(directory, "ledger.jsonl"), "utf8");
    assert.ok(!contents.includes("not retained") && !contents.includes("invalid identifier"));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("CLI defaults to no network and refuses implicit retention or invalid limits", () => {
  assert.equal(parseOptions([]).run, false);
  assert.equal(parseOptions([]).retainEvidence, false);
  assert.throws(() => parseOptions(["--retain-evidence"]), /permission-reference/);
  assert.throws(() => parseOptions(["--limit", "0"]), /invalid value/);
  assert.throws(() => parseOptions(["--campaign", "../outside"]), /invalid value/);
  assert.equal(parseOptions(["--run", "--phase", "holdout"]).phase, "holdout");
});

test("budget includes uncertain reservations and never treats errors as refunds", () => {
  const entries: LedgerEntry[] = [{ ...reservation, amountMicros: EVALUATION_BUDGET_MICROS - 7_000 }];
  assert.doesNotThrow(() => assertReservationFits(entries, 7_000));
  assert.throws(() => assertReservationFits(entries, 7_001), /exceed/);
  assert.throws(() => assertReservationFits(entries, -1), /positive integer/);
  entries.push({
    kind: "settle", callId: reservation.callId, invocationId: "test", at: reservation.at,
    amountMicros: 0, status: "timeout", elapsedMs: 3_000, resultCount: 0,
  });
  assert.equal(ledgerState(entries).committedMicros, EVALUATION_BUDGET_MICROS - 7_000);
});

test("hosted allocation removes the same allowance from local spending", () => {
  const entries: LedgerEntry[] = [
    { ...reservation, amountMicros: 3_922_000 },
    { ...reservation, callId: "allocation/joysearch-hosted-v1", provider: "hosted-budget", amountMicros: 1_000_000 },
  ];
  assert.equal(ledgerState(entries).committedMicros, 4_922_000);
  assert.doesNotThrow(() => assertReservationFits(entries, 78_000));
  assert.throws(() => assertReservationFits(entries, 78_001), /exceed/);
  assert.throws(() => ledgerState([...entries, entries[1]]), /duplicate/);
});

test("Gateway reservations share the search budget and prevent further search dispatch", async () => {
  const directory = await mkdtemp(join(tmpdir(), "joysearch-evaluation-"));
  try {
    const file = join(directory, "ledger.jsonl");
    await appendLedger(file, { ...reservation, amountMicros: EVALUATION_BUDGET_MICROS - 1_000 });
    const entries = await readLedger(file);
    assert.doesNotThrow(() => assertReservationFits(entries, 1_000));
    await appendLedger(file, {
      ...reservation, callId: "gateway/smoke", provider: "ai-gateway", split: "interactive",
      queryId: "smoke", amountMicros: 1_000,
    });
    const reopened = await readLedger(file);
    assert.equal(ledgerState(reopened).committedMicros, EVALUATION_BUDGET_MICROS);
    assert.throws(() => assertReservationFits(reopened, 1), /exceed/);
    let dispatched = false;
    await assert.rejects(withEvaluationBudget({ directory, callId: "interactive/after-gateway", provider: "brave" }, async () => {
      dispatched = true;
    }), /exceed/);
    assert.equal(dispatched, false);
    const summary = summarizeEvaluation(reopened);
    assert.equal(summary.totalCommittedUsd, 5);
    assert.equal(summary.remainingBudgetUsd, 0);
    assert.equal(summary.byProvider.exa.attempts, 1);
    assert.equal(summary.byProvider.brave.attempts, 0);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("Gateway settlements cannot reduce reservations and account for higher actual cost", () => {
  const modelReservation: Reservation = {
    ...reservation, callId: "gateway/smoke", provider: "ai-gateway", amountMicros: 1_000,
  };
  const settlement: LedgerEntry = {
    kind: "settle", callId: modelReservation.callId, invocationId: "test", at: reservation.at,
    amountMicros: 10, reportedCostMicros: 10, status: "success", elapsedMs: 200, resultCount: 1,
  };
  assert.equal(ledgerState([reservation, modelReservation, settlement]).committedMicros, 8_000);
  assert.equal(ledgerState([
    reservation, modelReservation, { ...settlement, amountMicros: 2_000, reportedCostMicros: 2_000 },
  ]).committedMicros, 9_000);
});

test("durable reservations make interrupted and repeated calls idempotent", async () => {
  const directory = await mkdtemp(join(tmpdir(), "joysearch-evaluation-"));
  try {
    const file = join(directory, "ledger.jsonl");
    const planned = buildEvaluationPlan([query], { phase: "development", seed: 42, campaign: "baseline" })
      .find((call) => call.provider === "exa")!;
    const entries: LedgerEntry[] = [];
    assert.equal(await reserveSearch(file, entries, planned, "first"), true);
    assert.equal(await reserveSearch(file, entries, planned, "second"), false);
    const reopened = await readLedger(file);
    assert.equal(await reserveSearch(file, reopened, planned, "after-crash"), false);
    assert.equal(ledgerState(reopened).committedMicros, 7_000);
    assert.equal(reopened.length, 1);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("reported costs above the reservation reduce the remaining allowance", () => {
  const entries: LedgerEntry[] = [reservation, {
    kind: "settle", callId: reservation.callId, invocationId: "test", at: reservation.at,
    amountMicros: 8_000, reportedCostMicros: 8_000,
    status: "success", elapsedMs: 1_200, resultCount: 10,
  }];
  assert.equal(ledgerState(entries).committedMicros, 8_000);
  assert.throws(() => assertReservationFits(entries, EVALUATION_BUDGET_MICROS - 7_000), /exceed/);
});

test("corrupt or truncated accounting fails closed", async () => {
  const directory = await mkdtemp(join(tmpdir(), "joysearch-evaluation-"));
  try {
    const file = join(directory, "ledger.jsonl");
    await writeFile(file, JSON.stringify(reservation));
    await assert.rejects(readLedger(file), /Incomplete/);
    await writeFile(file, "not JSON\n");
    await assert.rejects(readLedger(file), /Invalid/);
    await writeFile(file, "");
    await appendLedger(file, reservation);
    await appendLedger(file, reservation);
    await assert.rejects(readLedger(file), /duplicate/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("project lock rejects concurrent work and releases after failure", async () => {
  const directory = await mkdtemp(join(tmpdir(), "joysearch-evaluation-"));
  try {
    await assert.rejects(withEvaluationLock(directory, async () => {
      await assert.rejects(withEvaluationLock(directory, async () => undefined), /lock exists/);
      throw new Error("synthetic failure");
    }), /synthetic failure/);
    assert.equal(await withEvaluationLock(directory, async () => "released"), "released");
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("summary separates valid-response latency from censored failures", () => {
  const other = { ...reservation, callId: "baseline/development/1/NAV02/exa", queryId: "NAV02" };
  const entries: LedgerEntry[] = [reservation, {
    kind: "settle", callId: reservation.callId, invocationId: "test", at: reservation.at,
    amountMicros: 7_000, status: "success", elapsedMs: 750, resultCount: 10,
  }, other, {
    kind: "settle", callId: other.callId, invocationId: "test", at: reservation.at,
    amountMicros: 7_000, status: "timeout", elapsedMs: 3_000, resultCount: 0,
  }];
  const summary = summarizeEvaluation(entries, "baseline");
  assert.equal(summary.byProvider.exa.attempts, 2);
  assert.equal(summary.byProvider.exa.validResponses, 1);
  assert.equal(summary.byProvider.exa.timeouts, 1);
  assert.equal(summary.byProvider.exa.validResponseP95Ms, 750);
  assert.equal(summary.byProvider.exa.reservedCostPerValidResponseUsd, 0.014);
});

test("interactive requests share CLI accounting and cannot dispatch above the cap", async () => {
  const directory = await mkdtemp(join(tmpdir(), "joysearch-evaluation-"));
  try {
    const file = join(directory, "ledger.jsonl");
    await appendLedger(file, { ...reservation, amountMicros: EVALUATION_BUDGET_MICROS - 7_000 });
    let calls = 0;
    await assert.rejects(withEvaluationBudget({ directory, callId: "interactive/first", provider: "exa" }, async () => {
      calls += 1;
      throw new Error("network outcome uncertain");
    }), /network outcome uncertain/);
    assert.equal(calls, 1);
    assert.equal(ledgerState(await readLedger(file)).committedMicros, EVALUATION_BUDGET_MICROS);
    await assert.rejects(withEvaluationBudget({ directory, callId: "interactive/second", provider: "brave" }, async () => {
      calls += 1;
    }), /exceed/);
    assert.equal(calls, 1);
    await assert.rejects(withEvaluationBudget({ directory, callId: "interactive/first", provider: "exa" }, async () => {
      calls += 1;
    }), /duplicate dispatch/);
    assert.equal(calls, 1);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("interactive accounting records counts and provider IDs without retaining results", async () => {
  const directory = await mkdtemp(join(tmpdir(), "joysearch-evaluation-"));
  try {
    await withEvaluationBudget({ directory, callId: "interactive/result", provider: "exa" }, async () => ({
      results: [{ title: "private evidence text", url: "https://example.test/" }],
      requestId: "request_123", reportedCostUsd: 0.008,
    }));
    await assert.rejects(withEvaluationBudget({ directory, callId: "interactive/timeout", provider: "brave" }, async () => {
      throw new DOMException("timed out", "TimeoutError");
    }), /timed out/);
    const contents = await readFile(join(directory, "ledger.jsonl"), "utf8");
    assert.ok(!contents.includes("private evidence text"));
    assert.ok(!contents.includes("example.test"));
    const state = ledgerState(await readLedger(join(directory, "ledger.jsonl")));
    assert.equal(state.settlements.get("interactive/result")?.resultCount, 1);
    assert.equal(state.settlements.get("interactive/result")?.providerRequestId, "request_123");
    assert.equal(state.settlements.get("interactive/result")?.amountMicros, 8_000);
    assert.equal(state.settlements.get("interactive/timeout")?.status, "timeout");
  } finally { await rm(directory, { recursive: true, force: true }); }
});
