import assert from "node:assert/strict";
import test from "node:test";
import { normalizeQuery, parseProviderResponse, searchWeb, SearchError } from "../lib/search/providers.ts";

test("Exa uses the canonical minimal search request and keeps authentication in headers", async () => {
  let calls = 0;
  const response = await searchWeb("  C++ & web  ", {
    provider: "exa", apiKey: "test-only-key",
    fetcher: async (url, init) => {
      calls++;
      assert.equal(url, "https://api.exa.ai/search");
      assert.equal((init?.headers as Record<string, string>)["x-api-key"], "test-only-key");
      assert.deepEqual(JSON.parse(String(init?.body)), { query: "C++ & web", type: "auto", contents: { highlights: true } });
      return Response.json({ results: [{ url: "https://example.com/docs", title: "Docs", highlights: ["Useful evidence"] }], costDollars: { total: 0.007 } });
    },
  });
  assert.equal(calls, 1);
  assert.equal(response.reportedCostUsd, 0.007);
  assert.equal(response.results[0].excerpt, "Useful evidence");
});

test("Brave encodes query, keeps optional metadata honest, and accepts empty search", async () => {
  await searchWeb("C++ & R#", {
    provider: "brave", apiKey: "test-only-key", country: "IN",
    fetcher: async (input, init) => {
      const url = new URL(String(input));
      assert.equal(url.searchParams.get("q"), "C++ & R#");
      assert.equal(url.searchParams.get("country"), "IN");
      assert.equal(url.searchParams.get("result_filter"), "web");
      assert.equal((init?.headers as Record<string, string>)["X-Subscription-Token"], "test-only-key");
      return Response.json({ type: "search", web: null });
    },
  }).then((response) => assert.deepEqual(response.results, []));
  const result = parseProviderResponse("brave", { web: { results: [{ title: "A &amp; B", url: "https://example.com", description: null, page_age: "2026-11-01" }] } });
  assert.equal(result.results[0].title, "A & B");
  assert.equal(result.results[0].excerpt, "");
  assert.equal(result.results[0].publishedAt, undefined);
});

test("normalization rejects unsafe URLs, deduplicates, and ignores invalid cost metadata", () => {
  const result = parseProviderResponse("exa", {
    results: [
      { title: "unsafe", url: "javascript:alert(1)" },
      { title: "credential", url: "https://user:password@example.com" },
      { title: "Good", url: "https://example.com/", highlights: ["Evidence", "Evidence"] },
      { title: "Duplicate", url: "https://example.com/" },
    ],
    costDollars: { total: -1 },
  });
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].excerpt, "Evidence");
  assert.equal(result.reportedCostUsd, undefined);
  assert.throws(() => parseProviderResponse("exa", { error: "unexpected" }), SearchError);
  assert.throws(() => parseProviderResponse("exa", { results: [{ title: "Bad", url: "javascript:alert(1)" }] }), SearchError);
});

test("technical evidence preserves generic types, JSX, and comparison operators", () => {
  const evidence = "Promise<T> returns <Component /> when a < b && c > d.\n  Keep indentation.";
  const response = parseProviderResponse("exa", { results: [{ title: "Types", url: "https://example.com/types", highlights: [evidence] }] });
  assert.equal(response.results[0].excerpt, evidence);
});

test("query validation prevents paid requests for unsupported input", async () => {
  assert.equal(normalizeQuery(" a\n  b "), "a b");
  for (const value of ["", "x".repeat(601), Array(76).fill("word").join(" "), null]) assert.throws(() => normalizeQuery(value), SearchError);
  await assert.rejects(searchWeb("", { provider: "exa", apiKey: "test", fetcher: async () => { throw new Error("must not call"); } }), { code: "input" });
});

test("HTTP errors never leak provider bodies or retry automatically", async () => {
  let calls = 0;
  await assert.rejects(searchWeb("test", {
    provider: "exa", apiKey: "test-only-key",
    fetcher: async () => { calls++; return new Response("sensitive upstream detail", { status: 429 }); },
  }), (error: unknown) => error instanceof SearchError && error.status === 429 && !error.message.includes("sensitive"));
  assert.equal(calls, 1);
});

test("cancellation applies before dispatch and during body reading", async () => {
  const before = AbortSignal.abort(new DOMException("Stopped", "AbortError"));
  await assert.rejects(searchWeb("test", { provider: "exa", apiKey: "test", signal: before, fetcher: async () => { throw new Error("must not call"); } }), { name: "AbortError" });
  const controller = new AbortController();
  await assert.rejects(searchWeb("test", {
    provider: "exa", apiKey: "test", signal: controller.signal,
    fetcher: async () => {
      controller.abort(new DOMException("Deadline", "TimeoutError"));
      return Response.json({ results: [] });
    },
  }), { name: "TimeoutError" });
});
