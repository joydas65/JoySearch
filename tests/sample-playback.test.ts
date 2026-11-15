import assert from "node:assert/strict";
import test from "node:test";
import type { AnswerEvent } from "../lib/answer/types.ts";
import { playSampleAnswer } from "../lib/sample/playback.ts";
import { createSampleScenario, SAMPLE_CHOICES, SAMPLE_DOCUMENTS } from "../lib/sample/scenarios.ts";

test("every owned sample completes or fails explicitly without a provider request", async (t) => {
  const network = t.mock.method(globalThis, "fetch", async () => { throw new Error("Samples must not fetch."); });
  await Promise.all(SAMPLE_CHOICES.map(async ({ id }) => {
    const scenario = createSampleScenario(id, "http://localhost:3000");
    const events: AnswerEvent[] = [];
    const playback = playSampleAnswer(scenario, { onEvent: (event) => events.push(event) });
    if ("error" in scenario.result) {
      await assert.rejects(playback, { message: scenario.result.error });
      assert.deepEqual(events.map((event) => event.type), ["start"]);
    } else {
      await playback;
      const done = events.at(-1);
      assert.equal(done?.type, "done");
      if (done?.type === "done") assert.equal(done.kind, scenario.result.kind);
      for (const event of events) {
        if (event.type === "claim") {
          assert.ok(event.claim.sourceIds.every((sourceId) => scenario.sources.some((source) => source.id === sourceId)));
        }
      }
    }
    for (const source of scenario.sources) {
      const url = new URL(source.url);
      assert.equal(url.origin, "http://localhost:3000");
      assert.equal(url.pathname, "/samples/sources");
      const document = SAMPLE_DOCUMENTS.find((entry) => `#${entry.id}` === url.hash);
      assert.ok(document, "Every citation resolves to a bundled owned source.");
      assert.equal(source.excerpt, document.excerpt);
    }
  }));
  assert.equal(network.mock.callCount(), 0);
});

test("stopping before or during sample playback prevents later answer events", async () => {
  const scenario = createSampleScenario("answer", "https://preview.example");
  for (const abortAt of ["before", "start", "claim"]) {
    const controller = new AbortController();
    const events: AnswerEvent[] = [];
    if (abortAt === "before") controller.abort();
    await assert.rejects(playSampleAnswer(scenario, {
      signal: controller.signal,
      onEvent(event) {
        events.push(event);
        if (event.type === abortAt) controller.abort();
      },
    }), { name: "AbortError" });
    assert.deepEqual(events.map((event) => event.type), abortAt === "before" ? [] : abortAt === "start" ? ["start"] : ["start", "claim"]);
  }
});

test("sample source links reject credentials and noncanonical origins", () => {
  for (const origin of ["file:///tmp", "https://name:secret@example.com", "https://example.com/path", "https://example.com/"]) {
    assert.throws(() => createSampleScenario("answer", origin), /web origin/);
  }
});
