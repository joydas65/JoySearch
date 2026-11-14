import assert from "node:assert/strict";
import test from "node:test";
import { createHostedBudget, HostedBudgetError, validateBudgetDatabaseUrl, type HostedBudgetOptions } from "../lib/hosted-budget.ts";

const options: HostedBudgetOptions = { operationId: "a".repeat(64), sessionKey: "b".repeat(64), kind: "answer" };
function reserved(overrides = {}) {
  return [{ result: { accepted: true, operationId: options.operationId, reservedMicros: 10_000, capMicros: 1_000_000, committedMicros: 10_000, ...overrides } }];
}

test("hosted reservation commits before work and settlement completes before result delivery", async () => {
  const events: string[] = [];
  const withBudget = createHostedBudget(async (sql, parameters) => {
    if (sql.includes(".reserve(")) {
      events.push("reserve");
      assert.deepEqual(parameters, [options.operationId, options.sessionKey, "answer"]);
      return reserved();
    }
    events.push("settle");
    assert.equal(parameters[1], "success");
    const metrics = JSON.parse(String(parameters[2]));
    assert.equal(metrics.callCount, 2);
    assert.equal(metrics.inputTokens, 240);
    assert.equal(metrics.outputTokens, 100);
    assert.equal(metrics.usageComplete, true);
    assert.equal(metrics.resultCount, 1);
    assert.deepEqual(metrics.providerRequestIds, ["gen_intent", "gen_answer"]);
    assert.equal(metrics.reasoningTokens, undefined);
    return [{ result: { accepted: true } }];
  });
  const result = await withBudget(options, async report => {
    events.push("work");
    report({ callCount: 1, providerRequestIds: ["gen_intent"], usageComplete: true,
      usage: { inputTokens: 100, outputTokens: 30, totalTokens: 130, reasoningTokens: 8 } });
    report({ callCount: 2, providerRequestIds: ["gen_intent", "gen_answer"], usageComplete: true,
      usage: { inputTokens: 240, outputTokens: 100, totalTokens: 340 } });
    return { requestId: "gen_answer", claims: [{ text: "Owned content that must not enter accounting." }] };
  });
  events.push("delivered");
  assert.equal(result.claims.length, 1);
  assert.deepEqual(events, ["reserve", "work", "settle", "delivered"]);
});

test("denied, missing, corrupt, or uncertain reservations never dispatch work or retry", async () => {
  for (const response of [
    [{ result: { accepted: false, code: "disabled" } }],
    [{ result: { accepted: false, code: "budget_exhausted" } }],
    [{ result: { accepted: false, code: "duplicate" } }],
    [], [{ result: null }], reserved({ reservedMicros: 1 }), reserved({ capMicros: 2_000_000 }),
    reserved({ committedMicros: 1_000_001 }), reserved({ operationId: "c".repeat(64) }),
    new Error("Database details and credentials must not be returned."),
  ]) {
    let calls = 0;
    const withBudget = createHostedBudget(async () => {
      calls++;
      if (response instanceof Error) throw response;
      return response;
    });
    await assert.rejects(withBudget(options, async () => { throw new Error("must not dispatch"); }),
      (error: unknown) => error instanceof HostedBudgetError && !error.message.includes("credentials"));
    assert.equal(calls, 1);
  }
});

test("failed writer settles known router usage without refund or exposing content", async () => {
  const failure = new Error("Owned provider failure");
  let settlement: unknown[] = [];
  const withBudget = createHostedBudget(async (sql, values) => {
    if (sql.includes(".reserve(")) return reserved();
    settlement = values;
    return [{ result: { accepted: true } }];
  });
  await assert.rejects(withBudget(options, async report => {
    report({ callCount: 1, providerRequestIds: ["gen_router"], usageComplete: true,
      usage: { inputTokens: 100, outputTokens: 30, totalTokens: 130 } });
    report({ callCount: 2, providerRequestIds: ["gen_router"], usageComplete: false,
      usage: { inputTokens: 100, outputTokens: 30, totalTokens: 130 } });
    throw failure;
  }), error => error === failure);
  assert.equal(settlement[1], "provider_error");
  const metrics = JSON.parse(String(settlement[2]));
  assert.equal(metrics.callCount, 2);
  assert.equal(metrics.inputTokens, 100);
  assert.equal(metrics.usageComplete, false);
  assert.deepEqual(metrics.providerRequestIds, ["gen_router"]);
  assert.ok(!JSON.stringify(settlement).includes(failure.message));
  assert.equal(metrics.refund, undefined);
});

test("metering cannot move backwards or replace known generation IDs", async () => {
  for (const bad of [
    { callCount: 0, providerRequestIds: [], usageComplete: false, usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } },
    { callCount: 1, providerRequestIds: ["different"], usageComplete: true, usage: { inputTokens: 100, outputTokens: 30, totalTokens: 130 } },
    { callCount: 3, providerRequestIds: [], usageComplete: false, usage: { inputTokens: 100, outputTokens: 30, totalTokens: 130 } },
  ]) {
    let settled: Record<string, unknown> = {};
    const withBudget = createHostedBudget(async (sql, values) => {
      if (sql.includes(".reserve(")) return reserved();
      settled = JSON.parse(String(values[2]));
      return [{ result: { accepted: true } }];
    });
    await assert.rejects(withBudget(options, async report => {
      report({ callCount: 1, providerRequestIds: ["gen_known"], usageComplete: true,
        usage: { inputTokens: 100, outputTokens: 30, totalTokens: 130 } });
      report(bad);
    }), HostedBudgetError);
    assert.equal(settled.inputTokens, 100);
    assert.deepEqual(settled.providerRequestIds, ["gen_known"]);
  }
});

test("settlement failure prevents successful completion and retains the existing reservation", async () => {
  let calls = 0;
  const withBudget = createHostedBudget(async sql => {
    calls++;
    if (sql.includes(".reserve(")) return reserved();
    throw new Error("Secret connection detail");
  });
  await assert.rejects(withBudget(options, async () => "ready"),
    (error: unknown) => error instanceof HostedBudgetError && !error.message.includes("Secret"));
  assert.equal(calls, 2, "No retry, refund, or compensating SQL is allowed.");
});

test("search settlement preserves provider cost for database-side anomaly detection", async () => {
  const search = { ...options, kind: "search_exa" as const };
  const withBudget = createHostedBudget(async (sql, values) => {
    if (sql.includes(".reserve(")) return reserved({ reservedMicros: 7_000, committedMicros: 7_000 });
    const metrics = JSON.parse(String(values[2]));
    assert.equal(metrics.reportedCostMicros, 8_000);
    assert.deepEqual(metrics.providerRequestIds, ["search_123"]);
    assert.equal(metrics.resultCount, 1);
    assert.ok(!String(values[2]).includes("private query"));
    return [{ result: { accepted: true } }];
  });
  await withBudget(search, async () => ({ results: [{ title: "private query" }], requestId: "search_123", reportedCostUsd: 0.008 }));
});

test("invalid operation identifiers are rejected before database access", async () => {
  const withBudget = createHostedBudget(async () => { throw new Error("must not call database"); });
  for (const invalid of [{ ...options, operationId: "bad" }, { ...options, sessionKey: "x".repeat(64) }, { ...options, kind: "refund" as "answer" }]) {
    await assert.rejects(withBudget(invalid, async () => true), HostedBudgetError);
  }
});

test("database configuration requires Neon, TLS, credentials, and a named database", () => {
  for (const value of [undefined, "", "postgres://joysearch_runtime:password@localhost/db?sslmode=require", "postgres://joysearch_runtime:password@db.neon.tech.evil.test/db?sslmode=require", "postgres://joysearch_runtime:password@db.neon.tech/db", "postgres://joysearch_runtime:password@db.neon.tech/db?sslmode=disable", "postgres://joysearch_runtime@db.neon.tech/db?sslmode=require", "postgres://joysearch_runtime:password@db.neon.tech/?sslmode=require", "postgres://neondb_owner:password@db.neon.tech/db?sslmode=require"]) {
    assert.throws(() => validateBudgetDatabaseUrl(value), HostedBudgetError);
  }
  const valid = "postgresql://joysearch_runtime:owned-test-password@ep-owned.neon.tech/neondb?sslmode=require";
  assert.equal(validateBudgetDatabaseUrl(valid), valid);
});
