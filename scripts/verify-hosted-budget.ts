import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { neon } from "@neondatabase/serverless";
import { validateBudgetDatabaseUrl } from "../lib/hosted-budget.ts";
import { migrationStatements } from "./sql-statements.ts";

function adminUrl(): string {
  const value = process.env.DATABASE_URL;
  if (!value) throw new Error("Missing administrative database configuration");
  const url = new URL(value);
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname.endsWith(".neon.tech")
      || !url.username || url.username === "joysearch_runtime" || !url.password
      || !["require", "verify-full"].includes(url.searchParams.get("sslmode") ?? "")) throw new Error("Invalid administrative database configuration");
  return value;
}

async function main() {
  if (!process.argv.includes("--run")) {
    console.log("Dry run: use --run with DATABASE_URL (migration owner) and BUDGET_DATABASE_URL (runtime role). Only an isolated temporary schema is modified; no search or model APIs are called.");
    return;
  }
  const admin = neon(adminUrl());
  const runtime = neon(validateBudgetDatabaseUrl(process.env.BUDGET_DATABASE_URL));
  const nonce = randomBytes(10).toString("hex");
  const schema = `joysearch_budget_verify_${nonce}`;
  assert.match(schema, /^joysearch_budget_verify_[a-f0-9]{20}$/);
  const original = await readFile(new URL("./sql/hosted-budget.sql", import.meta.url), "utf8");
  const statements = migrationStatements(original.replaceAll("joysearch_budget", schema));
  assert.ok(statements.length > 10);
  // Catch accidental references to the real singleton before any SQL is sent.
  assert.ok(statements.every(statement => !/\bjoysearch_budget\b/.test(statement)));
  const timeout = () => ({ fetchOptions: { signal: AbortSignal.timeout(20_000) } });
  const operator = (sql: string, parameters: unknown[] = []) => admin.query(sql, parameters, timeout());
  const call = async (name: "reserve" | "settle" | "status", parameters: unknown[] = []) => {
    const placeholders = parameters.map((_, index) => `$${index + 1}${name === "settle" && index === 2 ? "::jsonb" : ""}`).join(", ");
    const rows = await runtime.query(`SELECT ${schema}.${name}(${placeholders}) AS result`, parameters, timeout());
    assert.equal(rows.length, 1);
    return rows[0].result as Record<string, unknown>;
  };
  const hash = (label: string) => createHash("sha256").update(`${nonce}:${label}`).digest("hex");
  const reserve = (id: string, session: string, kind = "answer") => call("reserve", [hash(id), hash(session), kind]);
  const settle = (id: string, status = "success", metrics = {}) => call("settle", [hash(id), status, JSON.stringify(metrics)]);
  const resetTestOnly = async () => {
    await admin.transaction([
      admin.query(`TRUNCATE ${schema}.operations, ${schema}.sessions`),
      admin.query(`UPDATE ${schema}.budget SET enabled = true, committed_micros = 0 WHERE id = 1`),
    ], timeout());
  };
  const checks: string[] = [];
  let check = "create isolated schema";
  let passed = false;
  try {
    await admin.transaction(statements.map(statement => admin.query(statement)), timeout());
    assert.equal((await call("status")).enabled, false);
    assert.equal((await reserve("disabled", "disabled")).code, "disabled");
    checks.push("initially disabled");

    check = "concurrent global cap";
    await operator(`UPDATE ${schema}.budget SET enabled = true, committed_micros = 980000 WHERE id = 1`);
    const parallel = await Promise.all(Array.from({ length: 6 }, (_, index) => reserve(`cap-${index}`, `cap-session-${index}`)));
    assert.equal(parallel.filter(result => result.accepted === true).length, 2);
    assert.equal(parallel.filter(result => result.code === "budget_exhausted").length, 4);
    assert.equal((await call("status")).committedMicros, 1_000_000);
    checks.push("six concurrent requests: exactly two fit remaining 20000 micros");

    check = "duplicate concurrency";
    await resetTestOnly();
    const duplicates = await Promise.all(Array.from({ length: 6 }, () => reserve("same-operation", "same-session")));
    assert.equal(duplicates.filter(result => result.accepted === true).length, 1);
    assert.equal(duplicates.filter(result => result.code === "duplicate").length, 5);
    assert.equal((await call("status")).committedMicros, 10_000);
    assert.equal((await reserve("same-operation", "different-session")).code, "operation_conflict");
    checks.push("concurrent duplicate charged once; conflicting session rejected");

    check = "session limits";
    await resetTestOnly();
    assert.equal((await reserve("session-0", "limited-session")).accepted, true);
    const limited = await reserve("too-soon", "limited-session");
    assert.equal(limited.code, "rate_limited");
    assert.ok(Number(limited.retryAfterSeconds) >= 1 && Number(limited.retryAfterSeconds) <= 10);
    for (let index = 1; index < 5; index++) {
      await operator(`UPDATE ${schema}.sessions SET next_answer_at = '-infinity' WHERE session_key = $1`, [hash("limited-session")]);
      assert.equal((await reserve(`session-${index}`, "limited-session")).accepted, true);
    }
    assert.equal((await reserve("session-sixth", "limited-session")).code, "session_exhausted");
    assert.equal((await call("status")).committedMicros, 50_000);
    checks.push("session lifetime 50000-micro cap and answer interval");

    check = "separate search interval";
    await resetTestOnly();
    assert.equal((await reserve("search-first", "search-session", "search_exa")).accepted, true);
    assert.equal((await reserve("search-second", "search-session", "search_brave")).code, "rate_limited");
    assert.equal((await reserve("answer-after-search", "search-session")).accepted, true);
    assert.equal((await call("status")).committedMicros, 17_000);
    checks.push("search providers share interval; answer after search remains available");

    check = "settlement and retained reservations";
    await resetTestOnly();
    await reserve("failed-operation", "failed-session");
    assert.equal((await settle("failed-operation", "provider_error", { callCount: 1, inputTokens: 100, outputTokens: 20, providerRequestIds: ["gen_owned"], usageComplete: false })).accepted, true);
    assert.equal((await settle("failed-operation", "success", { reportedCostMicros: 1 })).alreadySettled, true);
    assert.equal((await call("status")).committedMicros, 10_000);
    assert.equal((await reserve("failed-operation", "failed-session")).code, "duplicate");
    assert.equal((await settle("unknown-operation")).code, "unknown_operation");
    const stored = await operator(`SELECT status, metrics FROM ${schema}.operations WHERE operation_id = $1`, [hash("failed-operation")]);
    assert.equal(stored[0].status, "provider_error");
    assert.deepEqual(stored[0].metrics.providerRequestIds, ["gen_owned"]);
    checks.push("failed calls retain spend; settlement is idempotent and keeps first metadata");

    check = "runtime privileges";
    for (const sql of [
      `SELECT * FROM ${schema}.budget`, `UPDATE ${schema}.budget SET committed_micros = 0`,
      `TRUNCATE ${schema}.operations`, `CREATE TABLE ${schema}.forbidden(id integer)`,
    ]) {
      await assert.rejects(runtime.query(sql, [], timeout()), (error: unknown) =>
        error !== null && typeof error === "object" && "code" in error && error.code === "42501");
    }
    const publicPrivileges = await operator(`SELECT NOT EXISTS (
      SELECT 1 FROM pg_proc, LATERAL aclexplode(proacl) AS acl
      WHERE oid = $1::regprocedure AND acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'
    ) AS revoked`, [`${schema}.reserve(text,text,text)`]);
    assert.equal(publicPrivileges[0].revoked, true);
    checks.push("runtime table access/mutations and schema creation denied; PUBLIC cannot execute");

    check = "metadata validation";
    assert.equal((await reserve("bad-kind", "bad-kind", "refund")).code, "invalid_request");
    assert.equal((await call("reserve", ["invalid", hash("valid-session"), "answer"])).code, "invalid_request");
    await reserve("bad-metadata", "metadata-session");
    assert.equal((await settle("bad-metadata", "success", { query: "must not store content" })).code, "invalid_request");
    assert.equal((await settle("bad-metadata", "success", { callCount: 3 })).code, "invalid_request");
    assert.equal((await settle("bad-metadata", "success", { providerRequestIds: ["invalid value"] })).code, "invalid_request");
    checks.push("invalid kind, IDs, and content-bearing or malformed metadata rejected");

    check = "price anomaly";
    await resetTestOnly();
    await reserve("price-change", "price-session", "search_exa");
    await settle("price-change", "success", { reportedCostMicros: 8_000 });
    const anomaly = await call("status");
    assert.equal(anomaly.enabled, false);
    assert.equal(anomaly.committedMicros, 8_000);
    await settle("price-change", "success", { reportedCostMicros: 9_000 });
    assert.equal((await call("status")).committedMicros, 8_000);
    assert.equal((await reserve("after-anomaly", "new-session")).code, "disabled");
    checks.push("larger reported cost retained once; anomaly disables further requests");

    check = "migration rerun preservation";
    await admin.transaction(statements.map(statement => admin.query(statement)), timeout());
    const preserved = await call("status");
    assert.equal(preserved.committedMicros, 8_000);
    assert.equal(preserved.enabled, false);
    checks.push("migration rerun preserves spend and disabled state");

    check = "missing singleton fails closed";
    await operator(`DELETE FROM ${schema}.budget WHERE id = 1`);
    assert.equal((await reserve("missing-state", "missing-session")).code, "unavailable");
    assert.equal((await call("status")).available, false);
    checks.push("missing budget state does not initialize itself");
    passed = true;
  } catch (error) {
    const code = error !== null && typeof error === "object" && "code" in error && typeof error.code === "string" && /^[A-Z0-9_]{1,30}$/.test(error.code) ? error.code : "CHECK_FAILED";
    console.error(JSON.stringify({ status: "failed", check, code, completedChecks: checks }));
    process.exitCode = 1;
  } finally {
    try {
      await operator(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      if (passed) console.log(JSON.stringify({ status: "passed", checks, temporarySchemaRemoved: true, productionBudgetModified: false, paidApiCalls: 0 }, null, 2));
    } catch {
      console.error(JSON.stringify({ status: "cleanup_failed", temporarySchema: schema, productionBudgetModified: false }));
      process.exitCode = 1;
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main().catch(() => {
    console.error(JSON.stringify({ status: "failed", check: "configuration or migration parsing", details: "Sanitized; no credentials printed." }));
    process.exitCode = 1;
  });
}
