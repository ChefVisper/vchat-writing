import { test, expect } from "@playwright/test";
import { expectEditor } from "./editor";
test("one-shot direction, retry, pin, notes isolation and failure recovery", async ({
  page,
}) => {
  const prompts: string[] = [];
  let fail = false;
  let notePrompt = "";
  await page.route("http://localhost:5001/**", (route) => {
    const body = route.request().postDataJSON();
    if (route.request().url().endsWith("/generate/stream")) {
      prompts.push(body.prompt);
      if (fail) return route.fulfill({ status: 500, body: "Failed" });
      return route.fulfill({
        contentType: "text/event-stream",
        body: 'data: {"token":" A sentence."}\n\n',
      });
    }
    notePrompt = body.prompt;
    return route.fulfill({ json: { results: [{ text: '{"updates":[]}' }] } });
  });
  await page.goto("/");
  await page
    .getByRole("textbox", { name: "Story manuscript" })
    .fill("Beginning.");
  await page
    .getByRole("button", { name: "Next instruction", exact: true })
    .click();
  const input = page.getByRole("textbox", {
    name: "Next instruction",
    exact: true,
  });
  await input.fill("Keep Daniel silent.");
  await page.getByRole("button", { name: "Continue", exact: false }).click();
  await expect(
    page.getByRole("button", { name: "Continue", exact: false }),
  ).toBeEnabled();
  await expect(input).toHaveValue("");
  expect(prompts[0]).toContain("Keep Daniel silent.");
  expect(notePrompt).not.toContain("Keep Daniel silent.");
  await expectEditor(page, "Beginning. A sentence.");
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Continue", exact: false }),
  ).toBeEnabled();
  expect(prompts[1]).toContain("Keep Daniel silent.");
  await expectEditor(page, "Beginning. A sentence.");
  await input.fill("Focus on the room.");
  await page.getByLabel("Keep for next passages").check();
  await page.getByRole("button", { name: "Write", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Write", exact: true }),
  ).toBeEnabled();
  await expect(input).toHaveValue("Focus on the room.");
  await page.getByLabel("Keep for next passages").uncheck();
  fail = true;
  await page.getByRole("button", { name: "Write", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("500");
  await expect(input).toHaveValue("Focus on the room.");
  await page.keyboard.press("Control+s");
  await expect(page.locator(".banner[role=status]")).toContainText(
    "Saved on this device",
  );
  await page.reload();
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("button", { name: "Next instruction", exact: true })
    .click();
  await expect(input).toHaveValue("Focus on the room.");
  await page.screenshot({ path: "test-results/next-instruction-mobile.png" });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  fail = false;
  await page.getByRole("button", { name: "Write", exact: true }).click();
  await expect(input).toHaveValue("");
});
