import { test, expect } from "@playwright/test";
import { expectEditor } from "./editor";

test("NanoGPT thinking stays private, selective context persists and mobile controls fit", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const sent: any[] = [];
  await page.route("https://api.nano-gpt.com/api/v1/**", async (route) => {
    if (route.request().method() === "GET")
      return route.fulfill({
        json: { data: [{ id: "test/reasoner", context_length: 64000 }] },
      });
    const body = route.request().postDataJSON();
    sent.push(body);
    const prose = [
      "A complete sentence.",
      "Another sentence followed.",
      "She finally smiled.",
    ][sent.length - 1];
    return route.fulfill({
      contentType: "text/event-stream",
      body:
        'data: {"choices":[{"delta":{"reasoning_content":"Private plan ' +
        sent.length +
        '."}}]}\n\n' +
        'data: {"choices":[{"delta":{"content":"<thi"}}]}\n\n' +
        `data: ${JSON.stringify({ choices: [{ delta: { content: "nk>Inline thought.</think> " + prose } }] })}\n\ndata: [DONE]\n\n`,
    });
  });
  await page.goto("/");
  await page
    .getByRole("textbox", { name: "Story manuscript" })
    .fill("Beginning.");
  await page.getByRole("button", { name: "AI", exact: true }).click();
  await page.getByLabel("Provider", { exact: true }).selectOption("nanogpt");
  await expect(page.getByLabel("Server URL")).toHaveValue(
    "https://api.nano-gpt.com/api/v1",
  );
  await page.getByLabel("API key · saved on this device").fill("test-nano-key");
  await page.getByRole("button", { name: "Fetch models", exact: true }).click();
  await page.getByLabel("Fetched models").selectOption("test/reasoner");
  await page.getByRole("button", { name: "Close writing tools" }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByLabel("Writing Output (tokens)", { exact: true }).fill("150");
  await page
    .getByLabel("Thinking Output (tokens)", { exact: true })
    .fill("300");
  await expect(page.getByLabel("Thinking prefix", { exact: true })).toHaveValue(
    "<think>",
  );
  await expect(
    page.getByLabel("Writing Thinking", { exact: true }),
  ).not.toBeChecked();
  await expect(page.getByLabel("Top K", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Min P", { exact: true })).toBeVisible();
  await expect(
    page.getByLabel("Repetition penalty", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close writing tools" }).click();
  await page.getByRole("button", { name: "Write", exact: true }).click();
  await expectEditor(page, "Beginning. A complete sentence.");
  await expect(
    page.getByRole("button", { name: "Write", exact: true }),
  ).toBeEnabled();
  expect(sent[0].max_tokens).toBe(450);
  expect(sent[0].reasoning.effort).toBe("none");
  await page.getByRole("button", { name: "Thinking", exact: true }).click();
  await expect(page.locator(".thinking-record pre")).toHaveText(
    "Private plan 1.Inline thought.",
  );
  await page.getByLabel("Use this thinking in context").check();
  await page.getByRole("button", { name: "Close writing tools" }).click();
  await page.getByRole("button", { name: "Write", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Write", exact: true }),
  ).toBeEnabled();
  expect(sent[1].messages[1].content).not.toContain("Private plan 1.");
  await page.getByRole("button", { name: "Thinking", exact: true }).click();
  await page.getByLabel("Include selected thinking in context").check();
  await page.getByRole("button", { name: "Close writing tools" }).click();
  await page.getByRole("button", { name: "Write", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Write", exact: true }),
  ).toBeEnabled();
  expect(sent[2].messages[1].content).toContain("Private plan 1.");
  expect(sent[2].messages[1].content).not.toContain("Private plan 2.");
  await expect(
    page
      .locator(".dock-left")
      .getByRole("button", { name: "Undo", exact: true }),
  ).toBeVisible();
  const bounds = await page.locator(".dock-left").boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expectEditor(
    page,
    "Beginning. A complete sentence. Another sentence followed.",
  );
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expectEditor(
    page,
    "Beginning. A complete sentence. Another sentence followed. She finally smiled.",
  );
  await page.keyboard.press("Control+s");
  await page.reload();
  await page.getByRole("button", { name: "Thinking", exact: true }).click();
  await expect(page.locator(".thinking-record")).toHaveCount(3);
  await expect(
    page.getByLabel("Include selected thinking in context"),
  ).toBeChecked();
  await expect(
    page.getByLabel("Use this thinking in context").last(),
  ).toBeChecked();
  await page.screenshot({
    path: "test-results/thinking-mobile.png",
    fullPage: true,
  });
});

test("sampling sliders are present for all five providers", async ({
  page,
}) => {
  await page.goto("/");
  for (const provider of [
    "kobold",
    "openai",
    "horde",
    "openrouter",
    "nanogpt",
  ]) {
    await page.getByRole("button", { name: "AI", exact: true }).click();
    await page.getByLabel("Provider", { exact: true }).selectOption(provider);
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    for (const label of ["Top K", "Min P", "Repetition penalty"])
      await expect(page.getByLabel(label, { exact: true })).toBeVisible();
  }
});
