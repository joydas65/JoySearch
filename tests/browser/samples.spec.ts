import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";

async function loadSample(page: Page, value: string) {
  await page.getByLabel("Choose a sample").selectOption(value);
  await page.getByRole("button", { name: "Load sample", exact: true }).click();
  await expect(page.getByRole("button", { name: "Play sample answer", exact: true })).toBeVisible();
}

test("owned samples show the four answer outcomes and inspectable same-origin evidence without API requests", async ({ page, context, baseURL, network }) => {
  await page.goto("/samples");
  await expect(page.getByRole("heading", { name: "Explore JoySearch samples" })).toBeVisible();
  await expect(page.getByText("Sample mode — fictional, authored examples. No live searches or AI requests.", { exact: true })).toBeVisible();

  for (const [value, status] of [
    ["answer", "Answer complete."],
    ["clarify", "More detail is needed."],
    ["navigation", "Answer complete."],
    ["insufficient", "The sources do not contain enough evidence."],
  ]) {
    await test.step(value, async () => {
      await loadSample(page, value);
      await page.getByRole("button", { name: "Play sample answer", exact: true }).click();
      await expect(page.getByText(status, { exact: true })).toBeVisible();
      if (value === "answer" || value === "navigation") {
        const statements = page.getByRole("list", { name: "Answer statements" });
        await expect(statements).toBeVisible();
        const citation = statements.getByRole("link").first();
        const destination = new URL((await citation.getAttribute("href"))!);
        expect(destination.origin).toBe(new URL(baseURL!).origin);
        expect(destination.pathname).toBe("/samples/sources");
        expect(destination.hash).not.toBe("");
        await page.getByText(/^Inspect the supplied sources/).click();
        await expect(page.locator("details[open]")).toContainText("[1]");
        if (value === "answer") {
          const popupPromise = context.waitForEvent("page");
          await citation.click();
          const sourcePage = await popupPromise;
          await sourcePage.waitForLoadState("domcontentloaded");
          expect(new URL(sourcePage.url()).origin).toBe(new URL(baseURL!).origin);
          await expect(sourcePage.getByRole("main")).toContainText(/fictional|authored/i);
          await sourcePage.close();
        }
      } else {
        await expect(page.getByRole("list", { name: "Answer statements" })).toHaveCount(0);
      }
    });
  }
  expect(network.apiRequests, "Samples must not even attempt the live API").toEqual([]);
});

test("simulated unavailable and exhausted answers retain usable sample results", async ({ page, network }) => {
  await page.goto("/samples");
  for (const value of ["failure", "budget"]) {
    await loadSample(page, value);
    await page.getByRole("button", { name: "Play sample answer", exact: true }).click();
    const alert = page.getByRole("region", { name: "Sample answer", exact: true }).getByRole("alert");
    await expect(alert).toBeVisible();
    await expect(alert).toContainText(/failure|allowance/i);
    await expect(page.getByRole("button", { name: "Replay sample answer", exact: true })).toBeEnabled();
    await expect(page.getByRole("heading", { level: 3 }).first().getByRole("link")).toBeVisible();
    await expect(page.getByRole("list", { name: "Answer statements" })).toHaveCount(0);
  }
  expect(network.apiRequests).toEqual([]);
});

test("stopping or replacing a sample cancels its answer without stale content", async ({ page, network }) => {
  await page.goto("/samples");
  await loadSample(page, "answer");
  await page.getByRole("button", { name: "Play sample answer", exact: true }).click();
  await page.getByRole("button", { name: "Stop answer", exact: true }).click();
  await expect(page.getByText("Answer stopped. Your search results are still available.", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { level: 3 }).first().getByRole("link")).toBeVisible();

  await page.getByRole("button", { name: "Replay sample answer", exact: true }).click();
  await loadSample(page, "clarify");
  await page.getByRole("button", { name: "Play sample answer", exact: true }).click();
  await expect(page.getByText("More detail is needed.", { exact: true })).toBeVisible();
  await expect(page.getByRole("list", { name: "Answer statements" })).toHaveCount(0);
  await expect(page.getByText("Answer complete.", { exact: true })).toHaveCount(0);
  expect(network.apiRequests).toEqual([]);
});

test("sample controls and evidence are keyboard usable on a narrow viewport", async ({ page, network }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/samples");
  const selector = page.getByLabel("Choose a sample");
  await selector.focus();
  await expect(selector).toBeFocused();
  await selector.selectOption("answer");
  await page.keyboard.press("Tab");
  const load = page.getByRole("button", { name: "Load sample", exact: true });
  await expect(load).toBeFocused();
  await page.keyboard.press("Enter");
  const play = page.getByRole("button", { name: "Play sample answer", exact: true });
  await play.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText("Answer complete.", { exact: true })).toBeVisible();
  const inspector = page.getByText(/^Inspect the supplied sources/);
  await inspector.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("details[open]")).toBeVisible();
  const sizes = await page.evaluate(() => ({ viewport: window.innerWidth, document: document.documentElement.scrollWidth }));
  expect(sizes.document).toBeLessThanOrEqual(sizes.viewport);
  expect(network.apiRequests).toEqual([]);
});
