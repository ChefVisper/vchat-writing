import { expect, test, type Page, type Route } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { editorState, expectEditor, setEditorText } from "./editor";

const endpoint = "https://openrouter.ai/api/v1";
const initialProse =
  "Mira paused at the station.\n\nThe train had already left.";

function controlledGame() {
  const sent: any[] = [];
  let next: unknown = { narrative: " The clock struck noon.", proposals: [] };
  let hold = false;
  let release: (() => void) | undefined;
  return {
    sent,
    response(value: unknown) {
      next = value;
    },
    hold() {
      hold = true;
    },
    release() {
      release?.();
      release = undefined;
    },
    async handle(route: Route) {
      if (route.request().method() === "GET") {
        await route.fulfill({
          json: route.request().url().endsWith("/key")
            ? { data: {} }
            : {
                data: [
                  {
                    id: "test/game",
                    context_length: 32000,
                    supported_parameters: [
                      "top_k",
                      "min_p",
                      "repetition_penalty",
                    ],
                    reasoning: { supports_max_tokens: true },
                  },
                ],
              },
        });
        return;
      }
      const body = route.request().postDataJSON();
      sent.push(body);
      const value = next,
        shouldHold = hold;
      hold = false;
      if (shouldHold)
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      await route
        .fulfill({
          json: {
            choices: [
              {
                message: {
                  content:
                    typeof value === "string" ? value : JSON.stringify(value),
                  reasoning:
                    "Private provider reasoning remains outside the page.",
                },
              },
            ],
          },
        })
        .catch(() => {});
    },
  };
}

async function currentStory(page: Page): Promise<any> {
  return page.evaluate(async () => {
    const path = "/src/store.ts";
    const { useStore } = await import(path);
    await useStore.getState().flush();
    const state = useStore.getState();
    return state.stories.find((story: any) => story.id === state.current);
  });
}

async function seed(page: Page, text = initialProse) {
  await page.addInitScript((endpoint) => {
    localStorage.setItem(
      "margin-local-credentials-v1",
      JSON.stringify({ [`writing:openrouter:${endpoint}`]: "fake-game-key" }),
    );
  }, endpoint);
  await page.goto("/");
  await page.getByRole("textbox", { name: "Story manuscript" }).waitFor();
  await page.evaluate(
    async ({ endpoint, text }) => {
      const storePath = "/src/store.ts",
        typesPath = "/src/types.ts";
      const { useStore } = await import(storePath);
      const { newStory } = await import(typesPath);
      const story = newStory();
      story.title = "Game regression";
      story.text = text;
      story.connection = {
        kind: "openrouter",
        url: endpoint,
        model: "test/game",
      };
      story.settings = { ...story.settings, maxTokens: 240, context: 32000 };
      useStore.getState().add(story);
      await useStore.getState().flush();
    },
    { endpoint, text },
  );
  await expectEditor(page, text);
  await mode(page, "vgame");
  await expect(page.locator(".vgame-workspace")).toBeVisible();
  await expectEditor(page, text);
  await page.evaluate(async () => {
    const path = "/src/store.ts";
    const { useStore } = await import(path);
    const store = useStore.getState(),
      story = store.stories.find((s: any) => s.id === store.current);
    store.patch({
      vgame: {
        ...story.vgame,
        settings: {
          ...story.vgame.settings,
          choiceNewPage: false,
          generationNewPage: false,
        },
      },
    });
    await useStore.getState().flush();
  });
}

async function mode(page: Page, value: "vchat" | "vgame") {
  await page
    .getByRole("button", { name: "Main settings", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "Workspace mode" })
    .selectOption(value);
  const close = page.getByRole("button", { name: "Close main settings" });
  if (await close.isVisible()) await close.click();
}

async function tab(page: Page, name: string) {
  await page
    .locator(".vgame-nav")
    .getByRole("button", { name, exact: true })
    .click();
}

async function closeTools(page: Page) {
  const button = page.getByRole("button", { name: "Close game tools" });
  if (await button.isVisible()) await button.click();
}

async function source(page: Page, text: string) {
  await tab(page, "V-HTML");
  await page
    .getByRole("textbox", { name: "V-HTML source", exact: true })
    .waitFor();
  await page.evaluate(async (text) => {
    const path = "/src/components/ManuscriptEditor.tsx";
    const { EditorView } = await import(path);
    const view = EditorView.findFromDOM(
      document.querySelector(".vgame-syntax .cm-editor"),
    );
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: text },
    });
  }, text);
}

async function apply(page: Page, text: string, definitions = false) {
  await source(page, text);
  await page
    .getByRole("checkbox", { name: "Edit canonical definitions" })
    .setChecked(definitions);
  await page
    .getByRole("button", { name: "Preview V-HTML", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Apply V-HTML", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Apply V-HTML", exact: true }).click();
  const confirm = page.getByRole("dialog", { name: "Confirm game change" });
  if (await confirm.isVisible())
    await confirm
      .getByRole("button", { name: "Confirm change", exact: true })
      .click();
  await closeTools(page);
}

async function idle(page: Page) {
  await expect(
    page.getByRole("button", { name: "Generate", exact: true }),
  ).toBeEnabled();
}

const coins =
  '<add: stat: name: "Coins" id: "coins">\n<define: stat: "coins" type: number min: 0 max: 100 default: 10 ai-access: modify>';

test("Vgame keeps Vchat prose, stores pages and mode, and follows gray light/dark appearance", async ({
  page,
}, info) => {
  await seed(page);
  await expect(page.locator("html")).toHaveAttribute("data-workspace", "vgame");
  await page
    .getByRole("textbox", { name: "Freeform game input" })
    .fill("\n\nMira found a ticket.");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expectEditor(page, initialProse + "\n\nMira found a ticket.");
  await page.getByRole("button", { name: "New page", exact: true }).click();
  await expectEditor(page, "");
  await expect(
    page.getByRole("button", { name: "Back", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expectEditor(page, initialProse + "\n\nMira found a ticket.");
  const story = await currentStory(page);
  expect(story.text).toBe(initialProse);
  expect(story.vgame.pages).toHaveLength(2);
  await page.reload();
  await expect(page.locator(".vgame-workspace")).toBeVisible();
  await expectEditor(page, initialProse + "\n\nMira found a ticket.");
  await page
    .getByRole("button", { name: "Main settings", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "Main appearance" })
    .selectOption("light");
  await page.getByRole("button", { name: "Close main settings" }).click();
  expect(
    await page
      .locator(".vgame-workspace")
      .evaluate((element) =>
        getComputedStyle(element).getPropertyValue("--card").trim(),
      ),
  ).toBe("#f0f5f1");
  await page
    .getByRole("button", { name: "Main settings", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "Main appearance" })
    .selectOption("dark");
  await page.getByRole("button", { name: "Close main settings" }).click();
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.screenshot({ path: info.outputPath("vgame-desktop.png") });
  await mode(page, "vchat");
  await expectEditor(page, initialProse);
  await mode(page, "vgame");
  await expectEditor(page, initialProse + "\n\nMira found a ticket.");
});

test("explicit choice calls AI once; plain author input and blank pages never generate", async ({
  page,
}) => {
  const api = controlledGame();
  await page.route(`${endpoint}/**`, (route) => api.handle(route));
  await seed(page);
  await apply(
    page,
    coins +
      '\n<option: id: "take" name: "Take a coin" once: true result: <modify: stat: "coins" increase: 1> <page: append> <ai: instruction: "Describe taking one coin."> <ai: instruction: "Keep it concise.">>',
  );
  expect(api.sent).toHaveLength(0);
  await page
    .getByRole("textbox", { name: "Freeform game input" })
    .fill("\nMira looked down.");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  expect(api.sent).toHaveLength(0);
  await page
    .getByRole("button", { name: "Take a coin", exact: true })
    .press("Enter");
  await idle(page);
  expect(api.sent).toHaveLength(1);
  expect(api.sent[0].stream).toBe(false);
  await expect(
    page.getByRole("button", { name: "Take a coin", exact: true }),
  ).toHaveCount(0);
  expect(
    (await currentStory(page)).vgame.objects.find(
      (object: any) => object.id === "coins",
    ).value,
  ).toBe(11);
  await expectEditor(page, /The clock struck noon\.$/);
  const story = await currentStory(page);
  expect(story.thoughts.at(-1).purpose).toBe("game");
  expect(story.vgame.pages[0].text).not.toContain("Private provider reasoning");
  await page.getByRole("button", { name: "Undo game action" }).click();
  await expectEditor(page, initialProse + "\nMira looked down.");
  await page.getByRole("button", { name: "Undo game action" }).click();
  await expect(
    page.getByRole("button", { name: "Take a coin", exact: true }),
  ).toBeEnabled();
  expect((await currentStory(page)).vgame.objects[0].value).toBe(10);
  await page.getByRole("button", { name: "Redo game action" }).click();
  await expect(
    page.getByRole("button", { name: "Take a coin", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Redo game action" }).click();
  expect(api.sent).toHaveLength(1);
  await page.getByRole("button", { name: "New page", exact: true }).click();
  await expectEditor(page, "");
  expect(api.sent).toHaveLength(1);
});

test("Manual Inbox edits, rejects, approves dependencies, and repairs invalid proposals safely", async ({
  page,
}) => {
  const api = controlledGame();
  api.response({
    narrative: " Mira opened her purse.",
    proposals: [
      {
        id: "add-three",
        reason: "She found three coins",
        vhtml: '<modify: stat: "coins" increase: 3>',
      },
      {
        id: "dismiss",
        reason: "Optional extra coin",
        vhtml: '<modify: stat: "coins" increase: 1>',
      },
      {
        id: "base",
        reason: "A second discovery",
        vhtml: '<modify: stat: "coins" increase: 2>',
      },
      {
        id: "bundle",
        reason: "Dependent discovery",
        dependencies: ["base"],
        vhtml: '<modify: stat: "coins" increase: 1>',
      },
      {
        id: "unsafe",
        reason: "Invalid command",
        vhtml: '<script: "window.bad=1">',
      },
    ],
  });
  await page.route(`${endpoint}/**`, (route) => api.handle(route));
  await seed(page);
  await apply(page, coins);
  await page.getByRole("button", { name: "Generate", exact: true }).click();
  await idle(page);
  expect((await currentStory(page)).vgame.objects[0].value).toBe(10);
  await page
    .locator(".vgame-nav")
    .getByRole("button", { name: /^Inbox/ })
    .click();
  const card = (id: string) =>
    page.locator("details.vgame-card").filter({
      has: page.getByRole("textbox", {
        name: `Proposal source ${id}`,
        exact: true,
      }),
    });
  await card("dismiss")
    .getByRole("button", { name: "Reject proposal", exact: true })
    .click();
  await card("add-three")
    .getByRole("textbox")
    .fill('<modify: stat: "coins" increase: 4>');
  await card("add-three")
    .getByRole("button", { name: "Save proposal edit", exact: true })
    .click();
  await card("add-three")
    .getByRole("button", { name: "Approve proposal", exact: true })
    .click();
  await card("bundle")
    .getByRole("button", { name: "Approve proposal bundle", exact: true })
    .click();
  await card("unsafe")
    .getByRole("textbox")
    .fill('<modify: stat: "coins" increase: 2>');
  await card("unsafe")
    .getByRole("button", { name: "Save proposal edit", exact: true })
    .click();
  await card("unsafe")
    .getByRole("button", { name: "Approve proposal", exact: true })
    .click();
  const saved = await currentStory(page);
  expect(saved.vgame.objects[0].value).toBe(19);
  expect(
    saved.vgame.proposals.find((proposal: any) => proposal.id === "dismiss")
      .status,
  ).toBe("rejected");
  expect(
    saved.vgame.proposals.find((proposal: any) => proposal.id === "base")
      .status,
  ).toBe("approved");
  expect(await page.evaluate(() => (window as any).bad)).toBeUndefined();
  await closeTools(page);
  await expectEditor(page, /Mira opened her purse\.$/);
  api.response('{"narrative":"unfinished');
  const before = (await currentStory(page)).vgame;
  await page.getByRole("button", { name: "Generate", exact: true }).click();
  await idle(page);
  await expect(page.getByRole("alert")).toContainText(/invalid Vgame JSON/);
  expect((await currentStory(page)).vgame).toEqual(before);
});

test("V-HTML preview/import and visual editors share state; global UI survives pages and event views expire", async ({
  page,
}) => {
  await seed(page);
  await source(page, coins);
  await page
    .getByRole("button", { name: "Preview V-HTML", exact: true })
    .click();
  expect((await currentStory(page)).vgame.objects).toHaveLength(0);
  await page.getByRole("button", { name: "Apply V-HTML", exact: true }).click();
  await closeTools(page);
  await tab(page, "World");
  await page
    .getByRole("combobox", { name: "World object" })
    .selectOption("coins");
  await expect(
    page.getByRole("textbox", { name: "Current value", exact: true }),
  ).toHaveValue("10");
  await page
    .getByRole("textbox", { name: "Current value", exact: true })
    .fill("25");
  await page.getByRole("button", { name: "Save object", exact: true }).click();
  expect((await currentStory(page)).vgame.objects[0].value).toBe(25);
  await page.getByRole("combobox", { name: "World object" }).selectOption("");
  await page
    .getByRole("textbox", { name: "Object ID", exact: true })
    .fill("inventory");
  await page
    .getByRole("textbox", { name: "Object name", exact: true })
    .fill("Inventory");
  await page
    .getByRole("combobox", { name: "Value type", exact: true })
    .selectOption("list");
  await page
    .getByRole("textbox", { name: "Default value", exact: true })
    .fill('["ticket"]');
  await page
    .getByRole("textbox", { name: "Current value", exact: true })
    .fill('["ticket","key"]');
  await page.getByRole("button", { name: "Save object", exact: true }).click();
  expect(
    (await currentStory(page)).vgame.objects.find(
      (object: any) => object.id === "inventory",
    ).value,
  ).toEqual(["ticket", "key"]);
  await closeTools(page);
  await source(page, "<");
  await page.getByRole("button", { name: "Load canonical source" }).click();
  await expect(
    page.getByRole("textbox", { name: "V-HTML source", exact: true }),
  ).toContainText("value: 25");
  const script =
    '<add: event: name: "Pursuit" id: "pursuit">\n<define: event: "pursuit" type: boolean default: false>\n<panel: id: "global" name: "Character" ui: global drawer: left>\n<display: id: "coins-view" stat: "coins" label: "Wallet" ui: global panel: "global" style: counter>\n<display: id: "event-view" stat: "coins" label: "Pursuit status" ui: event event: "pursuit" remove-on: event-end position: inline>\n<trigger: event: "pursuit" action: start>';
  await page.getByLabel("V-HTML file").setInputFiles({
    name: "views.vhtml",
    mimeType: "text/plain",
    buffer: Buffer.from(script),
  });
  expect((await currentStory(page)).vgame.widgets).toHaveLength(0);
  await page
    .getByRole("button", { name: "Preview V-HTML", exact: true })
    .click();
  await page.getByRole("button", { name: "Apply V-HTML", exact: true }).click();
  await closeTools(page);
  await expect(page.locator('[data-widget-id="event-view"]')).toBeVisible();
  await page.getByRole("button", { name: "Global game drawer" }).click();
  await expect(page.locator('[data-widget-id="coins-view"]')).toContainText(
    "25",
  );
  await expect(page.locator(".vgame-body")).toHaveClass(/vgame-drawer-left/);
  await closeTools(page);
  await page.getByRole("button", { name: "New page", exact: true }).click();
  await page.getByRole("button", { name: "New page", exact: true }).click();
  await page.getByRole("button", { name: "Global game drawer" }).click();
  await expect(page.locator('[data-widget-id="coins-view"]')).toBeVisible();
  await closeTools(page);
  await apply(page, '<trigger: event: "pursuit" action: end>');
  await expect(page.locator('[data-widget-id="event-view"]')).toHaveCount(0);
  expect(
    (await currentStory(page)).vgame.objects.find(
      (object: any) => object.id === "coins",
    ).value,
  ).toBe(25);
  await source(page, '<script: "alert(1)">');
  await page
    .getByRole("button", { name: "Preview V-HTML", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Apply V-HTML", exact: true }),
  ).toBeDisabled();
  await expect(page.getByRole("alert")).toContainText(/line 1/);
  await source(page, "<");
  await page
    .getByRole("textbox", { name: "V-HTML source", exact: true })
    .press("Control+End");
  await page
    .getByRole("textbox", { name: "V-HTML source", exact: true })
    .press("Control+Space");
  await expect(
    page.getByRole("listbox", { name: "V-HTML command completions" }),
  ).toBeVisible();
});

test("Game context and output settings persist independently, prompt cap is confirmed, and Smart remains permission-bound", async ({
  page,
}) => {
  const api = controlledGame();
  await page.route(`${endpoint}/**`, (route) => api.handle(route));
  await seed(page);
  await apply(
    page,
    coins +
      '\n<ai-instruct: id: "style" scope: global content: "Keep prose immediate.">',
  );
  await tab(page, "Context");
  await page
    .getByRole("combobox", { name: "Game AI profile" })
    .selectOption("novel");
  await page
    .getByRole("spinbutton", { name: "Game output (tokens)", exact: true })
    .fill("512");
  await page
    .getByRole("spinbutton", { name: "Game output (tokens)", exact: true })
    .blur();
  await page
    .getByRole("spinbutton", {
      name: "Game thinking output (tokens)",
      exact: true,
    })
    .fill("128");
  await page
    .getByRole("spinbutton", {
      name: "Game thinking output (tokens)",
      exact: true,
    })
    .blur();
  await page
    .getByRole("checkbox", { name: "Game thinking", exact: true })
    .check();
  await page
    .getByRole("combobox", { name: "Game thinking level" })
    .selectOption("medium");
  await page
    .getByRole("spinbutton", { name: "Game max context (tokens)", exact: true })
    .fill("64000");
  await page
    .getByRole("spinbutton", { name: "Game max context (tokens)", exact: true })
    .blur();
  await expect(page.locator(".vgame-side")).toContainText(
    "Provider context limit: 32,000 tokens.",
  );
  await page.getByText("Effective game prompt", { exact: true }).click();
  await expect(page.locator(".vgame-prompt-preview").first()).toContainText(
    "Keep prose immediate.",
  );
  const saved = await currentStory(page);
  expect(saved.settings.maxTokens).toBe(240);
  expect(saved.vgame.settings).toMatchObject({
    maxOutputTokens: 512,
    thinkingMaxTokens: 128,
    thinking: true,
    thinkingLevel: "medium",
    maxContextTokens: 64000,
    profile: "novel",
  });
  await closeTools(page);
  await page.reload();
  await expect(page.locator(".vgame-workspace")).toBeVisible();
  await tab(page, "Context");
  await expect(
    page.getByRole("spinbutton", { name: "Game output (tokens)", exact: true }),
  ).toHaveValue("512");
  await closeTools(page);
  await tab(page, "Inbox");
  await page
    .getByRole("combobox", { name: "AI change approval" })
    .selectOption("smart");
  await closeTools(page);
  api.response({
    narrative: " Mira counted the coins.",
    proposals: [
      {
        id: "routine",
        reason: "One coin spent",
        vhtml: '<modify: stat: "coins" decrease: 1>',
      },
      {
        id: "structure",
        reason: "New view proposed",
        vhtml:
          '<display: id: "balance" stat: "coins" ui: global style: counter>',
      },
    ],
  });
  await page.getByRole("button", { name: "Generate", exact: true }).click();
  await idle(page);
  expect(api.sent[0].max_tokens).toBe(640);
  expect(api.sent[0].reasoning.max_tokens).toBe(128);
  const after = await currentStory(page);
  expect(after.vgame.objects[0].value).toBe(9);
  expect(
    after.vgame.proposals.find((proposal: any) => proposal.id === "structure")
      .status,
  ).toBe("pending");
  expect(after.vgame.widgets).toHaveLength(0);
});

test("checkpoint import reviews concrete changes, restores world history, and header Save / Load opens game tools", async ({
  page,
}) => {
  await seed(page);
  await apply(page, coins);
  await page.getByRole("button", { name: "Save / Load", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Export checkpoint", exact: true }),
  ).toBeVisible();
  const event = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export checkpoint", exact: true })
    .click();
  const downloaded = await event;
  const checkpoint = await readFile((await downloaded.path())!, "utf8");
  expect(JSON.parse(checkpoint).project.objects[0].value).toBe(10);
  expect(checkpoint).not.toContain("fake-game-key");
  await closeTools(page);
  await apply(page, '<set: stat: "coins" value: 50>');
  await tab(page, "History");
  await page.getByLabel("Game checkpoint JSON").setInputFiles({
    name: "checkpoint.json",
    mimeType: "application/json",
    buffer: Buffer.from(checkpoint),
  });
  const dialog = page.getByRole("dialog", { name: "Confirm game change" });
  await expect(dialog).toContainText("objects.0.value");
  expect((await currentStory(page)).vgame.objects[0].value).toBe(50);
  await dialog
    .getByRole("button", { name: "Confirm change", exact: true })
    .click();
  expect((await currentStory(page)).vgame.objects[0].value).toBe(10);
  await closeTools(page);
  await page.getByRole("button", { name: "Undo game action" }).click();
  expect((await currentStory(page)).vgame.objects).toHaveLength(0);
  await page.getByRole("button", { name: "Redo game action" }).click();
  expect((await currentStory(page)).vgame.objects[0].value).toBe(10);
  expect((await currentStory(page)).text).toBe(initialProse);
  await tab(page, "History");
  const id = (await currentStory(page)).id;
  await page
    .getByRole("button", { name: "Branch current game", exact: true })
    .click();
  await expect.poll(async () => (await currentStory(page)).id).not.toBe(id);
  expect((await currentStory(page)).vgame.objects[0].value).toBe(10);
});

test("portrait input Enter, virtual prose scrolling, drawer focus and Stop preserve existing game", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const api = controlledGame();
  await page.route(`${endpoint}/**`, (route) => api.handle(route));
  const prose = Array.from(
    { length: 80 },
    (_, i) =>
      `Paragraph ${i + 1}. Mira waited near the station while rain crossed the empty platform.`,
  ).join("\n\n");
  await seed(page, prose);
  await page
    .getByRole("textbox", { name: "Freeform game input" })
    .fill("First line");
  await page.getByRole("textbox", { name: "Freeform game input" }).press("End");
  await page
    .getByRole("textbox", { name: "Freeform game input" })
    .press("Enter");
  await page
    .getByRole("textbox", { name: "Freeform game input" })
    .pressSequentially("Second line");
  await expect(
    page.getByRole("textbox", { name: "Freeform game input" }),
  ).toHaveValue("First line\nSecond line");
  const state = await editorState(page);
  expect(state!.scrollHeight).toBeGreaterThan(state!.clientHeight);
  expect(state!.renderedLines).toBeLessThan(160);
  await page.locator(".vgame-prose .cm-scroller").evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect
    .poll(async () => (await editorState(page))!.scrollTop)
    .toBeGreaterThan(0);
  await tab(page, "UI");
  const panel = page.getByRole("dialog", { name: "UI tools", exact: true });
  await expect(panel).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Close game tools" }),
  ).toBeFocused();
  await page
    .getByRole("button", { name: "Close game tools" })
    .press("Shift+Tab");
  expect(
    await panel.evaluate((element) => element.contains(document.activeElement)),
  ).toBe(true);
  await page.keyboard.press("Escape");
  await expect(panel).not.toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(overflow).toBe(false);
  const before = (await currentStory(page)).vgame;
  api.hold();
  await page.getByRole("button", { name: "Generate", exact: true }).click();
  await expect.poll(() => api.sent.length).toBe(1);
  await tab(page, "Thinking");
  await expect(
    page
      .getByRole("dialog", { name: "Thinking tools" })
      .getByRole("button", { name: "Stop AI", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("dialog", { name: "Thinking tools" })
    .getByRole("button", { name: "Stop AI", exact: true })
    .click();
  api.release();
  await closeTools(page);
  await idle(page);
  expect((await currentStory(page)).vgame).toEqual(before);
  await page.screenshot({ path: info.outputPath("vgame-mobile.png") });
  api.response({
    narrative: Array.from(
      { length: 20 },
      (_, i) =>
        `\n\nNew paragraph ${i + 1}. The platform came alive with distant footsteps.`,
    ).join(""),
    proposals: [],
  });
  await page.getByRole("button", { name: "Generate", exact: true }).click();
  await idle(page);
  expect((await currentStory(page)).vgame.pages[0].text).toContain(
    "\n\nNew paragraph 20.",
  );
  expect((await currentStory(page)).vgame.proposals).toHaveLength(0);
  await page.getByRole("button", { name: "Undo game action" }).click();
  await expectEditor(page, prose);
});

test("large copied manuscripts remain virtual, canonical drafts preserve archives, and prose edits have compact atomic undo", async ({
  page,
}) => {
  const prose = Array.from(
    { length: 4000 },
    (_, i) =>
      `Paragraph ${i}. Mira considered the long journey through the city while wind moved over the station roof and the train waited nearby.`,
  ).join("\n\n");
  expect(prose.length).toBeGreaterThan(500000);
  await seed(page, prose);
  const state = await editorState(page);
  expect(state!.renderedLines).toBeLessThan(100);
  await source(page, "");
  await page
    .getByRole("button", { name: "Load canonical source", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "V-HTML source", exact: true }),
  ).toContainText("full project JSON");
  await page
    .getByRole("button", { name: "Preview V-HTML", exact: true })
    .click();
  await page.getByRole("button", { name: "Apply V-HTML", exact: true }).click();
  const confirm = page.getByRole("dialog", { name: "Confirm game change" });
  if (await confirm.isVisible())
    await confirm
      .getByRole("button", { name: "Confirm change", exact: true })
      .click();
  await closeTools(page);
  await expectEditor(page, prose);
  await tab(page, "Pages");
  const draft = page.getByRole("textbox", {
    name: "Current page prose",
    exact: true,
  });
  await draft.focus();
  await draft.press("Control+End");
  await draft.press("Enter");
  await draft.press("Enter");
  await draft.pressSequentially("She finally boarded.");
  await page
    .getByRole("button", { name: "Save page prose", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Confirm game change" })
    .getByRole("button", { name: "Confirm change", exact: true })
    .click();
  await closeTools(page);
  await expectEditor(page, prose + "\n\nShe finally boarded.");
  const project = (await currentStory(page)).vgame;
  expect(JSON.stringify(project).length).toBeLessThan(prose.length * 1.2);
  await page.getByRole("button", { name: "Undo game action" }).click();
  await expectEditor(page, prose);
  await page.getByRole("button", { name: "Redo game action" }).click();
  await expectEditor(page, prose + "\n\nShe finally boarded.");
  expect((await currentStory(page)).text).toBe(prose);
});

test("an existing Vgame stays usable beside a Vchat manuscript over the page-copy limit", async ({
  page,
}) => {
  await seed(page);
  await page.evaluate(async () => {
    const storePath = "/src/store.ts",
      typesPath = "/src/types.ts",
      gamePath = "/src/vgame/runtime.ts";
    const { useStore } = await import(storePath);
    const { newStory } = await import(typesPath);
    const { createGameProject } = await import(gamePath);
    const story = newStory();
    story.title = "Independent large manuscript";
    story.text = "x".repeat(2_100_000);
    story.vgame = createGameProject("The game has its own short page.");
    useStore.getState().add(story);
    await useStore.getState().flush();
  });
  await expect(page.locator(".vgame-workspace")).toBeVisible();
  await expectEditor(page, "The game has its own short page.");
  await page
    .getByRole("textbox", { name: "Freeform game input" })
    .fill("\nIt continues independently.");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expectEditor(
    page,
    "The game has its own short page.\nIt continues independently.",
  );
  expect((await currentStory(page)).text.length).toBe(2_100_000);
  await page.reload();
  await expect(page.locator(".vgame-workspace")).toBeVisible();
  await expectEditor(
    page,
    "The game has its own short page.\nIt continues independently.",
  );
  expect((await currentStory(page)).text.length).toBe(2_100_000);
});

test("imported unsupported and missing-reference choice predicates disable safely without losing prose", async ({
  page,
}) => {
  await seed(page);
  await apply(
    page,
    '<option: id: "broken" name: "Unsupported predicate" once: false result: <page: append>>',
  );
  await page.evaluate(async () => {
    const storePath = "/src/store.ts",
      parserPath = "/src/vgame/parser.ts";
    const { useStore } = await import(storePath);
    const { parseVHTML } = await import(parserPath);
    const state = useStore.getState();
    const story = state.stories.find((item: any) => item.id === state.current);
    const project = structuredClone(story.vgame);
    const original = project.options[0];
    project.options = [
      {
        ...original,
        conditions: parseVHTML('<notification: "Unsupported condition">'),
      },
      {
        ...original,
        id: "missing",
        name: "Missing reference",
        conditions: parseVHTML(
          '<require: stat: "missing-stat" operator: ">=" value: 1>',
        ),
      },
    ];
    state.patch({ vgame: project });
    await useStore.getState().flush();
  });
  await expect(page.locator(".vgame-workspace")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Unsupported predicate", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Missing reference", exact: true }),
  ).toBeDisabled();
  await expectEditor(page, initialProse);
  await page
    .getByRole("textbox", { name: "Freeform game input" })
    .fill("\nThe story can still continue.");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expectEditor(page, initialProse + "\nThe story can still continue.");
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Unsupported predicate", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Missing reference", exact: true }),
  ).toBeDisabled();
  await expectEditor(page, initialProse + "\nThe story can still continue.");
});

test("portrait direct editing, Send commands, contextual tap/Tab completion and the guide are usable", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seed(page);
  await expect(page.locator(".top-actions .connection-pill")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Light mode", exact: true }),
  ).toHaveCount(0);
  await setEditorText(page, "Edited directly.");
  await page
    .getByRole("textbox", { name: "Story manuscript" })
    .press("Control+End");
  await page.getByRole("textbox", { name: "Story manuscript" }).press("Enter");
  await page.keyboard.insertText("Second line.");
  await expectEditor(page, "Edited directly.\nSecond line.");
  await page.getByRole("button", { name: "Undo game action" }).click();
  await expectEditor(page, initialProse);
  await page.getByRole("button", { name: "Redo game action" }).click();
  await expectEditor(page, "Edited directly.\nSecond line.");
  const input = page.getByRole("textbox", { name: "Freeform game input" });
  await input.fill("Ordinary text");
  await expect(
    page.getByRole("listbox", { name: "V-HTML input suggestions" }),
  ).toHaveCount(0);
  await input.fill("<add:");
  await page.getByRole("option", { name: "stat", exact: true }).click();
  await expect(input).toHaveValue("<add:stat: ");
  await input.fill(
    '<add: stat: id: "direct-money" name: "Money" type: integer default: 20>',
  );
  await page.getByRole("button", { name: "Send", exact: true }).click();
  expect(
    (await currentStory(page)).vgame.objects.find(
      (o: any) => o.id === "direct-money",
    ).value,
  ).toBe(20);
  await expectEditor(page, "Edited directly.\nSecond line.");
  await source(page, "");
  const cm = page.getByRole("textbox", { name: "V-HTML source", exact: true });
  await cm.click();
  await page.keyboard.insertText("<ad");
  await expect(
    page.getByRole("listbox", { name: "V-HTML command completions" }),
  ).toBeVisible();
  await cm.press("Tab");
  await expect(cm).toContainText("<add:");
  await page
    .getByRole("listbox", { name: "V-HTML command completions" })
    .getByRole("option", { name: "stat", exact: true })
    .click();
  await expect(cm).toContainText("stat:");
  const command = page.getByRole("textbox", {
    name: "V-HTML command input",
    exact: true,
  });
  await command.fill('<set: stat: "direct-money" value: 30>');
  await page.getByRole("button", { name: "Send V-HTML", exact: true }).click();
  expect(
    (await currentStory(page)).vgame.objects.find(
      (o: any) => o.id === "direct-money",
    ).value,
  ).toBe(30);
  await page.getByText("V-HTML guide & examples", { exact: true }).click();
  await expect(page.locator(".vgame-guide")).toContainText(
    "UI, panel ve widget",
  );
  await closeTools(page);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: info.outputPath("vgame-green-mobile.png") });
});

test("a choice clears its alternatives, changes page, continues once and restores the decision with Undo", async ({
  page,
}) => {
  const api = controlledGame();
  await page.route(`${endpoint}/**`, (route) => api.handle(route));
  await seed(page);
  await apply(
    page,
    '<config: choice-new-page: true><option: id: "a" name: "Ask" group: "door" result: <page: append><ai: mode: react instruction: "Answer the question.">><option: id: "b" name: "Leave" group: "door" result: <page: append><ai>>',
  );
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await idle(page);
  const story = await currentStory(page);
  expect(api.sent).toHaveLength(1);
  expect(story.vgame.pages).toHaveLength(2);
  expect(story.vgame.pages[0].text).toBe(initialProse);
  await expectEditor(page, " The clock struck noon.");
  await expect(
    page.getByRole("button", { name: "Leave", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Undo game action" }).click();
  await page.getByRole("button", { name: "Undo game action" }).click();
  await expectEditor(page, initialProse);
  await expect(
    page.getByRole("button", { name: "Ask", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Leave", exact: true }),
  ).toBeEnabled();
});

test("Generate opens a page atomically and cancellation leaves the prior manuscript intact", async ({
  page,
}) => {
  const api = controlledGame();
  await page.route(`${endpoint}/**`, (route) => api.handle(route));
  await seed(page);
  await apply(page, "<config: generation-new-page: true>");
  await page.getByRole("button", { name: "Generate", exact: true }).click();
  await idle(page);
  expect((await currentStory(page)).vgame.pages).toHaveLength(2);
  await expectEditor(page, " The clock struck noon.");
  await page.getByRole("button", { name: "Undo game action" }).click();
  expect((await currentStory(page)).vgame.pages).toHaveLength(1);
  await expectEditor(page, initialProse);
  api.hold();
  await page.getByRole("button", { name: "Generate", exact: true }).click();
  await expect.poll(() => api.sent.length).toBe(2);
  await page.getByRole("button", { name: "Stop AI", exact: true }).click();
  api.release();
  await idle(page);
  expect((await currentStory(page)).vgame.pages).toHaveLength(1);
  await expectEditor(page, initialProse);
});

test("valid Unicode checkpoint files above 25 MiB round-trip while archived pages stay out of the writing DOM", async ({
  page,
}) => {
  await seed(page);
  const base = (await currentStory(page)).vgame;
  const archivedText = ("漢".repeat(79) + "\n").repeat(18750);
  const project = {
    ...base,
    pages: [
      ...base.pages,
      ...Array.from({ length: 6 }, (_, index) => ({
        id: `archive-${index}`,
        title: `Archive ${index + 1}`,
        text: archivedText,
        summary: "",
        persistent: true,
        created: Date.now(),
      })),
    ],
  };
  const payload = Buffer.from(
    JSON.stringify({ format: "vchat-vgame-checkpoint", version: 1, project }),
    "utf8",
  );
  expect(payload.byteLength).toBeGreaterThan(25 * 1024 * 1024);
  expect(payload.byteLength).toBeLessThan(128 * 1024 * 1024);
  await tab(page, "History");
  await page.getByLabel("Game checkpoint JSON").setInputFiles({
    name: "unicode-archives.json",
    mimeType: "application/json",
    buffer: payload,
  });
  const dialog = page.getByRole("dialog", { name: "Confirm game change" });
  await expect(dialog).toContainText("archive-0");
  await dialog
    .getByRole("button", { name: "Confirm change", exact: true })
    .click();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  const downloadEvent = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export checkpoint", exact: true })
    .click();
  const downloaded = await downloadEvent;
  const exported = JSON.parse(
    await readFile((await downloaded.path())!, "utf8"),
  );
  expect(exported.project.pages).toHaveLength(7);
  expect(exported.project.activePageId).toBe(base.activePageId);
  expect(
    exported.project.pages.slice(1).map((item: any) => item.text.length),
  ).toEqual(Array(6).fill(1_500_000));
  expect(exported.project.pages[6].text.slice(-3)).toBe("漢漢\n");
  await closeTools(page);
  await expectEditor(page, initialProse);
  expect((await editorState(page))!.renderedLines).toBeLessThan(20);
  await page.reload();
  await expect(page.locator(".vgame-workspace")).toBeVisible();
  await expectEditor(page, initialProse);
  const summary = await page.evaluate(async () => {
    const path = "/src/store.ts";
    const { useStore } = await import(path);
    const state = useStore.getState(),
      story = state.stories.find((item: any) => item.id === state.current);
    return {
      pages: story.vgame.pages.length,
      archiveLengths: story.vgame.pages
        .slice(1)
        .map((item: any) => item.text.length),
      original: story.text,
    };
  });
  expect(summary).toEqual({
    pages: 7,
    archiveLengths: Array(6).fill(1_500_000),
    original: initialProse,
  });
});
