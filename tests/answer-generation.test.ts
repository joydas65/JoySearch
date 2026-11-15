import assert from "node:assert/strict";
import { test } from "node:test";
import { simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { AnswerGenerationError, ANSWER_SYSTEM_PROMPT, generateCitedAnswer, prepareEvidence } from "../lib/answer/generate.ts";
import { AnswerProtocol, AnswerProtocolError } from "../lib/answer/protocol.ts";
import { ANSWER_RESERVATION_MICROS, DEFAULT_ANSWER_MODEL, DEFAULT_INTENT_MODEL } from "../lib/answer/model.ts";
import type { AnswerContentEvent, AnswerMetering, AnswerSource } from "../lib/answer/types.ts";

const factualIntent = { entityResolved: true, measureResolved: true, wantsDestination: false, hasAnswerEvidence: true, message: "", destinationIds: [] };
const intentUsage = { inputTokens: { total: 120, noCache: 120, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 40, text: 40, reasoning: undefined } };
const intentResult = { content: [{ type: "text" as const, text: JSON.stringify(factualIntent) }], finishReason: { unified: "stop" as const, raw: undefined }, usage: intentUsage, warnings: [], response: { id: "intent-test" } };

const source: AnswerSource = { id: "S1", title: "Owned handbook", url: "https://example.com/handbook", excerpt: "The workshop opens at 09:00 and closes at 17:00." };
const decision = JSON.stringify({ type: "decision", kind: "answer" });
const claim = JSON.stringify({ type: "claim", text: "The workshop opens at 09:00.", sourceIds: ["S1"] });
const done = JSON.stringify({ type: "done", kind: "answer" });
const answer = decision + "\n" + claim + "\n" + done + "\n";

function mockModel(text: string, finishReason: "stop" | "length" = "stop", reasoning?: number, outputTotal = 40) {
  return new MockLanguageModelV4({
    doGenerate: intentResult,
    doStream: async () => ({
      stream: simulateReadableStream({
        initialDelayInMs: 0, chunkDelayInMs: 0,
        chunks: [
          { type: "text-start", id: "text-1" },
          ...text.match(/.{1,7}|\n/g)!.map((delta) => ({ type: "text-delta" as const, id: "text-1", delta })),
          { type: "text-end", id: "text-1" },
          { type: "finish", finishReason: { unified: finishReason, raw: undefined },
            usage: { inputTokens: { total: 120, noCache: 120, cacheRead: undefined, cacheWrite: undefined },
              outputTokens: { total: outputTotal, text: outputTotal, reasoning } } },
        ],
      }),
    }),
  });
}

test("evidence packing is bounded, UTF-8 safe, idempotent and preserves source IDs", () => {
  const sources = Array.from({ length: 5 }, (_, index) => ({ ...source, id: `S${index + 1}`, url: `https://example.com/${index}`, excerpt: "Technical αβγ 🙂 detail. ".repeat(400) }));
  const prepared = prepareEvidence("  workshop   hours  ", sources);
  assert.equal(prepared.query, "workshop hours");
  assert.ok(prepared.inputTokenUpperBound <= 4_000);
  assert.ok(prepared.discardedBytes > 0);
  assert.ok(prepared.sources.every((item) => !item.excerpt.includes("�") && item.excerpt.length > 0));
  assert.deepEqual(prepared.sources.map((item) => item.id), ["S1", "S2", "S3", "S4", "S5"]);
  const second = prepareEvidence(prepared.query, prepared.sources);
  assert.equal(second.prompt, prepared.prompt);
  assert.deepEqual(second.sources, prepared.sources);
  assert.equal(second.discardedBytes, 0);
  assert.equal(prepared.system, ANSWER_SYSTEM_PROMPT);
  assert.ok(!prepared.prompt.includes("https://"));
});

test("evidence packing excludes credential URLs, duplicate pages and unsafe protocols", () => {
  const result = prepareEvidence("hours", [source,
    { ...source, id: "S2", url: "https://example.com/handbook#section" },
    { ...source, id: "S3", url: "https://user:password@example.com/other" },
    { ...source, id: "S4", url: "javascript:alert(1)" },
    { ...source, id: "S5", url: "https://example.com/second" },
  ]);
  assert.deepEqual(result.sources.map((item) => item.id), ["S1", "S5"]);
});

test("protocol emits only complete validated claims and withholds done until completion", () => {
  const protocol = new AnswerProtocol([source]);
  assert.deepEqual(protocol.push(decision.slice(0, 12)), []);
  assert.deepEqual(protocol.push(decision.slice(12) + "\n"), []);
  assert.deepEqual(protocol.push(claim.slice(0, 20)), []);
  assert.deepEqual(protocol.push(claim.slice(20)), []);
  assert.deepEqual(protocol.push("\n" + done + "\n"), [{ type: "claim", claim: { text: "The workshop opens at 09:00.", sourceIds: ["S1"] } }]);
  assert.deepEqual(protocol.finish(), { type: "done", kind: "answer" });
});

test("protocol rejects fabricated citations, truncation, contradictory terminal kinds and trailing output", () => {
  for (const text of [
    claim.replace('"S1"', '"S99"') + "\n" + done,
    claim.replace('["S1"]', "[]") + "\n" + done,
    claim + "\n",
    claim + '\n{"type":"done","kind":"insufficient","message":"Not enough evidence."}',
    claim + "\n" + done + "\n" + claim,
    claim + "\n" + done + '\n{"type":',
    '{"type":"done","kind":["clarify"],"message":"Choose a meaning."}',
  ]) {
    const protocol = new AnswerProtocol([source]);
    assert.throws(() => { protocol.push(decision + "\n" + text); protocol.finish(); }, AnswerProtocolError);
  }
  assert.throws(() => new AnswerProtocol([source]).push("x".repeat(16_385)), AnswerProtocolError);
});

test("decision must precede claims, remain stable and contain no reasoning fields", () => {
  for (const text of [
    claim + "\n" + done,
    done,
    decision,
    decision + "\n" + decision + "\n" + claim + "\n" + done,
    decision + "\n" + claim + '\n{"type":"done","kind":"navigation"}',
    '{"type":"decision","kind":["answer"]}\n' + claim + "\n" + done,
    '{"type":"decision","kind":"answer","reason":"private reasoning"}\n' + claim + "\n" + done,
    '{"type":"decision","kind":"clarify"}\n' + claim + '\n{"type":"done","kind":"clarify","message":"Which one?"}',
  ]) {
    const protocol = new AnswerProtocol([source]);
    assert.throws(() => { protocol.push(text); protocol.finish(); }, AnswerProtocolError);
  }
  const protocol = new AnswerProtocol([source]);
  assert.deepEqual(protocol.push('{"type":"decision","kind":"navigation"}\n'), []);
  assert.equal(protocol.push(claim + '\n{"type":"done","kind":"navigation"}\n').length, 1);
  assert.deepEqual(protocol.finish(), { type: "done", kind: "navigation" });
});

test("clarification and insufficient evidence are valid outcomes without invented citations", () => {
  for (const kind of ["clarify", "insufficient"] as const) {
    const protocol = new AnswerProtocol([]);
    assert.deepEqual(protocol.push(JSON.stringify({ type: "decision", kind }) + "\n"), []);
    protocol.push(JSON.stringify({ type: "done", kind, message: "More context is needed." }));
    assert.deepEqual(protocol.finish(), { type: "done", kind, message: "More context is needed." });
    assert.equal(protocol.claims.length, 0);
  }
});

test("SDK generation streams validated claims, returns usage and applies output/no-tool bounds", async () => {
  const model = mockModel(answer);
  const events: AnswerContentEvent[] = [];
  const result = await generateCitedAnswer({ query: "When does the workshop open?", sources: [source], model, onEvent: (event) => { events.push(event); } });
  assert.equal(result.kind, "answer");
  assert.equal(result.claims[0].text, "The workshop opens at 09:00.");
  assert.deepEqual(result.usage, { inputTokens: 240, outputTokens: 80, totalTokens: 320 });
  assert.equal(result.callCount, 2);
  assert.equal(model.doGenerateCalls.length, 1);
  assert.equal(model.doGenerateCalls[0].maxOutputTokens, 300);
  assert.equal(model.doGenerateCalls[0].responseFormat?.type, "json");
  assert.deepEqual(events.map((event) => event.type), ["claim", "done"]);
  assert.equal(model.doStreamCalls.length, 1);
  assert.equal(model.doStreamCalls[0].maxOutputTokens, 600);
  assert.equal(model.doStreamCalls[0].tools, undefined);
  assert.equal(model.doStreamCalls[0].prompt[0].role, "system");
  assert.equal(model.doStreamCalls[0].prompt[0].content, ANSWER_SYSTEM_PROMPT);
  assert.deepEqual(model.doGenerateCalls[0].prompt.slice(1), model.doStreamCalls[0].prompt.slice(1));
  assert.equal(result.stagePrompts.answer?.prompt, result.stagePrompts.intent.prompt);
  assert.equal(result.stagePrompts.answer?.prompt, result.preparedEvidence.prompt);
  assert.deepEqual(result.stageUsage.map(stage => stage.model), [model.modelId, model.modelId]);
  assert.equal(result.estimatedCostUsd, undefined);
  assert.equal(result.reportedCostUsd, undefined);
});

test("Gateway uses the fixed router and selected writer settings, with per-model token costs", async () => {
  for (const model of ["openai/gpt-4.1-mini", "openai/gpt-5-mini"]) {
    let calls = 0;
    const reasoningWriter = model === "openai/gpt-5-mini";
    const result = await generateCitedAnswer({ query: "hours", sources: [source], model, apiKey: "owned-test-key",
      fetch: async (_url, init) => {
        calls += 1;
        const body = JSON.parse(String(init?.body));
        const reasoningModel = calls === 1 || reasoningWriter;
        assert.equal(new Headers(init?.headers).get("ai-language-model-id"), calls === 1 ? DEFAULT_INTENT_MODEL : model);
        assert.equal(body.maxOutputTokens, calls === 1 ? 300 : 600);
        assert.equal(body.reasoning, reasoningModel ? "minimal" : undefined);
        assert.equal(body.temperature, reasoningModel ? undefined : 0);
        assert.equal(body.tools, undefined);
        if (calls === 1) {
          assert.equal(new Headers(init?.headers).get("ai-language-model-streaming"), "false");
          assert.equal(body.responseFormat.type, "json");
          return Response.json({ ...intentResult, usage: { inputTokens: { total: 120, noCache: 120 }, outputTokens: { total: 40, text: reasoningModel ? 32 : 40, ...(reasoningModel ? { reasoning: 8 } : {}) } } });
        }
        assert.equal(new Headers(init?.headers).get("ai-language-model-streaming"), "true");
        const chunks = [
          { type: "text-start", id: "a" },
          { type: "text-delta", id: "a", delta: answer },
          { type: "text-end", id: "a" },
          { type: "finish", finishReason: { unified: "stop" }, usage: {
            inputTokens: { total: 120, noCache: 120 },
            outputTokens: { total: 40, text: reasoningModel ? 32 : 40, ...(reasoningModel ? { reasoning: 8 } : {}) },
          } },
        ];
        return new Response(chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join(""), { headers: { "Content-Type": "text/event-stream" } });
      },
    });
    assert.equal(calls, 2);
    assert.equal(result.usage.outputTokens, 80);
    assert.equal(result.usage.totalTokens, 320);
    assert.equal(result.usage.reasoningTokens, reasoningWriter ? 16 : undefined);
    assert.deepEqual(result.stageUsage.map(stage => ({ stage: stage.stage, model: stage.model })), [
      { stage: "intent", model: DEFAULT_INTENT_MODEL }, { stage: "answer", model },
    ]);
    const routerCost = 120 * .00000025 + 40 * .000002;
    const writerCost = reasoningWriter ? routerCost : 120 * .0000004 + 40 * .0000016;
    assert.equal(result.estimatedCostUsd, routerCost + writerCost);
  }
});

test("an early Gateway route records and estimates only the router's work", async () => {
  let calls = 0;
  const result = await generateCitedAnswer({ query: "hours", sources: [source], model: DEFAULT_ANSWER_MODEL, apiKey: "owned-test-key",
    fetch: async (_url, init) => {
      calls += 1;
      assert.equal(calls, 1, "an evidence gap must never dispatch the writer");
      assert.equal(new Headers(init?.headers).get("ai-language-model-id"), DEFAULT_INTENT_MODEL);
      return Response.json({ ...intentResult, content: [{ type: "text", text: JSON.stringify({ ...factualIntent, hasAnswerEvidence: false }) }] });
    },
  });
  assert.equal(result.kind, "insufficient");
  assert.equal(result.callCount, 1);
  assert.deepEqual(result.stageUsage.map(stage => ({ stage: stage.stage, model: stage.model })), [{ stage: "intent", model: DEFAULT_INTENT_MODEL }]);
  assert.equal(result.estimatedCostUsd, 120 * .00000025 + 40 * .000002);
});

test("the mixed-model maximum token usage stays below the unchanged reservation", async () => {
  let calls = 0;
  const result = await generateCitedAnswer({ query: "hours", sources: [source], model: DEFAULT_ANSWER_MODEL, apiKey: "owned-test-key",
    fetch: async (_url, init) => {
      calls += 1;
      assert.equal(new Headers(init?.headers).get("ai-language-model-id"), calls === 1 ? DEFAULT_INTENT_MODEL : DEFAULT_ANSWER_MODEL);
      if (calls === 1) return Response.json({ ...intentResult, usage: { inputTokens: { total: 4_000, noCache: 4_000 }, outputTokens: { total: 300, text: 300, reasoning: 0 } } });
      const chunks = [
        { type: "text-start", id: "a" }, { type: "text-delta", id: "a", delta: answer }, { type: "text-end", id: "a" },
        { type: "finish", finishReason: { unified: "stop" }, usage: { inputTokens: { total: 4_000, noCache: 4_000 }, outputTokens: { total: 600, text: 600, reasoning: 0 } } },
      ];
      return new Response(chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join(""), { headers: { "Content-Type": "text/event-stream" } });
    },
  });
  assert.equal(calls, 2);
  assert.equal(result.usage.inputTokens, 8_000);
  assert.equal(result.usage.outputTokens, 900);
  assert.ok(Math.abs(result.estimatedCostUsd! - .00416) < 1e-12);
  assert.equal(ANSWER_RESERVATION_MICROS, 10_000);
  assert.ok(result.estimatedCostUsd! * 1e6 < ANSWER_RESERVATION_MICROS);
});

test("reasoning usage cannot bypass the total output cap or exceed reported output", async () => {
  for (const [reasoning, total] of [[8, 601], [41, 40], [-1, 40], [1.5, 40]]) {
    await assert.rejects(generateCitedAnswer({ query: "hours", sources: [source], model: mockModel(answer, "stop", reasoning, total) }), AnswerGenerationError);
  }
});

test("output-limit completion fails closed even with a syntactically valid terminal line", async () => {
  const events: AnswerContentEvent[] = [];
  await assert.rejects(generateCitedAnswer({ query: "hours", sources: [source], model: mockModel(answer, "length"), onEvent: (event) => { events.push(event); } }), AnswerProtocolError);
  assert.deepEqual(events.map((event) => event.type), ["claim"]);
});

test("provider failures are sanitized and not automatically retried", async () => {
  const model = new MockLanguageModelV4({ doGenerate: intentResult, doStream: async () => { throw new Error("sensitive provider body with api-key"); } });
  await assert.rejects(generateCitedAnswer({ query: "hours", sources: [source], model }), (error: unknown) => {
    assert.ok(error instanceof AnswerGenerationError);
    assert.ok(!error.message.includes("api-key"));
    return true;
  });
  assert.equal(model.doStreamCalls.length, 1);
});

test("cancellation prevents dispatch and interrupts an active generation", async () => {
  const before = new AbortController();
  before.abort();
  const untouched = mockModel(answer);
  await assert.rejects(generateCitedAnswer({ query: "hours", sources: [source], model: untouched, signal: before.signal }), { name: "AbortError" });
  assert.equal(untouched.doGenerateCalls.length, 0);
  assert.equal(untouched.doStreamCalls.length, 0);
  const during = new AbortController();
  const events: AnswerContentEvent[] = [];
  await assert.rejects(generateCitedAnswer({ query: "hours", sources: [source], model: mockModel(answer), signal: during.signal,
    onEvent: (event) => { events.push(event); during.abort(); },
  }), { name: "AbortError" });
  assert.deepEqual(events.map((event) => event.type), ["claim"]);
});


test("early routes skip the writer and navigation uses the server source map", async () => {
  for (const [patch, kind] of [
    [{ entityResolved: false, message: "Which workshop?" }, "clarify"],
    [{ measureResolved: false, message: "Which time?" }, "clarify"],
    [{ wantsDestination: true, destinationIds: ["S1"] }, "navigation"],
    [{ hasAnswerEvidence: false, message: "No opening time is supplied." }, "insufficient"],
    [{ hasAnswerEvidence: false, message: "" }, "insufficient"],
  ] as const) {
    const model = new MockLanguageModelV4({ doGenerate: { ...intentResult, content: [{ type: "text", text: JSON.stringify({ ...factualIntent, ...patch }) }] } });
    const events: AnswerContentEvent[] = [];
    const result = await generateCitedAnswer({ query: "workshop", sources: [source], model, onEvent: event => { events.push(event); } });
    assert.equal(result.kind, kind);
    assert.equal(result.callCount, 1);
    assert.equal(model.doGenerateCalls.length, 1);
    assert.equal(model.doStreamCalls.length, 0);
    if (kind === "navigation") assert.deepEqual(result.claims, [{ text: "Open Owned handbook.", sourceIds: ["S1"] }]);
    else assert.equal(result.claims.length, 0);
    if (kind === "insufficient") assert.equal(result.message, "The supplied sources do not establish an answer to “workshop”.");
    assert.equal(events.at(-1)?.type, "done");
  }
});

test("writer cannot override the server route and retains completed intent accounting on failure", async () => {
  const snapshots: AnswerMetering[] = [];
  const wrongKind = '{"type":"decision","kind":"navigation"}\n' + claim + '\n{"type":"done","kind":"navigation"}\n';
  await assert.rejects(generateCitedAnswer({ query: "hours", sources: [source], model: mockModel(wrongKind), onMetering: progress => snapshots.push(progress) }), AnswerProtocolError);
  assert.equal(snapshots.at(-1)?.callCount, 2);
  assert.equal(snapshots.at(-1)?.usageComplete, false);
  assert.deepEqual(snapshots.at(-1)?.providerRequestIds, ["intent-test"]);
  assert.deepEqual(snapshots.at(-1)?.usage, { inputTokens: 120, outputTokens: 40, totalTokens: 160 });
});

test("cancellation after routing prevents a second dispatch under the shared deadline", async () => {
  const controller = new AbortController();
  const model = mockModel(answer);
  await assert.rejects(generateCitedAnswer({ query: "hours", sources: [source], model, signal: controller.signal,
    onMetering: progress => { if (progress.callCount === 1 && progress.usageComplete) controller.abort(new DOMException("Task deadline reached", "TimeoutError")); },
  }), { name: "TimeoutError" });
  assert.equal(model.doGenerateCalls.length, 1);
  assert.equal(model.doStreamCalls.length, 0);
});

test("malformed intent is a sanitized protocol failure with completed usage, while token overflow remains incomplete", async () => {
  for (const { routeResult, expectedError, usageComplete } of [
    { routeResult: { ...intentResult, content: [{ type: "text" as const, text: "malformed private provider content" }] }, expectedError: AnswerProtocolError, usageComplete: true },
    { routeResult: { ...intentResult, content: [{ type: "text" as const, text: JSON.stringify({ ...factualIntent, wantsDestination: true, destinationIds: ["S99"] }) }] }, expectedError: AnswerProtocolError, usageComplete: true },
    { routeResult: { ...intentResult, usage: { ...intentUsage, outputTokens: { total: 301, text: 301, reasoning: undefined } } }, expectedError: AnswerGenerationError, usageComplete: false },
  ]) {
    const model = new MockLanguageModelV4({ doGenerate: routeResult });
    const snapshots: AnswerMetering[] = [];
    const events: AnswerContentEvent[] = [];
    await assert.rejects(generateCitedAnswer({ query: "hours", sources: [source], model,
      onMetering: progress => snapshots.push(progress), onEvent: event => { events.push(event); },
    }), (error: unknown) => {
      assert.ok(error instanceof expectedError);
      assert.ok(!error.message.includes("private provider content"));
      assert.equal("text" in error, false);
      assert.equal("cause" in error, false);
      return true;
    });
    assert.equal(model.doGenerateCalls.length, 1);
    assert.equal(model.doStreamCalls.length, 0);
    assert.deepEqual(events, []);
    assert.equal(snapshots.at(-1)?.callCount, 1);
    assert.equal(snapshots.at(-1)?.usageComplete, usageComplete);
    if (usageComplete) {
      assert.deepEqual(snapshots.at(-1)?.providerRequestIds, ["intent-test"]);
      assert.deepEqual(snapshots.at(-1)?.usage, { inputTokens: 120, outputTokens: 40, totalTokens: 160 });
    }
  }
});
