import { test, expect } from "@playwright/test";
import { setEditorText, expectEditor, editorState } from "./editor";
async function select(
  page: import("@playwright/test").Page,
  from: number,
  to: number,
) {
  await page.evaluate(
    async ({ from, to }) => {
      const path = "/src/components/ManuscriptEditor.tsx";
      const { EditorView } = await import(path);
      const view = EditorView.findFromDOM(document.querySelector(".cm-editor"));
      view.dispatch({ selection: { anchor: from, head: to } });
      view.focus();
    },
    { from, to },
  );
}

test("rewrite previews a middle passage, applies atomically and rejects stale text", async ({
  page,
}) => {
  let prompt = "";
  await page.route("http://localhost:5001/**", (route) => {
    prompt = route.request().postDataJSON().prompt;
    return route.fulfill({
      contentType: "text/event-stream",
      body: 'data: {"token":"Her meaning was clear."}\n\ndata: [DONE]\n\n',
    });
  });
  await page.goto("/");
  const original = "Start.\n\nHer sentence was unclear.\n\nEnd.";
  await setEditorText(page, original);
  const from = original.indexOf("Her"),
    to = original.indexOf("\n\nEnd");
  await select(page, from, to);
  await page
    .getByRole("button", { name: "Rewrite selection", exact: true })
    .click();
  await expect(
    page.getByLabel("Selected passage", { exact: false }),
  ).toHaveValue("Her sentence was unclear.");
  await page
    .getByLabel("Editing instruction")
    .fill("Clarify the wording. Preserve what happened.");
  await page
    .getByRole("button", { name: "Generate rewrite", exact: true })
    .click();
  await expect(page.getByLabel("Replacement preview")).toHaveValue(
    "Her meaning was clear.",
  );
  await expect(
    page.getByRole("button", { name: "Apply replacement" }),
  ).toBeEnabled();
  await expectEditor(page, original);
  expect(prompt).toContain('SELECTED PASSAGE: "Her sentence was unclear."');
  expect(prompt).toContain("Clarify the wording");
  await page.getByRole("button", { name: "Apply replacement" }).click();
  const replaced = "Start.\n\nHer meaning was clear.\n\nEnd.";
  await expectEditor(page, replaced);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expectEditor(page, original);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expectEditor(page, replaced);
  await expect(page.locator(".saved")).toHaveText("Saved");
  await page.reload();
  await expectEditor(page, replaced);
  await page.setViewportSize({ width: 390, height: 844 });
  await select(page, from, replaced.indexOf("\n\nEnd"));
  await page
    .getByRole("button", { name: "Rewrite selection", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Generate rewrite", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Apply replacement" }),
  ).toBeEnabled();
  await setEditorText(page, replaced + " Changed.");
  await page.getByRole("button", { name: "Apply replacement" }).click();
  await expect(page.getByRole("alert")).toContainText("manuscript changed");
  await expectEditor(page, replaced + " Changed.");
  await page.getByRole("button", { name: "Discard", exact: true }).click();
  await expectEditor(page, replaced + " Changed.");
});

test("OpenRouter samplers and incomplete sentence trimming persist", async ({
  page,
}) => {
  let sent: any;
  await page.route("https://openrouter.ai/api/v1/**", (route) => {
    if (route.request().method() === "GET")
      return route.fulfill({
        json: {
          data: [
            {
              id: "test/sampler",
              supported_parameters: ["top_k", "min_p", "repetition_penalty"],
            },
          ],
        },
      });
    sent = route.request().postDataJSON();
    return route.fulfill({
      contentType: "text/event-stream",
      body: 'data: {"choices":[{"delta":{"content":" Her face brightened. She looked at her with..."}}]}\n\ndata: [DONE]\n\n',
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Connection", exact: true }).click();
  await page.getByLabel("Provider", { exact: true }).selectOption("openrouter");
  await page.getByLabel("API key · saved on this device").fill("fake-key");
  await page.getByRole("button", { name: "Fetch models", exact: true }).click();
  await expect(page.getByLabel("Model", { exact: true })).toHaveValue(
    "test/sampler",
  );
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByLabel("Top K", { exact: true }).fill("37");
  await page.getByLabel("Min P", { exact: true }).fill("0.12");
  await page.getByLabel("Repetition penalty", { exact: true }).fill("1.15");
  await page.getByLabel("Trim incomplete sentences", { exact: true }).check();
  await page.getByRole("button", { name: "Close writing tools" }).click();
  await setEditorText(page, "Opening.");
  await page.getByRole("button", { name: "Write", exact: true }).click();
  await expectEditor(page, "Opening. Her face brightened.");
  expect(sent.top_k).toBe(37);
  expect(sent.min_p).toBe(0.12);
  expect(sent.repetition_penalty).toBe(1.15);
  expect(sent).not.toHaveProperty("rep_pen_range");
  expect(sent.messages[0].role).toBe("system");
  await expect(page.locator(".saved")).toHaveText("Saved");
  await page.reload();
  await expectEditor(page, "Opening. Her face brightened.");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByLabel("Min P", { exact: true })).toHaveValue("0.12");
  await expect(
    page.getByLabel("Trim incomplete sentences", { exact: true }),
  ).toBeChecked();
});

test("large history is saved compactly and remains editable after reload", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator(".cm-editor").waitFor();
  const base = "A long manuscript paragraph.\n\n".repeat(10000);
  await page.evaluate(async (base) => {
    const path = "/src/store.ts";
    const { useStore } = await import(path);
    // Vite can give this dynamic import a separate module instance after HMR.
    // Initialize that instance before using it to prepare the database fixture.
    await useStore.getState().init();
    const store = useStore.getState();
    const states = Array.from(
      { length: 80 },
      (_, i) => base + " Another sentence.".repeat(i),
    );
    store.patch({
      text: states.at(-1),
      past: states.slice(0, -1),
      segments: states.slice(1).map((after, i) => ({
        id: String(i),
        before: states[i],
        after,
        at: i,
      })),
    });
    await store.flush();
  }, base);
  const packedSize = await page.evaluate(async () => {
    const path = "/src/storage/stories.ts";
    const { storage } = await import(path);
    const stories = await storage.all();
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open("margin-writing");
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    const stored = await new Promise<any>((resolve, reject) => {
      const r = db
        .transaction("stories")
        .objectStore("stories")
        .get(stories[0].id);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    db.close();
    return { encoding: stored.encoding, size: JSON.stringify(stored).length };
  });
  expect(packedSize.encoding).toBe("delta-v1");
  expect(packedSize.size).toBeLessThan(500000);
  await page.reload();
  await expectEditor(page, base + " Another sentence.".repeat(79));
  expect((await editorState(page))!.renderedLines).toBeLessThan(200);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expectEditor(page, base + " Another sentence.".repeat(78));
  await page
    .getByRole("textbox", { name: "Story manuscript" })
    .press("Control+End");
  await page
    .getByRole("textbox", { name: "Story manuscript" })
    .pressSequentially(" More.");
  await expectEditor(page, base + " Another sentence.".repeat(78) + " More.");
});
