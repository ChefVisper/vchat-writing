import { test, expect } from "@playwright/test";
import {
  editorValue,
  editorState,
  expectEditor,
  setEditorText,
} from "./editor";
import { readFile } from "node:fs/promises";
test("complete continuous-writing workflow with a controlled KoboldCpp provider", async ({
  page,
}) => {
  let storyRequests: string[] = [];
  let generation = 0;
  await page.route("http://localhost:5001/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/model"))
      return route.fulfill({ json: { result: "Test writing model" } });
    if (path.includes("context_length"))
      return route.fulfill({ json: { value: 8192 } });
    if (path.endsWith("/generate/stream")) {
      const body = route.request().postDataJSON();
      storyRequests.push(body.prompt);
      generation++;
      const text =
        generation === 1
          ? "\n\nDaniel placed fifty dollars on the counter."
          : "\n\nDaniel placed fifty dollars on the table and smiled.";
      return route.fulfill({
        contentType: "text/event-stream",
        body: text
          .match(/.{1,12}|\n/g)!
          .map((token) => `data: ${JSON.stringify({ token })}\n\n`)
          .join(""),
      });
    }
    if (path.endsWith("/generate")) {
      const b = route.request().postDataJSON();
      const noteId = JSON.parse(
        b.prompt.split("NOTES:\n")[1].split("\n\nNEW PROSE:")[0],
      )[0].noteId;
      return route.fulfill({
        json: {
          results: [
            {
              text: JSON.stringify({
                updates: [
                  {
                    noteId,
                    newContent:
                      "Location: Apartment\nDaniel has placed fifty dollars on the table.",
                  },
                ],
              }),
            },
          ],
        },
      });
    }
    if (path.endsWith("/abort"))
      return route.fulfill({ json: { success: true } });
    return route.fulfill({ json: { value: 100 } });
  });
  await page.goto("/");
  const editor = page.getByRole("textbox", { name: "Story manuscript" });
  await expect(editor).toBeVisible();
  await editor.fill("Mira waited by the window.");
  await page.getByRole("button", { name: "Connection", exact: true }).click();
  await page.getByRole("button", { name: "Test connection" }).click();
  await expect(page.getByRole("status")).toContainText("Connected");
  await page.getByRole("button", { name: "Memory", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Permanent memory", exact: true })
    .fill("Mira lives in Tokyo.");
  await page.getByRole("button", { name: "Lorebook", exact: true }).click();
  await page.getByRole("button", { name: "Add lore entry" }).click();
  await page.getByLabel("Title", { exact: true }).fill("Mira lore");
  await page
    .getByLabel("Content", { exact: true })
    .fill("Mira is an architect.");
  await page
    .getByRole("textbox", { name: "Keywords (comma-separated)", exact: true })
    .fill("Mira");
  await page.getByRole("button", { name: "Continue", exact: false }).click();
  await expectEditor(page, /fifty dollars/);
  await expect(
    page.getByRole("button", { name: "Continue", exact: false }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Notebook", exact: true }).click();
  await expect(page.getByText("Review suggested changes")).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Notebook", exact: true }).click();
  await expect(page.getByText("Review suggested changes")).toBeVisible();
  await page.getByRole("button", { name: "Accept all", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Current scene content" }),
  ).toHaveValue(/fifty dollars/);
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expectEditor(page, /table and smiled/);
  await expect(
    page.getByRole("button", { name: "Continue", exact: false }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Accept all", exact: true }).click();
  await page.getByRole("button", { name: "Continue", exact: false }).click();
  await expect(
    page.getByRole("button", { name: "Continue", exact: false }),
  ).toBeEnabled();
  expect(storyRequests.at(-1)).toContain("Daniel has placed fifty dollars");
  expect(storyRequests[0]).toContain("Mira lives in Tokyo.");
  expect(storyRequests[0]).toContain("Mira is an architect.");
  await editor.fill("An edited opening.\n\n" + (await editorValue(page)));
  await expect(
    page.getByRole("button", { name: "Retry", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expectEditor(page, /^An edited/, true);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expectEditor(page, /^An edited/);
  await page.keyboard.press("Control+s");
  await page.reload();
  await page.getByRole("button", { name: "Notebook", exact: true }).click();
  await expectEditor(page, /^An edited/);
  await expect(
    page.getByRole("textbox", { name: "Current scene content" }),
  ).toHaveValue(/fifty dollars/);
  await page.getByRole("button", { name: "Memory", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Permanent memory", exact: true }),
  ).toHaveValue("Mira lives in Tokyo.");
});
test("desktop and mobile surfaces remain usable", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await expect(
    page.getByRole("textbox", { name: "Story manuscript" }),
  ).toBeVisible();
  await page.screenshot({ path: "test-results/desktop.png", fullPage: true });
  await page.getByRole("button", { name: "Light mode" }).click();
  await page.screenshot({ path: "test-results/light.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });

  await page.screenshot({ path: "test-results/mobile.png", fullPage: true });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await expect(
    page.getByRole("button", { name: "Continue", exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Toggle notebook" }).click();
  await expect(page.getByRole("heading", { name: "Notes" })).toBeVisible();
  await page.screenshot({
    path: "test-results/mobile-notes.png",
    fullPage: true,
  });
});

test("stopping a pending generation aborts the native backend", async ({
  page,
}) => {
  let aborted = false;
  await page.route("http://localhost:5001/**", async (route) => {
    if (route.request().url().endsWith("/abort")) {
      aborted = true;
      await route.fulfill({ json: { success: true } });
    } else if (route.request().url().endsWith("/generate")) {
      await route.fulfill({ json: { results: [{ text: '{"updates":[]}' }] } });
    } else if (route.request().url().endsWith("/generate/stream"))
      await new Promise((r) => setTimeout(r, 1500))
        .then(() =>
          route.fulfill({
            contentType: "text/event-stream",
            body: 'data: {"token":"not appended"}\n\n',
          }),
        )
        .catch(() => {});
  });
  await page.goto("/");
  const editor = page.getByRole("textbox", { name: "Story manuscript" });
  await expect(editor).toBeVisible();
  const before = await editorValue(page);
  await page.getByRole("button", { name: "Continue", exact: false }).click();
  await page.getByRole("button", { name: "Stop writing", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Continue", exact: false }),
  ).toBeEnabled();
  await expect.poll(() => aborted).toBe(true);
  await expectEditor(page, before);
});
test("library, snapshots, branches, presets, search and exports", async ({
  page,
}) => {
  await page.goto("/");
  const editor = page.getByRole("textbox", { name: "Story manuscript" });
  await expect(editor).toBeVisible();
  await page
    .getByRole("textbox", { name: "Story title" })
    .fill("Test manuscript");
  await editor.fill("A quiet room.\n\nA window opens.");
  await page
    .getByRole("button", { name: "Create snapshot", exact: true })
    .click();
  await editor.fill("Another possibility.");
  await page.getByRole("button", { name: "History", exact: true }).click();
  await page.getByRole("button", { name: "Restore", exact: true }).click();
  await expectEditor(page, "A quiet room.\n\nA window opens.");
  await page.getByRole("button", { name: "Branch", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Story title" })).toHaveValue(
    "Test manuscript · branch",
  );
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByLabel("Temperature", { exact: true }).fill("0.65");
  await page.getByRole("textbox", { name: "Preset name" }).fill("Quiet prose");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByLabel("Temperature", { exact: true }).fill("1");
  await page.getByLabel("Load preset").selectOption("Quiet prose");
  await expect(page.getByLabel("Temperature", { exact: true })).toHaveValue(
    "0.65",
  );
  await page.getByRole("button", { name: "Search story", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Search within story" })
    .fill("window");
  await page.getByRole("button", { name: "Find next" }).click();
  const selection = (await editorState(page))!;
  expect(
    selection.value.slice(selection.selectionStart, selection.selectionEnd),
  ).toBe("window");
  await page.getByRole("button", { name: "History", exact: true }).click();
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "Full project" }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe("Test manuscript · branch.json");
  const path = await download.path();
  await page.locator("input[type=file]").setInputFiles({
    name: download.suggestedFilename(),
    mimeType: "application/json",
    buffer: await readFile(path!),
  });
  await expect(page.getByRole("textbox", { name: "Story title" })).toHaveValue(
    "Test manuscript · branch",
  );
  await expectEditor(page, "A quiet room.\n\nA window opens.");
  await page.getByRole("button", { name: "My stories", exact: true }).click();
  await expect(page.getByRole("heading", { name: "My stories" })).toBeVisible();
  await expect(page.locator(".story-card")).toHaveCount(3);
  await page.getByRole("button", { name: "New story", exact: true }).click();
  await expectEditor(page, "");
});

test("settings limits and OpenRouter output persist", async ({ page }) => {
  let sent: any;
  await page.route("https://openrouter.ai/api/v1/**", async (route) => {
    if (route.request().url().endsWith("/key"))
      return route.fulfill({ json: { data: {} } });
    if (route.request().url().endsWith("/models"))
      return route.fulfill({
        json: { data: [{ id: "test/writer", context_length: 8192 }] },
      });
    sent = route.request().postDataJSON();
    return route.fulfill({
      contentType: "text/event-stream",
      body: 'data: {"choices":[{"delta":{"content":" More prose."}}]}\n\ndata: [DONE]\n\n',
    });
  });
  await page.goto("/");
  const editor = page.getByRole("textbox", { name: "Story manuscript" });
  await expect(editor).toBeVisible();
  await expect(page.locator(".side-panel")).toHaveCount(0);
  expect((await editor.boundingBox())!.y).toBeLessThan(115);
  await expect(page.getByText("YOUR STORY, STILL UNFOLDING")).toHaveCount(0);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(
    page.getByRole("spinbutton", { name: "Input limit (tokens)" }),
  ).toHaveCount(0);
  await page
    .getByRole("spinbutton", { name: "Writing Output (tokens)" })
    .fill("333");
  await page
    .getByRole("spinbutton", { name: "Max context (tokens)" })
    .fill("16000");
  await page.getByRole("button", { name: "AI", exact: true }).click();
  await page.getByLabel("Provider", { exact: true }).selectOption("openrouter");
  await page.getByLabel("Model", { exact: true }).fill("test/writer");
  await page.getByLabel("API key · saved on this device").fill("test-key");
  await page.getByRole("button", { name: "Fetch models" }).click();
  await expect(page.getByLabel("Fetched models")).toHaveValue("test/writer");
  await page.getByRole("button", { name: "Test connection" }).click();
  await expect(page.getByRole("status")).toContainText("Connected");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(
    page.getByRole("spinbutton", { name: "Max context (tokens)" }),
  ).toHaveValue("16000");
  await page.getByRole("button", { name: "Notebook", exact: true }).click();
  await page.getByRole("button", { name: "Delete note", exact: true }).click();
  await page.getByRole("button", { name: "Close writing tools" }).click();
  await editor.fill("Opening.");
  await page.getByRole("button", { name: "Continue", exact: false }).click();
  await expectEditor(page, "Opening. More prose.");
  expect(sent.max_tokens).toBe(333);
  expect(sent.messages[0].content).toContain("Opening.");
  await page.keyboard.press("Control+s");
  await page.reload();
  await page.getByRole("button", { name: "Settings", exact: true }).click();

  await expect(
    page.getByRole("spinbutton", { name: "Writing Output (tokens)" }),
  ).toHaveValue("333");
  await expect(
    page.getByRole("spinbutton", { name: "Max context (tokens)" }),
  ).toHaveValue("16000");
  await page.getByRole("button", { name: "AI", exact: true }).click();
  await expect(page.getByLabel("Provider", { exact: true })).toHaveValue(
    "openrouter",
  );
  await expect(page.getByLabel("API key · saved on this device")).toHaveValue(
    "test-key",
  );
});

test("reasoning-only OpenRouter output explains why no prose appeared", async ({
  page,
}) => {
  await page.route("https://openrouter.ai/api/v1/**", async (route) => {
    if (route.request().url().endsWith("/chat/completions"))
      return route.fulfill({
        contentType: "text/event-stream",
        body:
          'data: {"choices":[{"delta":{"reasoning":"internal"}}]}\n\n' +
          'data: {"choices":[{"delta":{},"finish_reason":"length"}]}\n\n' +
          "data: [DONE]\n\n",
      });
    return route.fulfill({ json: { data: [] } });
  });
  await page.goto("/");
  const editor = page.getByRole("textbox", { name: "Story manuscript" });
  await expect(editor).toBeVisible();
  const before = await editorValue(page);
  await page.getByRole("button", { name: "AI", exact: true }).click();
  await page.getByLabel("Provider", { exact: true }).selectOption("openrouter");
  await page.getByLabel("Model", { exact: true }).fill("test/writer");
  await page.getByLabel("API key · saved on this device").fill("test-key");
  await page.getByRole("button", { name: "Continue", exact: false }).click();
  await expect(page.getByRole("alert")).toContainText("Increase Output limit");
  await expectEditor(page, before);
});

test("long manuscript scrolls, follows new prose, and uses editable prompt", async ({
  page,
}) => {
  let sentPrompt = "";
  await page.route("http://localhost:5001/**", async (route) => {
    if (route.request().url().endsWith("/generate/stream")) {
      sentPrompt = route.request().postDataJSON().prompt;
      return route.fulfill({
        contentType: "text/event-stream",
        body: 'data: {"token":" The next sentence."}\n\ndata: [DONE]\n\n',
      });
    }
    return route.fulfill({ json: { result: "Test model" } });
  });
  await page.goto("/");
  const editor = page.getByRole("textbox", { name: "Story manuscript" });
  await editor.fill("A paragraph of manuscript text.\n\n".repeat(100));
  await expect
    .poll(() =>
      page
        .locator(".cm-scroller")
        .evaluate((el) => el.scrollHeight > el.clientHeight),
    )
    .toBe(true);
  await page.locator(".cm-scroller").evaluate((el) => (el.scrollTop = 0));
  await editor.hover();
  await page.mouse.wheel(0, 460);
  await expect
    .poll(() => page.locator(".cm-scroller").evaluate((el) => el.scrollTop))
    .toBeGreaterThan(0);
  await page.getByRole("button", { name: "View prompt", exact: true }).click();
  const template = page.getByRole("textbox", { name: "Prompt template" });
  await template.fill("Write spare prose.\n\n{{context}}\n\n{{story}}");
  await page.getByRole("button", { name: "Close writing tools" }).click();
  await page.locator(".cm-scroller").evaluate((el) => (el.scrollTop = 0));
  await page.getByRole("button", { name: "Continue", exact: false }).click();
  await expectEditor(page, /The next sentence\.$/);
  expect(sentPrompt).toContain("Write spare prose.");
  await expect
    .poll(() =>
      page
        .locator(".cm-scroller")
        .evaluate((el) =>
          Math.abs(el.scrollHeight - el.clientHeight - el.scrollTop),
        ),
    )
    .toBeLessThan(3);
  await page.reload();
  await page.getByRole("button", { name: "View prompt", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Prompt template" }),
  ).toHaveValue("Write spare prose.\n\n{{context}}\n\n{{story}}");
});
