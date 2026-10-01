import { expect, type Page } from "@playwright/test";

export async function editorState(page: Page) {
  return page.evaluate(async () => {
    const path = "/src/components/ManuscriptEditor.tsx";
    const { EditorView } = await import(path);
    const element = document.querySelector(".cm-editor");
    const view = element ? EditorView.findFromDOM(element) : null;
    if (!view) return null;
    return {
      value: view.state.doc.toString(),
      scrollTop: view.scrollDOM.scrollTop,
      scrollHeight: view.scrollDOM.scrollHeight,
      clientHeight: view.scrollDOM.clientHeight,
      selectionStart: view.state.selection.main.from,
      selectionEnd: view.state.selection.main.to,
      renderedLines: view.contentDOM.querySelectorAll(".cm-line").length,
    };
  });
}
export async function editorValue(page: Page) {
  return (await editorState(page))?.value ?? "";
}
export async function expectEditor(
  page: Page,
  expected: string | RegExp,
  negative = false,
) {
  await expect
    .poll(async () => {
      const value = await editorValue(page);
      return typeof expected === "string"
        ? value === expected
        : expected.test(value);
    })
    .toBe(!negative);
}
export async function setEditorText(page: Page, value: string) {
  await page.locator(".cm-editor").waitFor();
  await page.evaluate(async (value) => {
    const path = "/src/components/ManuscriptEditor.tsx";
    const { EditorView } = await import(path);
    const view = EditorView.findFromDOM(document.querySelector(".cm-editor"));
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: value },
    });
  }, value);
}
