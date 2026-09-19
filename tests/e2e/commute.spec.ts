import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  page.on("pageerror", (error) => console.error("Browser page error:", error.message));
  await page.route("**/api/morning-check", (route) => route.fulfill({
    status: 503,
    contentType: "application/json",
    body: JSON.stringify({ error: { code: "TEST_OFFLINE", message: "Live check unavailable in deterministic browser test." } }),
  }));
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Good morning, Rachel" })).toBeVisible();
  await expect(page.getByLabel("Data scenario")).toBeEnabled({ timeout: 5_000 });
});

test("renders the normal replay without horizontal overflow", async ({ page }) => {
  await expect(page.getByText("Replay scenario · Demo data")).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(overflow).toBe(false);
});

test("loads the labelled planned-work path", async ({ page }) => {
  await page.getByLabel("Data scenario").selectOption("ewl-planned-work");
  await expect(page.getByText("EWL planned work replay loaded.")).toBeAttached();
  await expect(page.getByText("Your morning journey needs one change.")).toBeVisible();
});

test("announces offline state without discarding the visible journey", async ({ page, context }) => {
  await page.getByRole("button", { name: "Use this route" }).click();
  await expect(page.getByText("Available offline")).toBeVisible();
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) await new Promise((resolve) => navigator.serviceWorker.addEventListener("controllerchange", resolve, { once: true }));
  });
  await expect.poll(() => page.evaluate(async () => {
    const cache = await caches.open("smart-commute-v3");
    const keys = await cache.keys();
    return keys.some((request) => new URL(request.url).pathname.startsWith("/_next/static/"));
  })).toBe(true);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByText(/Offline ·/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Good morning, Rachel" })).toBeVisible();
  await page.getByRole("button", { name: "Journey" }).click();
  await expect(page.getByText("Available offline")).toBeVisible();
});

test("has no serious or critical automated accessibility findings", async ({ page }) => {
  const results = await new AxeBuilder({ page }).analyze();
  const blocking = results.violations.filter((violation) => ["serious", "critical"].includes(violation.impact ?? ""));
  expect(blocking, blocking.map((item) => `${item.id}: ${item.help}`).join("\n")).toEqual([]);
});
