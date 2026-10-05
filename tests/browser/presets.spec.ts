import { test, expect } from "@playwright/test";
import { expectEditor } from "./editor";

test("Default and Writer's Block keep independent templates and saved controls", async ({
  page,
}) => {
  const requests: string[] = [];
  await page.route("http://localhost:5001/**", (route) => {
    requests.push(route.request().postDataJSON().prompt);
    return route.fulfill({
      contentType: "text/event-stream",
      body: 'data: {"token":" A complete passage."}\n\n',
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "New", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Story manuscript" })
    .fill("Mira waited.");
  await page.getByRole("button", { name: "View prompt", exact: true }).click();
  const template = page.getByRole("textbox", {
    name: "Prompt template",
    exact: true,
  });
  const original =
    "CUSTOM DEFAULT: Continue precisely.\n{{context}}\n{{story}}";
  await template.fill(original);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByLabel("Writing preset", { exact: true })).toHaveValue(
    "default",
  );
  await page.getByLabel("Writing Output (tokens)", { exact: true }).fill("150");
  await page
    .getByLabel("Writing preset", { exact: true })
    .selectOption("writers-block");
  await page.getByLabel("Scene momentum").selectOption("driving");
  await page.getByLabel("Point of view").selectOption("first");
  await page
    .locator("summary")
    .filter({ hasText: /^Prose style$/ })
    .click();
  await page.getByLabel("Vocabulary", { exact: true }).selectOption("literary");
  await page
    .locator("summary")
    .filter({ hasText: /^Narrator tones/ })
    .click();
  await page.getByLabel("Warm", { exact: true }).check();
  await expect(page.getByLabel("Neutral", { exact: true })).not.toBeChecked();
  await page
    .getByLabel("Writer's Block extra direction")
    .fill("Keep it concrete.");
  await page.getByRole("button", { name: "View prompt", exact: true }).click();
  await expect(template).not.toHaveValue(original);
  const wb = "CUSTOM WB: Continue directly.\n{{context}}\n{{story}}";
  await template.fill(wb);
  await page.getByRole("button", { name: "Write", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Write", exact: true }),
  ).toBeEnabled();
  expect(requests[0]).toContain("CUSTOM WB");
  expect(requests[0]).toContain("WRITER'S BLOCK");
  expect(requests[0]).toContain("Create a meaningful next beat");
  expect(requests[0]).toContain("Use first-person narration");
  expect(requests[0]).toContain("Vocabulary: Use varied, deliberate diction");
  expect(requests[0]).toContain("Keep it concrete.");
  expect(requests[0]).toContain("Under 150 tokens");
  await expectEditor(page, "Mira waited. A complete passage.");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page
    .getByLabel("Writing preset", { exact: true })
    .selectOption("default");
  await expect(
    page.getByLabel("Writing Output (tokens)", { exact: true }),
  ).toHaveValue("150");
  await page.getByRole("button", { name: "View prompt", exact: true }).click();
  await expect(template).toHaveValue(original);
  await page.getByRole("button", { name: "Write", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Write", exact: true }),
  ).toBeEnabled();
  expect(requests[1]).toContain("CUSTOM DEFAULT");
  expect(requests[1]).not.toContain("WRITER'S BLOCK");
  expect(requests[1]).not.toContain("Keep it concrete.");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page
    .getByLabel("Writing preset", { exact: true })
    .selectOption("writers-block");
  await page.keyboard.press("Control+s");
  await expect(page.locator(".banner[role=status]")).toContainText(
    "Saved on this device",
  );
  await page.reload();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByLabel("Writing preset", { exact: true })).toHaveValue(
    "writers-block",
  );
  await expect(page.getByLabel("Scene momentum")).toHaveValue("driving");
  await expect(page.getByLabel("Writer's Block extra direction")).toHaveValue(
    "Keep it concrete.",
  );
  await page
    .locator(".panel-body")
    .evaluate((element) => (element.scrollTop = 0));
  await page.screenshot({ path: "test-results/writers-block-desktop.png" });
  await page.getByRole("button", { name: "View prompt", exact: true }).click();
  await expect(template).toHaveValue(wb);
  await page.getByRole("button", { name: "Reset prompt", exact: true }).click();
  await expect(template).not.toHaveValue(wb);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page
    .getByRole("button", { name: "Reset Writer's Block options", exact: true })
    .click();
  await expect(page.getByLabel("Scene momentum")).toHaveValue("active");
  await expect(page.getByLabel("Writer's Block extra direction")).toHaveValue(
    "",
  );
  await page
    .getByLabel("Writing preset", { exact: true })
    .selectOption("default");
  await page.getByRole("button", { name: "View prompt", exact: true }).click();
  await expect(template).toHaveValue(original);
});

test("mobile Writer's Block controls and optional tracking notes preserve review", async ({
  page,
}) => {
  let notesPrompt = "";
  await page.route("http://localhost:5001/**", (route) => {
    notesPrompt = route.request().postDataJSON().prompt;
    const notes = JSON.parse(
      notesPrompt.split("NOTES:\n")[1].split("\n\nNEW PROSE:")[0],
    );
    return route.fulfill({
      json: {
        results: [
          {
            text: JSON.stringify({
              updates: [
                {
                  noteId: notes.find((n: any) => n.title === "Scene state")
                    .noteId,
                  newContent: "Mira is in the kitchen.",
                },
              ],
            }),
          },
        ],
      },
    });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "New", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Story manuscript" })
    .fill("Mira entered the kitchen.");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page
    .getByLabel("Writing preset", { exact: true })
    .selectOption("writers-block");
  await page
    .locator("summary")
    .filter({ hasText: /^Narrator tones/ })
    .click();
  for (const tone of [
    "Warm",
    "Tender",
    "Playful",
    "Hopeful",
    "Cozy",
    "Sincere",
  ])
    await page.getByLabel(tone, { exact: true }).check();
  await expect(page.getByLabel("Dark", { exact: true })).toBeDisabled();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "test-results/writers-block-mobile.png" });
  await page
    .getByRole("button", { name: "Add tracking notes", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Add tracking notes", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Close writing tools", exact: true })
    .click();
  await page.getByRole("button", { name: "Notebook", exact: true }).click();
  await expect(page.locator(".note-card")).toHaveCount(3);
  await page
    .getByRole("button", { name: "Close writing tools", exact: true })
    .click();
  await page.getByRole("button", { name: "Note", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Note", exact: true }),
  ).toBeEnabled();
  expect(notesPrompt).toContain("WRITER'S BLOCK NOTE TRACKING");
  expect(notesPrompt).toContain("NOTE MODE: EVIDENCE ONLY");
  await page.getByRole("button", { name: "Notebook", exact: true }).click();
  await expect(
    page.getByLabel("Scene state content", { exact: true }),
  ).toHaveValue("");
  await page.getByRole("button", { name: "Accept all", exact: true }).click();
  await expect(
    page.getByLabel("Scene state content", { exact: true }),
  ).toHaveValue("Mira is in the kitchen.");
});

test("NanoGPT receives the Writer's Block system contract and separates thinking", async ({
  page,
}) => {
  const sent: any[] = [];
  await page.route("https://api.nano-gpt.com/api/v1/**", (route) => {
    sent.push(route.request().postDataJSON());
    return route.fulfill({
      contentType: "text/event-stream",
      body: 'data: {"choices":[{"delta":{"reasoning_content":"Private continuity check."}}]}\n\ndata: {"choices":[{"delta":{"content":" I opened the door."}}]}\n\ndata: [DONE]\n\n',
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "New", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Story manuscript" })
    .fill("I waited.");
  await page.getByRole("button", { name: "AI", exact: true }).click();
  await page.getByLabel("Provider", { exact: true }).selectOption("nanogpt");
  await page.getByLabel("API key · saved on this device").fill("test-key");
  await page.getByLabel("Model", { exact: true }).fill("test/writer");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page
    .getByLabel("Writing preset", { exact: true })
    .selectOption("writers-block");
  await page.getByLabel("Point of view").selectOption("first");
  await page.getByLabel("Writing Thinking", { exact: true }).check();
  await page.getByRole("button", { name: "Write", exact: true }).click();
  await expectEditor(page, "I waited. I opened the door.");
  expect(sent[0].messages[0].content).toContain(
    "selected writing controls explicitly change",
  );
  expect(sent[0].messages[1].content).toContain(
    "Point of view: Use first-person narration",
  );
  expect(sent[0].messages[1].content).toContain("Continuity check:");
  await page.getByRole("button", { name: "Thinking", exact: true }).click();
  await expect(page.locator(".thinking-record pre")).toHaveText(
    "Private continuity check.",
  );
  await expect(
    page.getByLabel("Use this thinking in context"),
  ).not.toBeChecked();
});
