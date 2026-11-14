import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { POST } from "../app/api/answer/route.ts";
import { ANSWER_SESSION_COOKIE, createAnswerContext, newAnswerSession } from "../lib/answer/context.ts";
import { ledgerState, readLedger } from "../lib/evaluation.ts";
import type { AnswerEvent, AnswerSource } from "../lib/answer/types.ts";

const secret = "c".repeat(64);
const origin = "http://127.0.0.1:3037";

async function isolatedRoute(fetchStub: typeof fetch, work: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "joysearch-answer-route-"));
  const previousDirectory = process.cwd();
  const previousFetch = globalThis.fetch;
  const keys = ["NODE_ENV", "VERCEL", "AI_GATEWAY_API_KEY", "ANSWER_CONTEXT_SECRET"];
  const previousEnvironment = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  try {
    process.chdir(directory);
    Object.assign(process.env, { NODE_ENV: "test" });
    delete process.env.VERCEL;
    process.env.AI_GATEWAY_API_KEY = "owned-route-test-key";
    process.env.ANSWER_CONTEXT_SECRET = secret;
    globalThis.fetch = fetchStub;
    await work(directory);
  } finally {
    globalThis.fetch = previousFetch;
    process.chdir(previousDirectory);
    for (const key of keys) {
      const value = previousEnvironment[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(directory, { recursive: true, force: true });
  }
}

function request(contextToken: string, session: string) {
  return new Request(`${origin}/api/answer`, {
    method: "POST", headers: { "Content-Type": "application/json", Host: "127.0.0.1:3037", Origin: origin, Cookie: `${ANSWER_SESSION_COOKIE}=${session}` },
    body: JSON.stringify({ contextToken }),
  });
}

test("answer route rejects a forged receipt without a model fetch or budget reservation", async () => {
  let fetches = 0;
  await isolatedRoute(async () => { fetches += 1; throw new Error("No network is permitted in this test."); }, async directory => {
    const session = newAnswerSession();
    const [body, signature] = createAnswerContext("limit", [{ id: "S1", title: "Owned page", url: "https://example.com/owned", excerpt: "Four items per account." }], session, secret).split(".");
    const forged = `${body}.${signature[0] === "A" ? "B" : "A"}${signature.slice(1)}`;
    const response = await POST(request(forged, session));
    assert.equal(response.status, 403);
    assert.match((await response.json()).error, /Run the search again/);
    assert.equal(fetches, 0);
    assert.deepEqual(await readLedger(join(directory, ".evaluation", "ledger.jsonl")), []);
  });
});

test("answer route repacks an older receipt and publishes completion only after durable settlement", async () => {
  const sources: AnswerSource[] = [
    { id: "S1", title: "Owned current limit " + "handbook ".repeat(24), url: "https://example.com/current", excerpt: "Four items are allowed per account. " + "Owned context about this limit. ".repeat(70) },
    { id: "S2", title: "Owned background", url: "https://example.com/background", excerpt: "A separate product has another limit. " + "Owned background context. ".repeat(70) },
  ];
  const query = "How many items are allowed per account?";
  const session = newAnswerSession();
  // A still-valid older receipt can contain passages packed for an earlier, shorter prompt.
  const receipt = createAnswerContext(query, sources, session, secret, Date.now() - 60_000);
  const prompts: { query: string; sources: Omit<AnswerSource, "url">[] }[] = [];
  let fetches = 0;
  const usage = { inputTokens: { total: 80, noCache: 80 }, outputTokens: { total: 50, text: 42, reasoning: 8 } };
  const fakeGateway: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    assert.equal(url.hostname, "ai-gateway.vercel.sh");
    assert.ok(url.pathname.endsWith("/language-model"));
    fetches += 1;
    const body = JSON.parse(String(init?.body));
    const message = body.prompt.find((item: { role: string }) => item.role === "user");
    assert.ok(Array.isArray(message.content));
    prompts.push(JSON.parse(message.content.filter((part: { type: string }) => part.type === "text").map((part: { text: string }) => part.text).join("")));
    if (fetches === 1) {
      assert.equal(body.responseFormat.type, "json");
      return Response.json({
        content: [{ type: "text", text: JSON.stringify({ entityResolved: true, measureResolved: true, wantsDestination: false, hasAnswerEvidence: true, message: "", destinationIds: [] }) }],
        finishReason: { unified: "stop" }, usage, warnings: [], providerMetadata: { gateway: { generationId: "gen_route_intent" } },
      });
    }
    assert.equal(fetches, 2, "The route must never dispatch a third model call.");
    const text = [
      { type: "decision", kind: "answer" },
      { type: "claim", text: "Four items are allowed per account.", sourceIds: ["S1"] },
      { type: "done", kind: "answer" },
    ].map(line => JSON.stringify(line)).join("\n") + "\n";
    const chunks = [
      { type: "response-metadata", id: "gen_route_writer" },
      { type: "text-start", id: "answer" },
      { type: "text-delta", id: "answer", delta: text },
      { type: "text-end", id: "answer" },
      { type: "finish", finishReason: { unified: "stop" }, usage },
    ];
    return new Response(chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join(""), { headers: { "Content-Type": "text/event-stream" } });
  };

  await isolatedRoute(fakeGateway, async directory => {
    const response = await POST(request(receipt, session));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.match(response.headers.get("Content-Type")!, /application\/x-ndjson/);
    const requestId = response.headers.get("X-Request-Id")!;
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    const events: AnswerEvent[] = [];
    let pending = "";
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      pending += decoder.decode(chunk.value, { stream: true });
      let newline: number;
      while ((newline = pending.indexOf("\n")) !== -1) {
        const event = JSON.parse(pending.slice(0, newline)) as AnswerEvent;
        pending = pending.slice(newline + 1);
        events.push(event);
        if (event.type === "done") {
          // Observe the ledger at the completion event, not just after the response closes.
          const state = ledgerState(await readLedger(join(directory, ".evaluation", "ledger.jsonl")));
          const settlement = state.settlements.get(`answer/${requestId}`);
          assert.equal(settlement?.status, "success");
          assert.equal(settlement.callCount, 2);
          assert.equal(settlement.usageComplete, true);
          assert.deepEqual(settlement.providerRequestIds, ["gen_route_intent", "gen_route_writer"]);
          assert.equal(settlement.inputTokens, 160);
          assert.equal(settlement.outputTokens, 100);
          assert.equal(settlement.reasoningTokens, 16);
          assert.equal(state.committedMicros, 10_000);
        }
      }
    }
    assert.equal(pending + decoder.decode(), "");
    assert.deepEqual(events.map(event => event.type), ["start", "claim", "done"]);
    const start = events[0];
    assert.equal(start.type, "start");
    if (start.type !== "start") throw new Error("Missing start event.");
    assert.equal(start.requestId, requestId);
    assert.ok(start.sources[0].excerpt.length < sources[0].excerpt.length);
    assert.ok(start.sources[0].title.length < sources[0].title.length);
    assert.deepEqual(start.sources.map(({ url }) => url), sources.map(({ url }) => url));
    const displayedEvidence = start.sources.map(({ id, title, excerpt }) => ({ id, title, excerpt }));
    assert.equal(prompts.length, 2);
    for (const prompt of prompts) {
      assert.equal(prompt.query, query);
      assert.deepEqual(prompt.sources, displayedEvidence, "UI evidence must be the exact router and writer passages.");
    }
    assert.deepEqual(prompts[1], prompts[0]);
    assert.deepEqual(Object.keys(prompts[1]), ["query", "sources"]);
    assert.deepEqual(events.at(-1), { type: "done", kind: "answer" });
    const ledgerText = await readFile(join(directory, ".evaluation", "ledger.jsonl"), "utf8");
    assert.ok(!ledgerText.includes(query) && !ledgerText.includes("Four items"));
  });
  assert.equal(fetches, 2);
});
