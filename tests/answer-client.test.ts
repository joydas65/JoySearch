import assert from "node:assert/strict";
import test from "node:test";
import { streamCitedAnswer } from "../lib/answer/client.ts";
import type { AnswerEvent } from "../lib/answer/types.ts";

const source = { id: "S1", title: "Owned source", url: "https://example.com/owned", excerpt: "Café opens at 09:00." };
const start = { type: "start", requestId: "request-1", sources: [source] };
const claim = { type: "claim", claim: { text: "The café opens at 09:00.", sourceIds: ["S1"] } };
const done = { type: "done", kind: "answer" };
const encode = (events: unknown[]) => new TextEncoder().encode(events.map((event) => JSON.stringify(event)).join("\n") + "\n");

function response(events: unknown[]) {
  return new Response(encode(events), { headers: { "Content-Type": "application/x-ndjson" } });
}

test("answer client sends only the context receipt and decodes fragmented UTF-8 claims", async (t) => {
  const bytes = encode([start, claim, done]);
  let offset = 0;
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    assert.equal(url, "/api/answer");
    assert.equal(init.method, "POST");
    assert.equal(init.credentials, "same-origin");
    assert.deepEqual(JSON.parse(String(init.body)), { contextToken: "signed-context" });
    return new Response(new ReadableStream({
      pull(controller) {
        if (offset === bytes.length) { controller.close(); return; }
        controller.enqueue(bytes.slice(offset, ++offset));
      },
    }), { headers: { "Content-Type": "application/x-ndjson; charset=utf-8" } });
  });
  const events: AnswerEvent[] = [];
  await streamCitedAnswer("signed-context", { onEvent: (event) => events.push(event) });
  assert.deepEqual(events, [start, claim, done]);
});

test("citation validation aborts the response and never delivers an invented source", async (t) => {
  let cancelled = false;
  const events: AnswerEvent[] = [];
  t.mock.method(globalThis, "fetch", async () => new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(encode([start, { type: "claim", claim: { text: "Unsupported.", sourceIds: ["S9"] } }]));
    },
    cancel() { cancelled = true; },
  }), { headers: { "Content-Type": "application/x-ndjson" } }));
  await assert.rejects(streamCitedAnswer("context", { onEvent: (event) => events.push(event) }), /completed safely/);
  assert.deepEqual(events, [start]);
  assert.equal(cancelled, true);
});

test("truncation, invalid event order, and content after done never complete an answer", async (t) => {
  const mock = t.mock.method(globalThis, "fetch", async () => response([]));
  for (const payload of [
    [start, claim],
    [claim, done],
    [start, start, claim, done],
    [start, done],
    [start, claim, done, claim],
    [start, claim, { type: "done", kind: "insufficient", message: "Not enough evidence." }],
    [start, { type: "claim", claim: { text: "Uncited.", sourceIds: [] } }, done],
    [start, { type: "done", kind: ["clarify"], message: "Choose a meaning." }],
  ]) {
    mock.mock.mockImplementation(async () => response(payload));
    const events: AnswerEvent[] = [];
    await assert.rejects(streamCitedAnswer("context", { onEvent: (event) => events.push(event) }), /completed safely/);
    assert.equal(events.some((event) => event.type === "done"), false);
  }
});

test("source maps reject unsafe destinations and ambiguous identifiers", async (t) => {
  const mock = t.mock.method(globalThis, "fetch", async () => response([]));
  for (const sources of [
    [source, source],
    [{ ...source, url: "javascript:alert(1)" }],
    [{ ...source, url: "https://secret:password@example.com/" }],
    [{ ...source, url: "/relative" }],
    [source, { ...source, id: "S2" }],
  ]) {
    mock.mock.mockImplementation(async () => response([{ ...start, sources }, claim, done]));
    const events: AnswerEvent[] = [];
    await assert.rejects(streamCitedAnswer("context", { onEvent: (event) => events.push(event) }), /completed safely/);
    assert.equal(events.length, 0);
  }
});

test("clarification and insufficient evidence complete without uncited answer claims", async (t) => {
  const mock = t.mock.method(globalThis, "fetch", async () => response([]));
  for (const kind of ["clarify", "insufficient"]) {
    const terminal = { type: "done", kind, message: "Please provide the product version." };
    mock.mock.mockImplementation(async () => response([{ ...start, sources: [] }, terminal]));
    const events: AnswerEvent[] = [];
    await streamCitedAnswer("context", { onEvent: (event) => events.push(event) });
    assert.deepEqual(events.at(-1), terminal);
  }
});

test("stream limits and malformed wire data fail closed", async (t) => {
  const mock = t.mock.method(globalThis, "fetch", async () => response([]));
  for (const payload of ["x".repeat(24_001), " ".repeat(65_537), new Uint8Array([0xff]), '{"type":"done"']) {
    mock.mock.mockImplementation(async () => new Response(payload, { headers: { "Content-Type": "application/x-ndjson" } }));
    await assert.rejects(streamCitedAnswer("context", { onEvent() {} }), /completed safely/);
  }
  mock.mock.mockImplementation(async () => new Response("untrusted text", { headers: { "Content-Type": "text/plain" } }));
  await assert.rejects(streamCitedAnswer("context", { onEvent() {} }), /completed safely/);
});

test("cancelling a pending stream preserves the abort reason and cancels upstream reading", async (t) => {
  const abort = new AbortController();
  const reason = new DOMException("User stopped the answer", "AbortError");
  let cancelled = false;
  t.mock.method(globalThis, "fetch", async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(encode([start])); },
    cancel() { cancelled = true; },
  }), { headers: { "Content-Type": "application/x-ndjson" } }));
  await assert.rejects(streamCitedAnswer("context", {
    signal: abort.signal,
    onEvent(event) { if (event.type === "start") abort.abort(reason); },
  }), (error) => error === reason);
  assert.equal(cancelled, true);
});

test("HTTP and streamed failures expose controlled errors without committing partial content", async (t) => {
  const mock = t.mock.method(globalThis, "fetch", async () => Response.json({ error: "Search again; the source context expired." }, { status: 410 }));
  await assert.rejects(streamCitedAnswer("context", { onEvent() {} }), /context expired/);
  mock.mock.mockImplementation(async () => response([
    start, claim, { type: "error", code: "budget", requestId: "request-1", message: "The answer allowance is unavailable." },
  ]));
  const events: AnswerEvent[] = [];
  await assert.rejects(streamCitedAnswer("context", { onEvent: (event) => events.push(event) }), /allowance is unavailable/);
  assert.equal(events.some((event) => event.type === "done"), false);
});

test("invalid receipts and pre-cancelled requests never dispatch", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls += 1; return response([]); });
  for (const token of ["", " ", "x".repeat(24_001)]) {
    await assert.rejects(streamCitedAnswer(token, { onEvent() {} }), /Search again/);
  }
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(streamCitedAnswer("context", { signal: abort.signal, onEvent() {} }), { name: "AbortError" });
  assert.equal(calls, 0);
});
