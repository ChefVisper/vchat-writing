import { expect, test } from "@playwright/test";
import { expectEditor, editorValue } from "./editor";

const card = {
  node: {
    definition: {
      name: "Mira",
      personality: "{{char}} is a librarian.",
      tavern_personality: "Quiet.",
      scenario: "A quiet library.",
      first_message: "Mira opened the door.",
      alternate_greetings: ["Mira waved from her desk.", "A book fell."],
      system_prompt: "Use short dialogue.",
      post_history_instructions: "Stay in the library.",
      description: "Creator notes.",
      embedded_lorebook: {
        entries: [
          {
            name: "Library",
            content: "Built in 1980.",
            keys: ["library"],
            constant: true,
          },
        ],
      },
    },
  },
};

test("Chub link import previews complete context; greetings preserve shared state and the original manuscript", async ({
  page,
}) => {
  let path = "",
    fail = false;
  await page.route("https://api.chub.ai/**", (route) => {
    path = route.request().url();
    return fail
      ? route.fulfill({ status: 404, json: { error: "not found" } })
      : route.fulfill({ json: card });
  });
  await page.goto("/");
  await page.locator(".cm-editor").waitFor();
  const original = await editorValue(page);
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await page
    .locator("summary")
    .filter({ hasText: /^Import character$/ })
    .click();
  await page
    .getByLabel("Character link", { exact: true })
    .fill("chub.ai/creator/mira");
  await page
    .getByRole("button", { name: "Import from link", exact: true })
    .click();
  await expect(page.getByLabel("Created title")).toHaveValue("Mira");
  expect(path).toBe(
    "https://api.chub.ai/api/characters/creator/mira?full=true",
  );
  await expect(page.getByLabel("Created Memory")).toHaveValue(
    /{{char}} is a librarian/,
  );
  await page
    .locator("summary")
    .filter({ hasText: /^Alternate greetings/ })
    .click();
  await expect(
    page.getByLabel("Alternate greeting 1", { exact: true }),
  ).toHaveValue("Mira waved from her desk.");
  await page
    .locator("summary")
    .filter({ hasText: /^Imported context/ })
    .click();
  await expect(page.getByLabel("Imported Author's note")).toHaveValue(
    "Use short dialogue.\n\nStay in the library.",
  );
  fail = true;
  await page
    .getByRole("button", { name: "Import from link", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("not found");
  await expect(page.getByLabel("Starting text", { exact: true })).toHaveValue(
    "Mira opened the door.",
  );
  await page.reload();
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.getByLabel("Created title")).toHaveValue("Mira");
  await page.getByRole("button", { name: "Create story", exact: true }).click();
  await expectEditor(page, "Mira opened the door.");
  await page.getByRole("button", { name: "Memory", exact: true }).click();
  await expect(page.getByLabel("Author's note", { exact: true })).toHaveValue(
    "Use short dialogue.\n\nStay in the library.",
  );
  await page.getByRole("button", { name: "Lorebook", exact: true }).click();
  await expect(page.getByLabel("Content", { exact: true })).toHaveValue(
    "Built in 1980.",
  );
  await page.getByRole("button", { name: "Notebook", exact: true }).click();
  await expect(page.getByLabel("Creative notes", { exact: true })).toHaveCount(
    0,
  );
  await page.getByRole("button", { name: "Add note", exact: true }).click();
  await page.getByLabel("Note title").fill("Scene");
  await page.getByLabel("Creative notes", { exact: true }).check();
  await page.getByLabel("Scene content", { exact: true }).fill("Morning.");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByLabel("Writing Output (tokens)", { exact: true }).fill("150");
  await page.getByRole("button", { name: "Greetings", exact: true }).click();
  await page
    .getByLabel("Choose greeting")
    .selectOption({ label: "Greeting 2" });
  await expect(page.getByLabel("Greeting text")).toHaveValue(
    "Mira waved from her desk.",
  );
  await page
    .getByRole("button", { name: "Start with this greeting", exact: true })
    .click();
  await expectEditor(page, "Mira waved from her desk.");
  await page.getByRole("button", { name: "Notebook", exact: true }).click();
  await expect(page.getByLabel("Scene content", { exact: true })).toHaveValue(
    "Morning.",
  );
  await page.getByRole("button", { name: "Options", exact: true }).click();
  await expect(
    page.getByLabel("Creative notes", { exact: true }),
  ).toBeChecked();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(
    page.getByLabel("Writing Output (tokens)", { exact: true }),
  ).toHaveValue("150");
  await page.getByRole("button", { name: "My stories", exact: true }).click();
  await expect(page.locator(".story-card")).toHaveCount(3);
  await page
    .locator(".story-card")
    .filter({ has: page.getByRole("heading", { name: "Mira", exact: true }) })
    .locator(".story-open")
    .click();
  await expectEditor(page, "Mira opened the door.");
  expect(original).not.toBe("Mira opened the door.");
  await page
    .getByRole("button", { name: "Close writing tools", exact: true })
    .click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Greetings", exact: true }).click();
  await page.getByRole("button", { name: "Add greeting", exact: true }).click();
  await page
    .getByLabel("Greeting text")
    .fill("An opening on mobile.\n\nHello.");
  await page.screenshot({
    path: "test-results/greetings-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("character JSON import and selecting an alternate opening work without an AI connection", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await page
    .locator("summary")
    .filter({ hasText: /^Import character$/ })
    .click();
  await page.getByLabel("Character card JSON").setInputFiles({
    name: "character.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({
        spec: "chara_card_v2",
        data: {
          name: "Alex",
          description: "A quiet musician.",
          first_mes: "",
          alternate_greetings: ["Alex tuned the guitar."],
        },
      }),
    ),
  });
  await expect(page.getByLabel("Created title")).toHaveValue("Alex");
  await page
    .locator("summary")
    .filter({ hasText: /^Alternate greetings/ })
    .click();
  await page
    .getByRole("button", { name: "Use greeting 1 as opening", exact: true })
    .click();
  await page.getByRole("button", { name: "Create story", exact: true }).click();
  await expectEditor(page, "Alex tuned the guitar.");
});

test("creative notes send the permissive mode and preserve review until accepted", async ({
  page,
}) => {
  let prompt = "";
  await page.route("http://localhost:5001/**", (route) => {
    const body = route.request().postDataJSON();
    prompt = body.prompt;
    const notes = JSON.parse(
      prompt.split("NOTES:\n")[1].split("\n\nNEW PROSE:")[0],
    );
    return route.fulfill({
      json: {
        results: [
          {
            text: JSON.stringify({
              updates: [
                {
                  noteId: notes.find((n: any) => n.creative).noteId,
                  newContent: "A quiet, patient librarian.",
                },
              ],
            }),
          },
        ],
      },
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "New", exact: true }).click();
  await page.getByRole("button", { name: "Notebook", exact: true }).click();
  await page.getByRole("button", { name: "Add note", exact: true }).click();
  await page.getByLabel("Note title").fill("Personality");
  await page.getByLabel("Creative notes", { exact: true }).check();
  await page.getByRole("button", { name: "Add note", exact: true }).click();
  await page.getByLabel("Note title").last().fill("Evidence only");
  await expect(
    page.getByLabel("Creative notes", { exact: true }),
  ).not.toBeChecked();
  await page.getByRole("button", { name: "Note", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Accept all", exact: true }),
  ).toBeVisible();
  expect(prompt).toContain("NOTE MODE: PER NOTE");
  expect(prompt).not.toContain("Use only the supplied prose as evidence.");
  const sentNotes = JSON.parse(
    prompt.split("NOTES:\n")[1].split("\n\nNEW PROSE:")[0],
  );
  expect(sentNotes.map((n: any) => [n.title, n.creative])).toEqual([
    ["Personality", true],
    ["Evidence only", false],
  ]);
  await expect(
    page.getByLabel("Evidence only content", { exact: true }),
  ).toHaveValue("");
  await expect(
    page.getByLabel("Personality content", { exact: true }),
  ).toHaveValue("");
  await page.getByRole("button", { name: "Accept all", exact: true }).click();
  await expect(
    page.getByLabel("Personality content", { exact: true }),
  ).toHaveValue("A quiet, patient librarian.");
  await page.reload();
  await page.getByRole("button", { name: "Notebook", exact: true }).click();
  const personality = page
    .locator(".note-card")
    .filter({ has: page.getByLabel("Personality content", { exact: true }) });
  await personality
    .getByRole("button", { name: "Options", exact: true })
    .click();
  await expect(
    personality.getByLabel("Creative notes", { exact: true }),
  ).toBeChecked();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByLabel("Creative notes", { exact: true })).toHaveCount(
    0,
  );
});
