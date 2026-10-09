import { test, expect, type Page } from "@playwright/test";
import { expectEditor, setEditorText } from "./editor";

async function state(page: Page) {
  return page.evaluate(async () => {
    const path = "/src/store.ts";
    const { useStore } = await import(path);
    const s = useStore.getState();
    await s.flush();
    return { books: s.lorebooks, stories: s.stories, current: s.current };
  });
}
async function selectStory(page: Page, id: string) {
  await page.evaluate(async (id) => {
    const path = "/src/store.ts";
    const { useStore } = await import(path);
    useStore.getState().select(id);
  }, id);
}
async function openImport(page: Page) {
  await openLore(page);
  await page
    .locator("summary")
    .filter({ hasText: /^Import lorebook$/ })
    .click();
}
async function openLore(page: Page) {
  if (
    !(await page
      .getByRole("heading", { name: "Lorebook", exact: true })
      .isVisible())
  )
    await page.getByRole("button", { name: "Lorebook", exact: true }).click();
}
const book = {
  name: "City guide",
  entries: {
    0: {
      key: ["Mira"],
      content: "Mira is an architect in Tokyo.",
      comment: "Mira",
      matchWholeWords: true,
    },
  },
};

test("large lorebooks paginate editing without dropping entries from export or context", async ({
  page,
}) => {
  const large = {
    name: "Large book",
    entries: Array.from({ length: 45 }, (_, i) => ({
      name: `Entry ${i + 1}`,
      keys: [`key${i + 1}`],
      content: `Fact ${i + 1}`,
    })),
  };
  await page.goto("/");
  await openImport(page);
  await page.getByLabel("Lorebook JSON").setInputFiles({
    name: "large.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(large)),
  });
  await page
    .getByRole("button", { name: "Add to library", exact: true })
    .click();
  await expect(page.getByLabel("Title", { exact: true })).toHaveCount(20);
  await page.getByRole("button", { name: "Next lore entries" }).click();
  await expect(page.getByLabel("Title", { exact: true }).first()).toHaveValue(
    "Entry 21",
  );
  await page.getByLabel("Search lore entries").fill("Entry 44");
  await expect(page.getByLabel("Title", { exact: true })).toHaveCount(1);
  await page.getByLabel("Content", { exact: true }).fill("Updated fact 44");
  expect((await state(page)).books[0].entries).toHaveLength(45);
  await setEditorText(page, "key45");
  const activation = await page.evaluate(async () => {
    const storePath = "/src/store.ts",
      promptPath = "/src/context/promptBuilder.ts";
    const { useStore } = await import(storePath);
    const { buildPrompt } = await import(promptPath);
    const s = useStore.getState();
    return buildPrompt(
      s.stories.find((x: any) => x.id === s.current),
      s.lorebooks,
    ).prompt;
  });
  expect(activation).toContain("Fact 45");
  expect((await state(page)).books[0].entries[43].content).toBe(
    "Updated fact 44",
  );
});

test("shared JSON lorebooks retain per-story activation, edits and portable exports", async ({
  page,
  context,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New", exact: true }).click();
  await setEditorText(page, "Mira waited.");
  await openImport(page);
  await page.getByLabel("Lorebook JSON", { exact: true }).setInputFiles({
    name: "world.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(book)),
  });
  await expect(
    page.getByRole("region", { name: "Lorebook import preview" }),
  ).toContainText("City guide");
  expect((await state(page)).books).toHaveLength(0);
  await page
    .getByRole("button", { name: "Add to library", exact: true })
    .click();
  await expect(page.getByLabel("Active for this story")).toBeChecked();
  const first = await state(page);
  const a = first.current;
  const bookId = first.books[0].id;
  await page.getByRole("button", { name: "New", exact: true }).click();
  await setEditorText(page, "Mira smiled.");
  await openLore(page);
  await expect(page.getByLabel("Lorebook to edit")).toHaveValue(bookId);
  await expect(page.getByLabel("Active for this story")).not.toBeChecked();
  const b = (await state(page)).current;
  await page.getByLabel("Active for this story").check();
  await page
    .getByLabel("Content", { exact: true })
    .fill("Mira is an architect in Kyoto.");
  await selectStory(page, a);
  await expect(page.getByLabel("Content", { exact: true })).toHaveValue(
    "Mira is an architect in Kyoto.",
  );
  await page.getByLabel("Active for this story").uncheck();
  const saved = await state(page);
  expect(saved.stories.find((s) => s.id === a)?.activeLorebooks).toEqual([]);
  expect(saved.stories.find((s) => s.id === b)?.activeLorebooks).toEqual([
    bookId,
  ]);
  await page.reload();
  await selectStory(page, a);
  await page.getByRole("button", { name: "Lorebook", exact: true }).click();
  await expect(page.getByLabel("Active for this story")).not.toBeChecked();
  await selectStory(page, b);
  await expect(page.getByLabel("Active for this story")).toBeChecked();
  const exported = await page.evaluate(async () => {
    const storePath = "/src/store.ts",
      transferPath = "/src/storage/transfer.ts";
    const { useStore } = await import(storePath);
    const { exportProject } = await import(transferPath);
    const store = useStore.getState();
    return exportProject(
      store.stories.find((s: any) => s.id === store.current),
      store.lorebooks,
    );
  });
  expect(JSON.parse(exported).story.lorebookCopies).toHaveLength(1);
  // A fresh browser has no shared library; the portable story restores its books.
  const fresh = await context.browser()!.newContext();
  try {
    const other = await fresh.newPage();
    await other.goto("http://127.0.0.1:5173/");
    await other.getByRole("textbox", { name: "Story manuscript" }).waitFor();
    await other.evaluate(async (raw) => {
      const storePath = "/src/store.ts",
        transferPath = "/src/storage/transfer.ts";
      const { useStore } = await import(storePath);
      const { importProject } = await import(transferPath);
      useStore.getState().add(importProject(raw));
      await useStore.getState().flush();
    }, exported);
    await expectEditor(other, "Mira smiled.");
    await other.getByRole("button", { name: "Lorebook", exact: true }).click();
    await expect(other.getByLabel("Active for this story")).toBeChecked();
    await expect(other.getByLabel("Content", { exact: true })).toHaveValue(
      "Mira is an architect in Kyoto.",
    );
  } finally {
    await fresh.close();
  }
  await page.screenshot({ path: "test-results/lorebooks-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByLabel("Active for this story").scrollIntoViewIfNeeded();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "test-results/lorebooks-mobile.png" });
});

test("legacy lore migration preserves old text and history and commits only once", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("textbox", { name: "Story manuscript" }).waitFor();
  await page.evaluate(async () => {
    const storePath = "/src/store.ts",
      storagePath = "/src/storage/stories.ts",
      typesPath = "/src/types.ts";
    const { useStore } = await import(storePath);
    const { storage } = await import(storagePath);
    const { newStory, newLore } = await import(typesPath);
    await useStore.getState().flush();
    for (const s of useStore.getState().stories) await storage.remove(s.id);
    const s = newStory();
    s.id = "legacy-story";
    s.title = "Legacy city";
    s.text = "Mira arrived. She smiled.";
    s.past = ["Mira arrived."];
    s.lore = [
      {
        ...newLore(),
        title: "Mira",
        keywords: "Mira",
        content: "Preserved old fact.",
      },
    ];
    delete s.continuationCleanupVersion;
    s.settings.trimIncomplete = false;
    await storage.save(s);
    await storage.setPref("lorebooks", []);
  });
  await page.reload();
  await expectEditor(page, "Mira arrived. She smiled.");
  let migrated = await state(page);
  expect(migrated.books).toHaveLength(1);
  expect(migrated.books[0].id).toBe("legacy:legacy-story");
  expect(migrated.stories[0].lore).toEqual([]);
  expect(migrated.stories[0].activeLorebooks).toEqual([migrated.books[0].id]);
  expect(migrated.stories[0].settings.trimIncomplete).toBe(true);
  await page.reload();
  expect((await state(page)).books).toHaveLength(1);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expectEditor(page, "Mira arrived.");
  await page.getByRole("button", { name: "Lorebook", exact: true }).click();
  await expect(page.getByLabel("Content", { exact: true })).toHaveValue(
    "Preserved old fact.",
  );
});

test("Chub links preview repository data; failures preserve the shared library", async ({
  page,
}) => {
  const urls: string[] = [];
  await page.route("https://api.chub.ai/**", (route) => {
    const url = route.request().url();
    urls.push(url);
    expect(route.request().headers().authorization).toBeUndefined();
    expect(route.request().headers().cookie).toBeUndefined();
    if (url.includes("missing"))
      return route.fulfill({ status: 404, json: {} });
    return route.fulfill({
      json: url.includes("/api/v4/")
        ? { ...book, entries: { 0: { ...book.entries[0], position: 4 } } }
        : { node: { id: 123 } },
    });
  });
  await page.goto("/");
  await openImport(page);
  await page.getByLabel("Lorebook link").fill("chub.ai/lorebooks/user/city");
  await page
    .getByRole("button", { name: "Fetch lorebook", exact: true })
    .click();
  const preview = page.getByRole("region", { name: "Lorebook import preview" });
  await expect(preview).toContainText("City guide");
  await expect(preview).toContainText("insertion positions");
  expect(urls).toEqual([
    "https://api.chub.ai/api/lorebooks/user/city",
    "https://api.chub.ai/api/v4/projects/123/repository/files/raw%252Fsillytavern_raw.json/raw",
  ]);
  await page
    .getByRole("button", { name: "Add to library", exact: true })
    .click();
  await page.getByLabel("Lorebook link").fill("chub.ai/lorebooks/user/missing");
  await page
    .getByRole("button", { name: "Fetch lorebook", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("not found");
  await page.getByLabel("Lorebook JSON").setInputFiles({
    name: "bad.json",
    mimeType: "application/json",
    buffer: Buffer.from('{"entries":[{"content":42}]}'),
  });
  await expect(page.getByRole("alert")).toContainText("Invalid");
  expect((await state(page)).books).toHaveLength(1);
  await expect(page.getByLabel("Content", { exact: true })).toHaveValue(
    book.entries[0].content,
  );
});

test("shared lore reaches writing only when selected; deletion clears all stories", async ({
  page,
}) => {
  const prompts: string[] = [];
  await page.route("http://localhost:5001/**", (route) => {
    prompts.push(route.request().postDataJSON().prompt);
    return route.fulfill({
      contentType: "text/event-stream",
      body: 'data: {"token":" She smiled."}\n\n',
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "New", exact: true }).click();
  await setEditorText(page, "Mira waited.");
  await openImport(page);
  await page.getByLabel("Lorebook JSON").setInputFiles({
    name: "city.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(book)),
  });
  await page
    .getByRole("button", { name: "Add to library", exact: true })
    .click();
  await page.getByRole("button", { name: "Write", exact: true }).click();
  await expectEditor(page, "Mira waited. She smiled.");
  await expect(
    page.getByRole("button", { name: "Write", exact: true }),
  ).toBeEnabled();
  expect(prompts[0]).toContain(book.entries[0].content);
  await page.getByLabel("Active for this story").uncheck();
  await page.getByRole("button", { name: "Write", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Write", exact: true }),
  ).toBeEnabled();
  expect(prompts[1]).not.toContain(book.entries[0].content);
  await page.getByLabel("Active for this story").check();
  const a = (await state(page)).current;
  await page.getByRole("button", { name: "New", exact: true }).click();
  await openLore(page);
  await page.getByLabel("Active for this story").check();
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", { name: "Delete lorebook", exact: true })
    .click();
  const deleted = await state(page);
  expect(deleted.books).toEqual([]);
  expect(deleted.stories.find((s) => s.id === a)?.activeLorebooks).toEqual([]);
  await page.reload();
  expect((await state(page)).books).toEqual([]);
});

test("Writer's Block echoes are cleaned with atomic undo/retry and both defaults can be disabled", async ({
  page,
}) => {
  const prompts: string[] = [];
  const outputs = [
    "You walked with a quiet confidence.\n\nShe waved. Then she looked with...",
    "You walked with a steady pace.",
    "You walked with a different...",
  ];
  await page.route("http://localhost:5001/**", (route) => {
    prompts.push(route.request().postDataJSON().prompt);
    const output = outputs[prompts.length - 1];
    return route.fulfill({
      contentType: "text/event-stream",
      body: output
        .match(/.{1,5}|\n/g)!
        .map((token) => `data: ${JSON.stringify({ token })}\n\n`)
        .join(""),
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "New", exact: true }).click();
  await setEditorText(page, "You walked with a");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(
    page.getByLabel("Trim incomplete sentences", { exact: true }),
  ).toBeChecked();
  await expect(
    page.getByLabel("Trim repeated continuation prefix", { exact: true }),
  ).toBeChecked();
  await page
    .getByLabel("Writing preset", { exact: true })
    .selectOption("writers-block");
  await page
    .locator("summary")
    .filter({ hasText: /^Narrator tones/ })
    .click();
  await page.getByLabel("Smut", { exact: true }).check();
  await page.getByLabel("Erotica", { exact: true }).check();
  await page.getByRole("button", { name: "Write", exact: true }).click();
  const first = "You walked with a quiet confidence.\n\nShe waved.";
  await expectEditor(page, first);
  await expect(
    page.getByRole("button", { name: "Write", exact: true }),
  ).toBeEnabled();
  expect(prompts[0]).toContain("only the missing words");
  expect(prompts[0]).toContain("Smut:");
  expect(prompts[0]).toContain("Erotica:");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expectEditor(page, "You walked with a");
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expectEditor(page, first);
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expectEditor(page, "You walked with a steady pace.");
  await expect(
    page.getByRole("button", { name: "Write", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expectEditor(page, first);
  await page.getByLabel("Trim incomplete sentences", { exact: true }).uncheck();
  await page
    .getByLabel("Trim repeated continuation prefix", { exact: true })
    .uncheck();
  await setEditorText(page, "You walked with a");
  await state(page);
  await page.reload();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(
    page.getByLabel("Trim incomplete sentences", { exact: true }),
  ).not.toBeChecked();
  await expect(
    page.getByLabel("Trim repeated continuation prefix", { exact: true }),
  ).not.toBeChecked();
  await page.getByRole("button", { name: "Write", exact: true }).click();
  await expectEditor(page, "You walked with aYou walked with a different...");
});
