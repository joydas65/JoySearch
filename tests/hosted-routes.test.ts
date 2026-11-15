import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { test } from "node:test";
import { POST as search } from "../app/api/search/route.ts";
import { POST as answer } from "../app/api/answer/route.ts";
import { createAnswerContext, verifyAnswerContext } from "../lib/answer/context.ts";
import { getOrCreateHostedSession, hostedSessionBudgetKey, readHostedSession } from "../lib/hosted-request.ts";
import type { AnswerEvent, AnswerSource } from "../lib/answer/types.ts";

const secret = "d".repeat(64);
const origin = "https://joysearch.example.com";
const database = "postgresql://joysearch_runtime:owned-test-password@ep-owned.us-east-1.aws.neon.tech/neondb?sslmode=require";
const source: AnswerSource = { id: "S1", title: "Owned setup guide", url: "https://example.com/owned-guide", excerpt: "The setup guide explains the Cedar configuration." };
const environment = {
  NODE_ENV: "production", VERCEL: "1", VERCEL_ENV: "production", JOYSEARCH_LIVE_ENABLED: "true",
  JOYSEARCH_ORIGIN: origin, BUDGET_DATABASE_URL: database, ANSWER_CONTEXT_SECRET: secret,
  EXA_API_KEY: "owned-search-test-key", AI_GATEWAY_API_KEY: "owned-gateway-test-key", SEARCH_PROVIDER: "exa",
};

async function isolated(fetchStub: typeof fetch, work: () => Promise<void>, overrides: Record<string, string | undefined> = {}) {
  const keys = [...new Set([...Object.keys(environment), ...Object.keys(overrides)])];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  const previousFetch = globalThis.fetch;
  try {
    Object.assign(process.env, environment);
    for (const [key, value] of Object.entries(overrides)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    globalThis.fetch = fetchStub;
    await work();
  } finally {
    globalThis.fetch = previousFetch;
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function request(path: "search" | "answer", body: unknown, cookie?: string, headers: Record<string, string> = {}) {
  return new Request(`${origin}/api/${path}`, {
    method: "POST", headers: { "Content-Type": "application/json", host: "joysearch.example.com", origin,
      "sec-fetch-site": "same-origin", ...(cookie ? { cookie } : {}), ...headers },
    body: JSON.stringify(body),
  });
}

function answerFixture() {
  const session = getOrCreateHostedSession(null, secret);
  return { session: session.id, cookie: session.setCookie!.split(";")[0],
    token: createAnswerContext("Where is the Cedar setup guide?", [source], session.id, secret) };
}

function sqlResponse(result: unknown): Response {
  return Response.json({ fields: [{ name: "result", dataTypeID: 3802 }], rows: [[JSON.stringify(result)]], rowCount: 1 });
}

type SqlCall = { query: string; params: string[] };

function fakeServices(options: { reserve?: (call: SqlCall) => Response; settle?: (call: SqlCall) => Response; searchFailure?: boolean; emptyEvidence?: boolean } = {}) {
  const reservations = new Map<string, number>();
  const sql: SqlCall[] = [];
  const settlements: SqlCall[] = [];
  let searchCalls = 0;
  let modelCalls = 0;
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.hostname.endsWith(".neon.tech")) {
      assert.equal(url.pathname, "/sql");
      assert.equal(init?.method, "POST");
      const call = JSON.parse(String(init?.body)) as SqlCall;
      sql.push(call);
      if (call.query.includes("joysearch_budget.reserve")) {
        if (options.reserve) return options.reserve(call);
        const [id, session, kind] = call.params;
        assert.match(id, /^[a-f0-9]{64}$/);
        assert.match(session, /^[a-f0-9]{64}$/);
        if (reservations.has(id)) return sqlResponse({ accepted: false, code: "duplicate" });
        const amount = kind === "answer" ? 10_000 : kind === "search_exa" ? 7_000 : 5_000;
        reservations.set(id, amount);
        return sqlResponse({ accepted: true, operationId: id, reservedMicros: amount, capMicros: 1_000_000,
          committedMicros: [...reservations.values()].reduce((sum, value) => sum + value, 0) });
      }
      assert.match(call.query, /joysearch_budget\.settle/);
      settlements.push(call);
      return options.settle ? options.settle(call) : sqlResponse({ accepted: true });
    }
    if (url.hostname === "api.exa.ai") {
      assert.equal(url.pathname, "/search");
      assert.ok(reservations.size, "Search must not dispatch before a successful reservation.");
      searchCalls += 1;
      if (options.searchFailure) return new Response("private provider details", { status: 500 });
      return Response.json({ requestId: "owned_exa_request", results: [{ title: source.title, url: source.url,
        highlights: options.emptyEvidence ? [] : [source.excerpt] }] });
    }
    assert.equal(url.hostname, "ai-gateway.vercel.sh", "Unexpected network destination in network-free route test.");
    assert.ok(url.pathname.endsWith("/language-model"));
    assert.ok([...reservations.values()].includes(10_000), "Generation must not dispatch before an answer reservation.");
    modelCalls += 1;
    const body = JSON.parse(String(init?.body));
    assert.equal(body.responseFormat.type, "json");
    return Response.json({
      content: [{ type: "text", text: JSON.stringify({ entityResolved: true, measureResolved: true,
        wantsDestination: true, hasAnswerEvidence: true, message: "", destinationIds: ["S1"] }) }],
      finishReason: { unified: "stop" }, usage: { inputTokens: { total: 80, noCache: 80 }, outputTokens: { total: 50, text: 50, reasoning: 0 } },
      warnings: [], providerMetadata: { gateway: { generationId: "gen_hosted_route" } },
    });
  };
  return { fetcher, reservations, sql, settlements, get searchCalls() { return searchCalls; }, get modelCalls() { return modelCalls; } };
}

async function events(response: Response): Promise<AnswerEvent[]> {
  const text = await response.text();
  return text.trim().split("\n").filter(Boolean).map(line => JSON.parse(line) as AnswerEvent);
}

test("hosted search and answer reject previews, disabled mode, and foreign origins before any outbound call", async () => {
  const fixture = answerFixture();
  let calls = 0;
  const fetcher: typeof fetch = async () => { calls += 1; throw new Error("No network allowed."); };
  for (const overrides of [{ VERCEL_ENV: "preview" }, { JOYSEARCH_LIVE_ENABLED: "false" }]) {
    await isolated(fetcher, async () => {
      assert.equal((await search(request("search", { query: "guide", operationId: randomUUID() }))).status, 503);
      assert.equal((await answer(request("answer", { contextToken: fixture.token }, fixture.cookie))).status, 503);
    }, overrides);
  }
  await isolated(fetcher, async () => {
    assert.equal((await search(request("search", { query: "guide", operationId: randomUUID() }, undefined, { origin: "https://evil.example" }))).status, 403);
    assert.equal((await answer(request("answer", { contextToken: fixture.token }, fixture.cookie, { host: "evil.example" }))).status, 403);
  });
  assert.equal(calls, 0);
});

test("hosted search reserves first, returns a signed quota session, and binds exact evidence to that session", async () => {
  const services = fakeServices();
  const operationId = randomUUID();
  await isolated(services.fetcher, async () => {
    const response = await search(request("search", { query: "Where is the Cedar setup guide?", operationId }));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    const cookie = response.headers.get("Set-Cookie")!;
    assert.ok(cookie.includes("HttpOnly") && cookie.includes("Secure") && cookie.includes("SameSite=Strict"));
    const session = readHostedSession(cookie.split(";")[0], secret)!;
    assert.ok(session);
    const payload = await response.json();
    const context = verifyAnswerContext(payload.answerContext, session, secret);
    assert.deepEqual(context.sources, [source]);
    assert.equal(context.query, "Where is the Cedar setup guide?");
    assert.deepEqual(services.sql[0].params, [createHash("sha256").update(`search:${session}:${operationId}`).digest("hex"), hostedSessionBudgetKey(session, secret), "search_exa"]);
    assert.equal(services.searchCalls, 1);
    assert.equal(services.modelCalls, 0);
    assert.equal(services.settlements[0].params[1], "success");
    assert.equal(JSON.stringify(services.sql).includes(source.excerpt), false);
    assert.equal(JSON.stringify(services.sql).includes(session), false);
  });
});

test("search keeps its signed quota cookie even when optional answer evidence is absent", async () => {
  const services = fakeServices({ emptyEvidence: true });
  await isolated(services.fetcher, async () => {
    const response = await search(request("search", { query: "Cedar", operationId: randomUUID() }));
    assert.equal(response.status, 200);
    assert.ok(readHostedSession(response.headers.get("Set-Cookie")!.split(";")[0], secret));
    assert.equal((await response.json()).answerContext, undefined);
    assert.equal(services.searchCalls, 1);
  });
});

test("a failed first search retains its reservation and signed quota cookie without exposing provider details", async () => {
  const services = fakeServices({ searchFailure: true });
  await isolated(services.fetcher, async () => {
    const response = await search(request("search", { query: "Cedar", operationId: randomUUID() }));
    assert.equal(response.status, 502);
    assert.ok(readHostedSession(response.headers.get("Set-Cookie")!.split(";")[0], secret));
    assert.equal((await response.text()).includes("private provider details"), false);
    assert.deepEqual([...services.reservations.values()], [7_000]);
    assert.equal(services.settlements.length, 1);
    assert.equal(services.settlements[0].params[1], "provider_error");
    assert.equal(services.searchCalls, 1);
  });
});

test("replaying a search operation within a signed session cannot dispatch the provider twice", async () => {
  const services = fakeServices();
  const session = getOrCreateHostedSession(null, secret);
  const cookie = session.setCookie!.split(";")[0];
  const body = { query: "Cedar", operationId: randomUUID() };
  await isolated(services.fetcher, async () => {
    const first = await search(request("search", body, cookie));
    assert.equal(first.status, 200);
    await first.text();
    const repeated = await search(request("search", body, cookie));
    assert.equal(repeated.status, 409);
    assert.equal(services.searchCalls, 1);
    assert.equal(services.reservations.size, 1);
    assert.equal(services.settlements.length, 1);
  });
});

test("missing operation IDs and unsigned answer cookies fail before budget or provider access", async () => {
  const fixture = answerFixture();
  let calls = 0;
  await isolated(async () => { calls += 1; throw new Error("No network allowed."); }, async () => {
    assert.equal((await search(request("search", { query: "Cedar" }))).status, 400);
    assert.equal((await answer(request("answer", { contextToken: fixture.token }, `joysearch_hosted_session=${fixture.session}`))).status, 403);
  });
  assert.equal(calls, 0);
});

test("concurrent answer replays share one operation reservation and dispatch only one model call", async () => {
  const fixture = answerFixture();
  const services = fakeServices();
  await isolated(services.fetcher, async () => {
    const responses = await Promise.all([answer(request("answer", { contextToken: fixture.token }, fixture.cookie)), answer(request("answer", { contextToken: fixture.token }, fixture.cookie))]);
    const output = await Promise.all(responses.map(events));
    assert.equal(output.filter(lines => lines.at(-1)?.type === "done").length, 1);
    assert.equal(output.filter(lines => lines.at(-1)?.type === "error").length, 1);
    assert.match(JSON.stringify(output), /already been submitted/);
    assert.equal(services.modelCalls, 1);
    assert.equal(services.reservations.size, 1);
    assert.deepEqual([...services.reservations.values()], [10_000]);
    assert.equal(services.settlements.length, 1);
    const [id, sessionKey, kind] = services.sql[0].params;
    assert.equal(id, createHash("sha256").update(`answer:${fixture.token}`).digest("hex"));
    assert.equal(sessionKey, hostedSessionBudgetKey(fixture.session, secret));
    assert.equal(kind, "answer");
  });
});

test("missing or malformed budget configuration denies both routes without network access", async () => {
  const fixture = answerFixture();
  let calls = 0;
  for (const value of [undefined, "postgresql://runtime:password@evil.example/db?sslmode=require"]) {
    await isolated(async () => { calls += 1; throw new Error("No network allowed."); }, async () => {
      assert.equal((await search(request("search", { query: "Cedar", operationId: randomUUID() }))).status, 503);
      const output = await events(await answer(request("answer", { contextToken: fixture.token }, fixture.cookie)));
      assert.deepEqual(output.map(line => line.type), ["error"]);
    }, { BUDGET_DATABASE_URL: value });
  }
  assert.equal(calls, 0);
});

test("corrupt or uncertain reservation responses never reach search or generation and are not retried", async () => {
  const fixture = answerFixture();
  for (const reserve of [
    () => sqlResponse({ accepted: true, capMicros: 2_000_000 }),
    () => sqlResponse({ accepted: false, code: "missing_budget" }),
    () => { throw new Error("Reservation response lost after possible commit."); },
  ]) {
    const services = fakeServices({ reserve });
    await isolated(services.fetcher, async () => {
      assert.equal((await search(request("search", { query: "Cedar", operationId: randomUUID() }))).status, 503);
      const output = await events(await answer(request("answer", { contextToken: fixture.token }, fixture.cookie)));
      assert.deepEqual(output.map(line => line.type), ["error"]);
    });
    assert.equal(services.searchCalls + services.modelCalls, 0);
    assert.equal(services.sql.length, 2, "One reservation attempt per logical request; no uncertain retry.");
    assert.equal(services.settlements.length, 0);
  }
});

test("rate-limited search publishes the quota retry hint and preserves the signed session", async () => {
  const services = fakeServices({ reserve: () => sqlResponse({ accepted: false, code: "rate_limited", retryAfterSeconds: 3 }) });
  await isolated(services.fetcher, async () => {
    const response = await search(request("search", { query: "Cedar", operationId: randomUUID() }));
    assert.equal(response.status, 429);
    assert.equal(response.headers.get("Retry-After"), "3");
    assert.ok(readHostedSession(response.headers.get("Set-Cookie")!.split(";")[0], secret));
    assert.equal(services.searchCalls, 0);
  });
});

test("an answer is never marked complete if its durable settlement fails", async () => {
  const fixture = answerFixture();
  const services = fakeServices({ settle: () => sqlResponse({ accepted: false }) });
  await isolated(services.fetcher, async () => {
    const output = await events(await answer(request("answer", { contextToken: fixture.token }, fixture.cookie)));
    assert.ok(output.some(line => line.type === "start"));
    assert.equal(output.at(-1)?.type, "error");
    assert.equal(output.some(line => line.type === "done"), false);
    assert.equal(services.modelCalls, 1);
    assert.deepEqual([...services.reservations.values()], [10_000]);
  });
});
