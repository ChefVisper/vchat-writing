import { test, expect, devices } from "@playwright/test";
import { editorState, expectEditor, setEditorText } from "./editor";

test.use({ ...devices["Pixel 7"] });

test("Android Enter and soft-keyboard line breaks create persisted paragraphs", async ({
  page,
}) => {
  await page.goto("/");
  await setEditorText(page, "First line.");
  const editor = page.getByRole("textbox", { name: "Story manuscript" });
  await expect(editor).toHaveAttribute("enterkeyhint", "enter");
  await editor.press("Control+End");
  await editor.press("Enter");
  await expectEditor(page, "First line.\n");
  await editor.press("Shift+Enter");
  await expectEditor(page, "First line.\n\n");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expectEditor(page, "First line.\n");
  await editor.pressSequentially("Second line.");
  await expectEditor(page, "First line.\nSecond line.");
  // Android keyboards may report only beforeinput, with no usable keydown.
  await page.waitForTimeout(80);
  await editor.evaluate((el) =>
    el.dispatchEvent(
      new InputEvent("beforeinput", {
        inputType: "insertParagraph",
        bubbles: true,
        cancelable: true,
      }),
    ),
  );
  await expectEditor(page, "First line.\nSecond line.\n");
  await page.waitForTimeout(80);
  await editor.evaluate((el) =>
    el.dispatchEvent(
      new InputEvent("beforeinput", {
        inputType: "insertLineBreak",
        bubbles: true,
        cancelable: true,
      }),
    ),
  );
  await expectEditor(page, "First line.\nSecond line.\n\n");
  await editor.pressSequentially("Third paragraph.");
  await expectEditor(page, "First line.\nSecond line.\n\nThird paragraph.");
  await expect
    .poll(async () => (await editorState(page))?.renderedLines)
    .toBe(4);
  await expect(page.locator(".saved")).toHaveText("Saved");
  await page.reload();
  await expectEditor(page, "First line.\nSecond line.\n\nThird paragraph.");
});

test("streamed AI paragraphs retain visible line breaks and undo as one passage", async ({
  page,
}) => {
  let prompt = "";
  let release!: () => void;
  const ready = new Promise<void>((resolve) => (release = resolve));
  const chunks = [
    " a quiet smile.",
    '\n\n"Come in," she said.',
    '\n\n"Thank you," he replied.',
  ];
  await page.route("http://localhost:5001/**", async (route) => {
    prompt = route.request().postDataJSON().prompt;
    await ready;
    return route.fulfill({
      contentType: "text/event-stream",
      body:
        chunks
          .map((token) => `data: ${JSON.stringify({ token })}\n\n`)
          .join("") + "data: [DONE]\n\n",
    });
  });
  await page.goto("/");
  const before = "She looked at her with";
  await setEditorText(page, before);
  await page.getByRole("button", { name: "Write", exact: true }).click();
  await expect(page.locator(".document-status")).toContainText("Writing");
  const editor = page.getByRole("textbox", { name: "Story manuscript" });
  await editor.press("Enter");
  await editor.press("Shift+Enter");
  await expectEditor(page, before);
  release();
  await expectEditor(page, before + chunks.join(""));
  await expect(
    page.getByRole("button", { name: "Write", exact: true }),
  ).toBeEnabled();
  await expect(page.locator(".cm-line")).toHaveCount(5);
  expect(prompt).toContain("complete it naturally");
  expect(prompt).toContain("Finish your own final sentence naturally");
  expect(prompt).toContain("actual line breaks");
  expect(prompt.endsWith(before)).toBe(true);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expectEditor(page, before);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expectEditor(page, before + chunks.join(""));
  await expect(page.locator(".saved")).toHaveText("Saved");
  await page.reload();
  await expectEditor(page, before + chunks.join(""));
});
