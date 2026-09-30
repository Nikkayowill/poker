import { expect, test } from "./fixtures";
import type { Page } from "@playwright/test";

/** Works out the problem on screen, e.g. "7 × 8 = ?". */
function solve(problem: string): string {
  const match = problem.match(/(\d+)\s*([+\-×])\s*(\d+)/);
  if (!match) throw new Error(`Could not read the problem "${problem}"`);
  const a = Number(match[1]);
  const b = Number(match[3]);
  return String(match[2] === "+" ? a + b : match[2] === "-" ? a - b : a * b);
}

async function startFreeRun(page: Page, path: string) {
  await page.request.post("/api/profile");
  await page.goto(path);
  await page.getByRole("button", { name: "Free" }).click();
  await page.getByRole("button", { name: "Ante up" }).click();
}

test("quick math takes answers typed straight from the keyboard, no clicking", async ({ page }) => {
  await startFreeRun(page, "/games/quick-math");

  const problem = page.locator(".brain-math-problem");
  const score = page.locator(".brain-progress strong");
  await expect(score).toHaveText("0");

  for (let right = 1; right <= 5; right++) {
    const before = await problem.textContent();
    await page.keyboard.type(solve(before ?? ""));
    await page.keyboard.press("Enter");
    await expect(score).toHaveText(String(right));
  }

  // A miss moves on without a banner and without costing the run.
  const before = await problem.textContent();
  await page.keyboard.type("99999");
  await page.keyboard.press("Enter");
  await expect(problem).not.toHaveText(before ?? "");
  await expect(score).toHaveText("5");
  await expect(page.locator(".duel-error")).toHaveCount(0);
});

test("quick math's on-screen keypad answers without a text box", async ({ page }) => {
  await startFreeRun(page, "/games/quick-math");

  const problem = page.locator(".brain-math-problem");
  const answer = solve((await problem.textContent()) ?? "");
  for (const digit of answer) await page.locator(".brain-keypad").getByRole("button", { name: digit, exact: true }).click();
  await page.getByRole("button", { name: "Go" }).click();

  await expect(page.locator(".brain-progress strong")).toHaveText("1");
  await expect(page.locator(".brain-controls input")).toHaveCount(0);
});

test("trivia blitz answers from the T and F keys", async ({ page }) => {
  await startFreeRun(page, "/games/trivia-blitz");

  await expect(page.locator(".brain-trivia-statement")).toBeVisible();
  await page.keyboard.press("t");
  // Right or wrong, the answer is taken and the next statement served. The
  // pool can repeat a statement, so this watches the run's version instead.
  await expect
    .poll(async () => (await (await page.request.get("/api/brain-trivia-blitz")).json()).attempt.version)
    .toBe(2);
});
