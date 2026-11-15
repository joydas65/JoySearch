import type { Page, Route } from "@playwright/test";
import { test, expect, searchResponse, answerStart, answerClaim, answerDone, ndjson } from "./fixtures";

async function search(page: Page, query = "Owned browser test") {
  const input = page.getByRole("searchbox", { name: "Enter a search term or phrase" });
  await input.fill(query);
  await input.press("Enter");
}

test("sample flags cannot enable the real paid routes on the isolated disabled server", async ({ page, network }) => {
  // These are the only pass-through API requests in the browser suite. Even if
  // the disable guard regresses, invalid IDs/receipts reject before reservation.
  const body = { query: "Owned disabled-route check", operationId: "invalid", contextToken: "invalid", sample: true };
  for (const path of ["/api/search", "/api/answer"] as const) {
    network.mock(path, async (route) => {
      expect(route.request().method()).toBe("POST");
      expect(route.request().postDataJSON()).toEqual(body);
      await route.continue();
    });
  }
  await page.goto("/samples");
  const outcomes = await page.evaluate(async (payload) => {
    return Promise.all(["/api/search?sample=true", "/api/answer?sample=true"].map(async (path) => {
      const response = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-JoySearch-Sample": "true" },
        body: JSON.stringify(payload),
      });
      return { status: response.status, body: await response.json() };
    }));
  }, body);
  for (const outcome of outcomes) {
    expect(outcome.status).toBe(503);
    expect(outcome.body.error).toBe("Live requests are not enabled on this deployment.");
  }
  expect(network.apiRequests.sort()).toEqual(["POST /api/answer", "POST /api/search"]);
});

test("a valid mocked live answer decodes claims and exposes its supplied evidence", async ({ page, network }) => {
  network.mock("/api/search", (route) => route.fulfill({ json: searchResponse() }));
  network.mock("/api/answer", (route) => route.fulfill({
    contentType: "application/x-ndjson",
    body: ndjson([answerStart, answerClaim, answerDone]),
  }));
  await page.goto("/");
  await search(page);
  await page.getByRole("button", { name: "Generate cited answer", exact: true }).click();
  await expect(page.getByText("Answer complete.", { exact: true })).toBeVisible();
  const statements = page.getByRole("list", { name: "Answer statements" });
  await expect(statements).toContainText("The fictional library opens at 09:00 on weekdays.");
  await expect(statements.getByRole("link", { name: "Source 1: Owned test guide", exact: true }))
    .toHaveAttribute("href", "https://example.test/owned-guide");
  await page.getByText("Inspect the supplied sources (1)", { exact: true }).click();
  await expect(page.locator("details[open]")).toContainText("The fictional library opens at 09:00 on weekdays.");
  await expect(page.getByRole("button", { name: "Generate cited answer", exact: true })).toHaveCount(0);
  expect(network.apiRequests).toEqual(["POST /api/search", "POST /api/answer"]);
});

test("cancelling a pending live answer retains links and ignores its late mock response", async ({ page, network }) => {
  network.mock("/api/search", (route) => route.fulfill({ json: searchResponse() }));
  let pendingAnswer: Route | undefined;
  network.mock("/api/answer", async (route) => { pendingAnswer = route; });
  await page.goto("/");
  await search(page);
  await page.getByRole("button", { name: "Generate cited answer", exact: true }).click();
  await expect.poll(() => Boolean(pendingAnswer)).toBe(true);
  await page.getByRole("button", { name: "Stop answer", exact: true }).click();
  await expect(page.getByText("Answer stopped. Your search results are still available.", { exact: true })).toBeVisible();
  // Aborted browser requests may reject fulfillment; either way no real API is reached.
  await pendingAnswer!.fulfill({ contentType: "application/x-ndjson", body: ndjson([answerStart, answerClaim, answerDone]) }).catch(() => undefined);
  await expect(page.getByRole("link", { name: "Owned test guide", exact: true })).toBeVisible();
  await expect(page.getByRole("list", { name: "Answer statements" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Try answer again", exact: true })).toBeEnabled();
  expect(network.apiRequests).toEqual(["POST /api/search", "POST /api/answer"]);
});

test("a newer search supersedes an older pending response", async ({ page, network }) => {
  // Model a transport that finishes despite cancellation. Merely aborting the
  // original fetch would not exercise the UI's stale-result guard.
  await page.addInitScript(() => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const value = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const isSearch = new URL(value, window.location.href).pathname === "/api/search";
      return originalFetch(input, isSearch ? { ...init, signal: undefined } : init);
    };
  });
  let pendingSearch: Route | undefined;
  network.mock("/api/search", async (route) => {
    const body = route.request().postDataJSON();
    if (body.query === "First owned query") pendingSearch = route;
    else await route.fulfill({ json: searchResponse("Newer owned result") });
  });
  await page.goto("/");
  await search(page, "First owned query");
  await expect.poll(() => Boolean(pendingSearch)).toBe(true);
  await search(page, "Second owned query");
  await expect(page.getByRole("link", { name: "Newer owned result", exact: true })).toBeVisible();
  const lateResponse = page.waitForResponse((response) =>
    new URL(response.url()).pathname === "/api/search" && response.request().postDataJSON().query === "First owned query");
  await pendingSearch!.fulfill({ json: searchResponse("Stale owned result") });
  await (await lateResponse).finished();
  // Give the delivered response and React's next paint a chance to expose a
  // stale update before making negative assertions.
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(page.getByRole("link", { name: "Stale owned result", exact: true })).toHaveCount(0);
  await expect(page.getByRole("searchbox")).toHaveValue("Second owned query");
  await expect(page.getByRole("link", { name: "Newer owned result", exact: true })).toBeVisible();
  expect(network.apiRequests).toEqual(["POST /api/search", "POST /api/search"]);
});

test("budget refusal, provider failure, and invalid citations fail safely while keeping links", async ({ page, network }) => {
  network.mock("/api/search", (route) => route.fulfill({ json: searchResponse() }));
  const cases = [
    { name: "budget refusal", status: 503, json: { error: "The demo spending allowance is unavailable." }, message: "The demo spending allowance is unavailable." },
    { name: "provider failure", status: 502, json: { error: "The answer provider is unavailable." }, message: "The answer provider is unavailable." },
    { name: "invalid citation", status: 200, body: ndjson([answerStart, { type: "claim", claim: { text: "This invalid claim must never appear.", sourceIds: ["invented-source"] } }, answerDone]), message: "The answer could not be completed safely. Your search results are still available." },
  ];
  for (const scenario of cases) {
    await test.step(scenario.name, async () => {
      network.mock("/api/answer", (route) => route.fulfill(scenario.json
        ? { status: scenario.status, json: scenario.json }
        : { status: scenario.status, contentType: "application/x-ndjson", body: scenario.body }));
      await page.goto("/");
      await search(page);
      await page.getByRole("button", { name: "Generate cited answer", exact: true }).click();
      await expect(page.getByRole("region", { name: "Cited answer", exact: true }).getByRole("alert")).toHaveText(scenario.message);
      await expect(page.getByRole("link", { name: "Owned test guide", exact: true })).toBeVisible();
      await expect(page.getByRole("list", { name: "Answer statements" })).toHaveCount(0);
      await expect(page.getByText("This invalid claim must never appear.", { exact: true })).toHaveCount(0);
    });
  }
  expect(network.apiRequests).toHaveLength(6);
});
