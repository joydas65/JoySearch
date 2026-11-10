import assert from "node:assert/strict";
import { test } from "node:test";
import { searchWikipedia } from "../lib/wikipedia.ts";

test("encodes special characters and normalizes whitespace without adding query parameters", async (t) => {
  let requestedUrl = "";
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    requestedUrl = String(input);
    return Response.json({ batchcomplete: true });
  });

  await searchWikipedia("  Earth  &\t Moon + C#?format=xml  ");

  const url = new URL(requestedUrl);
  assert.equal(url.origin, "https://en.wikipedia.org");
  assert.equal(url.searchParams.get("gsrsearch"), "Earth & Moon + C#?format=xml");
  assert.equal(url.searchParams.get("format"), "json");
  assert.equal(url.searchParams.getAll("format").length, 1);
  assert.equal(url.searchParams.get("gsrlimit"), "20");
  assert.equal(url.searchParams.get("origin"), "*");
  assert.equal(url.hash, "");
});

test("keeps Wikipedia relevance order and supports results without images or extracts", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    Response.json({
      batchcomplete: true,
      query: {
        pages: [
          { pageid: 10, index: 2, title: "Second", extract: "Second extract" },
          {
            pageid: 90,
            index: 1,
            title: "First",
            extract: "First extract",
            thumbnail: { source: "https://upload.wikimedia.org/example.jpg", width: 80, height: 60 },
          },
          { pageid: 11, title: "Unranked" },
        ],
      },
    }),
  );

  assert.deepEqual(await searchWikipedia("test"), [
    {
      id: 90,
      title: "First",
      excerpt: "First extract",
      thumbnail: { src: "https://upload.wikimedia.org/example.jpg", width: 80, height: 60 },
    },
    { id: 10, title: "Second", excerpt: "Second extract" },
    { id: 11, title: "Unranked", excerpt: "" },
  ]);
});

test("does not fetch blank searches and handles both empty result formats", async (t) => {
  const fetchMock = t.mock.method(globalThis, "fetch", async () =>
    Response.json({ batchcomplete: true }),
  );
  assert.deepEqual(await searchWikipedia(" \n\t "), []);
  assert.equal(fetchMock.mock.callCount(), 0);
  assert.deepEqual(await searchWikipedia("no match"), []);
  fetchMock.mock.mockImplementation(async () => Response.json({ query: { pages: [] } }));
  assert.deepEqual(await searchWikipedia("still no match"), []);
});

test("uses the original responsive summary lengths at each breakpoint", async (t) => {
  const lengths: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    lengths.push(new URL(String(input)).searchParams.get("exchars")!);
    return Response.json({ batchcomplete: true });
  });

  for (const width of [320, 413, 414, 1399, 1400, 1920]) {
    await searchWikipedia("test", { width });
  }
  assert.deepEqual(lengths, ["65", "65", "100", "100", "130", "130"]);
});

test("reports HTTP, API, and network failures instead of treating them as no matches", async (t) => {
  const fetchMock = t.mock.method(globalThis, "fetch", async () =>
    new Response("Unavailable", { status: 503 }),
  );
  await assert.rejects(searchWikipedia("test"), /unavailable right now/);

  fetchMock.mock.mockImplementation(async () => Response.json({ error: { code: "badvalue" } }));
  await assert.rejects(searchWikipedia("test"), /could not complete this search/);

  fetchMock.mock.mockImplementation(async () => {
    throw new TypeError("Failed to fetch");
  });
  await assert.rejects(searchWikipedia("test"), /Check your connection/);
});

test("rejects invalid JSON and malformed result data", async (t) => {
  const fetchMock = t.mock.method(globalThis, "fetch", async () => new Response("not json"));
  await assert.rejects(searchWikipedia("test"), /unexpected response/);

  for (const payload of [null, {}, { batchcomplete: true, query: null }, { query: { pages: {} } }, { query: { pages: [{ title: "No ID" }] } }]) {
    fetchMock.mock.mockImplementation(async () => Response.json(payload));
    await assert.rejects(searchWikipedia("test"), /unexpected response/);
  }
});

test("passes through cancellation so a superseded search cannot become a visible error", async (t) => {
  const controller = new AbortController();
  const abortError = new DOMException("Search cancelled", "AbortError");
  t.mock.method(globalThis, "fetch", async (_input: string | URL | Request, init?: RequestInit) => {
    assert.equal(init?.signal, controller.signal);
    controller.abort(abortError);
    throw abortError;
  });
  await assert.rejects(searchWikipedia("test", { signal: controller.signal }), (error) => error === abortError);
});
