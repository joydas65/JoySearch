import assert from "node:assert/strict";
import { test } from "node:test";
import { prepareEvidence, ANSWER_SYSTEM_PROMPT } from "../lib/answer/generate.ts";
import { INTENT_FIXED_INPUT_BYTES, selectIntentKind, validateIntent, type AnswerIntent } from "../lib/answer/route-intent.ts";
import { AnswerProtocolError } from "../lib/answer/protocol.ts";

const source = { id: "S1", title: "Owned page", url: "https://example.com/owned", excerpt: "Owned evidence." };
const base: AnswerIntent = { entityResolved: true, measureResolved: true, wantsDestination: false, hasAnswerEvidence: true, message: "", destinationIds: [] };

test("routing precedence keeps unresolved dimensions ahead of navigation and evidence flags", () => {
  assert.equal(selectIntentKind({ ...base, entityResolved: false, wantsDestination: true, destinationIds: ["S1"] }), "clarify");
  assert.equal(selectIntentKind({ ...base, measureResolved: false }), "clarify");
  assert.equal(selectIntentKind({ ...base, wantsDestination: true, destinationIds: ["S1"] }), "navigation");
  assert.equal(selectIntentKind({ ...base, wantsDestination: true }), "insufficient");
  assert.equal(selectIntentKind({ ...base, hasAnswerEvidence: false }), "insufficient");
  assert.equal(selectIntentKind(base), "answer");
});

test("intent validation rejects invented destinations, generated answer guidance and malformed routing fields", () => {
  assert.deepEqual(validateIntent(base, [source]), base);
  for (const value of [
    { ...base, answer: "Unreviewed prose" },
    { ...base, wantsDestination: true, destinationIds: ["S99"] },
    { ...base, wantsDestination: true, destinationIds: ["https://example.com"] },
    { ...base, entityResolved: "true" },
    { ...base, measureResolved: false, message: "" },
    { ...base, resolvedEntity: "named product" },
    { ...base, resolvedMeasure: "requested limit" },
    { ...base, requirements: ["invented scope"] },
    { ...base, wantsDestination: true, destinationIds: ["S1", "S1"] },
    { ...base, hasAnswerEvidence: false, message: "x".repeat(181) },
  ]) assert.throws(() => validateIntent(value, [source]), AnswerProtocolError);
});

test("the same evidence payload fits both stages including router schema and framing overhead", () => {
  const packed = prepareEvidence("What is the relevant limit?", Array.from({ length: 5 }, (_, i) => ({ ...source, id: `S${i + 1}`, url: `https://example.com/${i}`, excerpt: "Owned large passage. ".repeat(500) })));
  assert.ok(INTENT_FIXED_INPUT_BYTES + Buffer.byteLength(packed.prompt) <= 4_000);
  assert.ok(Buffer.byteLength(ANSWER_SYSTEM_PROMPT) + Buffer.byteLength(packed.prompt) + 128 <= 4_000);
  assert.deepEqual(Object.keys(JSON.parse(packed.prompt)), ["query", "sources"]);
});

test("clarification length follows JSON Schema Unicode semantics and evidence gaps need no generated prose", () => {
  assert.equal(validateIntent({ ...base, measureResolved: false, message: "🙂".repeat(180) }, [source]).message.length, 360);
  assert.throws(() => validateIntent({ ...base, measureResolved: false, message: "🙂".repeat(181) }, [source]), AnswerProtocolError);
  assert.equal(selectIntentKind(validateIntent({ ...base, hasAnswerEvidence: false, message: "" }, [source])), "insufficient");
});
