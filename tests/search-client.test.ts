import assert from "node:assert/strict";
import test from "node:test";
import { searchWeb } from "../lib/search/client.ts";

test("browser client posts queries to the app and accepts optional result metadata", async (t) => {
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    assert.equal(url, "/api/search");
    assert.equal(init.method, "POST");
    const body = JSON.parse(String(init.body));
    assert.equal(body.query, "C++ & R#");
    assert.match(body.operationId, /^[0-9a-f-]{36}$/);
    assert.equal(init.credentials, "same-origin");
    return Response.json({ provider: "exa", answerContext: "signed-context", results: [{ id: "s1", title: "Example", url: "https://example.com/", excerpt: "", publishedAt: "2026-11-14" }] });
  });
  const response = await searchWeb(" C++  & R# ");
  assert.equal(response.provider, "exa");
  assert.equal(response.results[0].publishedAt, "2026-11-14T00:00:00.000Z");
  assert.equal(response.answerContext, "signed-context");
});

test("search client rejects malformed answer receipts", async (t) => {
  const mock = t.mock.method(globalThis, "fetch", async () => Response.json({}));
  for (const answerContext of [42, "", " ", "x".repeat(24_001)]) {
    mock.mock.mockImplementation(async () => Response.json({ provider: "exa", results: [], answerContext }));
    await assert.rejects(searchWeb("test"), /unexpected response/);
  }
});

test("client rejects unsafe URLs and duplicate source IDs", async (t) => {
  const item = { id: "s1", title: "Example", url: "https://example.com/", excerpt: "Evidence" };
  const mock = t.mock.method(globalThis, "fetch", async () => Response.json({ provider: "exa", results: [item, item] }));
  await assert.rejects(searchWeb("test"), /unexpected response/);
  for (const url of ["javascript:alert(1)", "https://name:password@example.com/"]) {
    mock.mock.mockImplementation(async () => Response.json({ provider: "exa", results: [{ ...item, url }] }));
    await assert.rejects(searchWeb("test"), /unexpected response/);
  }
});

test("client exposes controlled server errors and preserves cancellation", async (t) => {
  const mock = t.mock.method(globalThis, "fetch", async () => Response.json({ error: "Search is temporarily unavailable." }, { status: 503 }));
  await assert.rejects(searchWeb("test"), /temporarily unavailable/);
  const controller = new AbortController();
  const reason = new DOMException("Stopped", "AbortError");
  controller.abort(reason);
  const cancelledFetch: typeof fetch = async (_url, init) => {
    assert.equal(init?.signal, controller.signal);
    throw reason;
  };
  mock.mock.mockImplementation(cancelledFetch);
  await assert.rejects(searchWeb("test", { signal: controller.signal }), (error) => error === reason);
});
