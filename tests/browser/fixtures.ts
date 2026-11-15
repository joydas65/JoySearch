import { test as base, expect, type Route } from "@playwright/test";

type ApiMock = (route: Route) => Promise<void>;
type BrowserNetwork = {
  apiRequests: string[];
  mock: (path: "/api/search" | "/api/answer", handler: ApiMock) => void;
};

/** API requests are refused unless a case explicitly supplies a handler. */
export const test = base.extend<{ network: BrowserNetwork }>({
  network: [async ({ context, baseURL }, use) => {
    if (!baseURL || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(baseURL).hostname)) {
      throw new Error("Browser checks require a local test server, never a deployed app.");
    }
    const origin = new URL(baseURL).origin;
    const handlers = new Map<string, ApiMock>();
    const apiRequests: string[] = [];
    const forbidden: string[] = [];
    context.on("request", (request) => {
      const url = new URL(request.url());
      if (url.pathname.startsWith("/api/")) apiRequests.push(`${request.method()} ${url.pathname}`);
      if (url.origin !== origin || (url.pathname.startsWith("/api/") && !handlers.has(url.pathname))) {
        forbidden.push(`${request.method()} ${url.origin}${url.pathname}`);
      }
    });
    await context.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) return route.abort("blockedbyclient");
      if (url.pathname.startsWith("/api/")) {
        const handler = handlers.get(url.pathname);
        if (!handler) return route.abort("blockedbyclient");
        return handler(route);
      }
      return route.continue();
    });
    await use({ apiRequests, mock: (path, handler) => { handlers.set(path, handler); } });
    expect(forbidden, "Unexpected API or off-origin requests must fail the release check, even when blocked").toEqual([]);
  }, { auto: true }],
});

export { expect };

// Authored test evidence; these are simulated responses, never quality measurements.
export const ownedSource = {
  id: "S1",
  title: "Owned test guide",
  url: "https://example.test/owned-guide",
  excerpt: "The fictional library opens at 09:00 on weekdays.",
};

export function searchResponse(title = ownedSource.title) {
  return {
    provider: "exa",
    answerContext: "owned-browser-test-receipt",
    results: [{ ...ownedSource, title }],
  };
}

export const answerStart = { type: "start", requestId: "owned-browser-test", sources: [ownedSource] };
export const answerClaim = { type: "claim", claim: { text: "The fictional library opens at 09:00 on weekdays.", sourceIds: ["S1"] } };
export const answerDone = { type: "done", kind: "answer" };
export function ndjson(events: unknown[]) {
  return events.map((event) => JSON.stringify(event)).join("\n") + "\n";
}
