import { expect, test } from "@playwright/test";

test("@smoke the app shell loads without waiting for a game", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Play free. Stack chips." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Play as guest" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Terms of Service" })).toBeVisible();
});

test("@smoke legal navigation serves the terms page", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Terms of Service" }).click();

  await expect(page).toHaveURL(/\/legal\/terms$/);
  await expect(page.getByRole("heading", { name: /terms of service/i })).toBeVisible();
});
