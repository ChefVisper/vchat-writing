import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import {
  editorValue,
  editorState,
  expectEditor,
  setEditorText,
} from "./editor";

test("independent models, output budgets, thinking and local credentials", async ({
  page,
}) => {
  const writing: any[] = [],
    notes: any[] = [];
  await page.route("https://openrouter.ai/api/v1/**", async (route) => {
    const body = route.request().postDataJSON();
    const request = {
      ...body,
      authorization: route.request().headers().authorization,
    };
    if (body.stream) {
      writing.push(request);
      return route.fulfill({
        contentType: "text/event-stream",
        body: 'data: {"choices":[{"delta":{"content":" The door opened."}}]}\n\ndata: [DONE]\n\n',
      });
    }
    notes.push(request);
    const noteId = JSON.parse(
      body.messages[0].content.split("NOTES:\n")[1].split("\n\nNEW PROSE:")[0],
    )[0].noteId;
    const json = JSON.stringify({
      updates: [
        { noteId, newContent: `The door is open. Check ${notes.length}.` },
      ],
    });
    return route.fulfill({
      json: {
        choices: [
          {
            message: {
              content: `<think>Check consistency.</think>\nHere are the notes:\n\x60\x60\x60json\n${json}\n\x60\x60\x60`,
            },
            finish_reason: "stop",
          },
        ],
      },
    });
  });
  await page.goto("/");
  const editor = page.getByRole("textbox", { name: "Story manuscript" });
  await editor.fill("The room was quiet.");
  await page.getByRole("button", { name: "AI", exact: true }).click();
  await page.getByLabel("Provider", { exact: true }).selectOption("openrouter");
  await page.getByLabel("Model", { exact: true }).fill("test/writer");
  await page
    .getByLabel("API key · saved on this device")
    .fill("writing-test-key");
  await page.getByRole("button", { name: "Notes connection" }).click();
  await page.getByLabel("Note connection mode").selectOption("separate");
  await page.getByLabel("Model", { exact: true }).fill("test/note");
  await page.getByLabel("API key · saved on this device").fill("note-test-key");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByLabel("Writing Output (tokens)").fill("444");
  await page.getByLabel("Note Output (tokens)").fill("2222");
  await page.getByLabel("Writing Thinking", { exact: true }).check();
  await page.getByLabel("Writing Thinking level").selectOption("medium");
  await page.getByRole("button", { name: "Close writing tools" }).click();
  await page.getByRole("button", { name: "Write", exact: true }).click();
  await expectEditor(page, "The room was quiet. The door opened.");
  await expect(
    page.getByRole("button", { name: "Write", exact: true }),
  ).toBeEnabled();
  expect(notes).toHaveLength(0);
  expect(writing[0]).toMatchObject({
    model: "test/writer",
    max_tokens: 444,
    authorization: "Bearer writing-test-key",
    reasoning: { enabled: true, effort: "medium" },
  });
  await page.getByRole("button", { name: "Note", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("ready for review");
  expect(notes[0]).toMatchObject({
    model: "test/note",
    max_tokens: 2222,
    authorization: "Bearer note-test-key",
    reasoning: { enabled: false },
  });
  await expectEditor(page, "The room was quiet. The door opened.");
  await page.getByRole("button", { name: "Notebook", exact: true }).click();
  await page.getByRole("button", { name: "Accept all", exact: true }).click();
  await page.keyboard.press("Control+s");
  await page.reload();
  await page.getByRole("button", { name: "AI", exact: true }).click();
  await expect(page.getByLabel("API key · saved on this device")).toHaveValue(
    "writing-test-key",
  );
  await page.getByRole("button", { name: "Notes connection" }).click();
  await expect(page.getByLabel("API key · saved on this device")).toHaveValue(
    "note-test-key",
  );
  await page.getByLabel("Note connection mode").selectOption("model");
  await page.getByRole("button", { name: "Note", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Note", exact: true }),
  ).toBeEnabled();
  expect(notes[1]).toMatchObject({
    model: "test/note",
    authorization: "Bearer writing-test-key",
  });
  await page.getByRole("button", { name: "Notebook", exact: true }).click();
  await page.getByRole("button", { name: "Accept all", exact: true }).click();
  await page.getByRole("button", { name: "AI", exact: true }).click();
  await page.getByRole("button", { name: "Notes connection" }).click();
  await page.getByLabel("Note connection mode").selectOption("same");
  await page.getByRole("button", { name: "Note", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Note", exact: true }),
  ).toBeEnabled();
  expect(notes[2]).toMatchObject({
    model: "test/writer",
    authorization: "Bearer writing-test-key",
  });
  await page.getByRole("button", { name: "Save / Load", exact: true }).click();
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "Full project", exact: true }).click();
  const file = await downloaded;
  const project = await readFile((await file.path())!, "utf8");
  expect(project).not.toContain("writing-test-key");
  expect(project).not.toContain("note-test-key");
});

test("stopping a live stream keeps partial prose and submits it to notes", async ({
  page,
}) => {
  let notePrompt = "";
  const server = createServer((req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      if (req.url?.endsWith("/generate/stream")) {
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        res.write('data: {"token":" A partial passage."}\n\n');
        return;
      }
      res.setHeader("Content-Type", "application/json");
      if (req.url?.endsWith("/generate")) {
        notePrompt = JSON.parse(raw).prompt;
        res.end(JSON.stringify({ results: [{ text: '{"updates":[]}' }] }));
      } else res.end('{"success":true}');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const port = (server.address() as { port: number }).port;
    await page.goto("/");
    await page.getByRole("button", { name: "AI", exact: true }).click();
    await page.getByLabel("Server URL").fill(`http://127.0.0.1:${port}`);
    await page.getByRole("button", { name: "Close writing tools" }).click();
    const before = await editorValue(page);
    await page.getByRole("button", { name: "Continue", exact: false }).click();
    await expectEditor(page, before + " A partial passage.");
    await page
      .getByRole("button", { name: "Stop writing", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Continue", exact: false }),
    ).toBeEnabled();
    expect(notePrompt).toContain("A partial passage.");
    await expectEditor(page, before + " A partial passage.");
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expectEditor(page, before);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("Stop writing advances to notes; Stop notes ends the run on portrait mobile", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let releaseWriting!: () => void, releaseNotes!: () => void;
  const writingGate = new Promise<void>(
    (resolve) => (releaseWriting = resolve),
  );
  const notesGate = new Promise<void>((resolve) => (releaseNotes = resolve));
  let noteStarted = false;
  await page.route("http://localhost:5001/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/abort"))
      return route.fulfill({ json: { success: true } });
    if (path.endsWith("/generate/stream")) {
      await writingGate;
      return route
        .fulfill({
          contentType: "text/event-stream",
          body: 'data: {"token":" unwanted"}\n\n',
        })
        .catch(() => {});
    }
    noteStarted = true;
    await notesGate;
    return route
      .fulfill({ json: { results: [{ text: '{"updates":[]}' }] } })
      .catch(() => {});
  });
  await page.goto("/");
  const editor = page.getByRole("textbox", { name: "Story manuscript" });
  await expect(editor).toBeVisible();
  const before = await editorValue(page);
  await page.getByRole("button", { name: "Continue", exact: false }).click();
  await expect(page.locator(".document-status")).toBeVisible();
  await expect(page.locator(".document-status")).toContainText("Writing");
  await page.getByRole("button", { name: "Stop writing", exact: true }).click();
  await expect.poll(() => noteStarted).toBe(true);
  await expect(page.locator(".document-status")).toContainText(
    "Updating notes",
  );
  await page.getByRole("button", { name: "Stop notes", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Continue", exact: false }),
  ).toBeEnabled();
  releaseWriting();
  releaseNotes();
  await expectEditor(page, before);
  await expect(page.locator(".document-status")).toContainText("words");
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("a large manuscript remains editable and the latest AI block can be selected", async ({
  page,
}) => {
  await page.route("http://localhost:5001/**", (route) =>
    route.fulfill({
      contentType: "text/event-stream",
      body: 'data: {"token":" A new passage."}\n\n',
    }),
  );
  await page.goto("/");
  const editor = page.getByRole("textbox", { name: "Story manuscript" });
  const text = "A long manuscript paragraph.\n\n".repeat(10000);
  await setEditorText(page, text);
  expect((await editorState(page))!.renderedLines).toBeLessThan(200);
  await page.getByRole("button", { name: "Write", exact: true }).click();
  await expectEditor(page, text + " A new passage.");
  await expect(
    page.getByRole("button", { name: "Write", exact: true }),
  ).toBeEnabled();
  await page.locator(".cm-line").last().click();
  await expect(page.locator(".latest-ai-passage")).toContainText(
    "A new passage.",
  );
  const colors = await page.locator(".latest-ai-passage").evaluate((el) => ({
    text: getComputedStyle(el).color,
    surrounding: getComputedStyle(el.parentElement!).color,
    background: getComputedStyle(el).backgroundColor,
  }));
  expect(colors.text).not.toBe(colors.surrounding);
  expect(colors.background).toBe("rgba(0, 0, 0, 0)");
  await editor.press("ArrowRight");
  await editor.pressSequentially(" More.");
  await expectEditor(page, text + " A new passage. More.");
  await editor.press("Control+z");
  await expectEditor(page, text + " A new passage.");
  await editor.press("Control+Shift+z");
  await expectEditor(page, text + " A new passage. More.");
});
