import { test, expect } from "@playwright/test";
import { expectEditor, editorValue } from "./editor";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=",
  "base64",
);
test("text-only creation stop cancels native generation and keeps the previous preview", async ({
  page,
}) => {
  let hold = false,
    abortCount = 0,
    release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  await page.route("http://localhost:5001/**", async (route) => {
    if (route.request().url().endsWith("/abort")) {
      abortCount++;
      return route.fulfill({ json: { success: true } });
    }
    if (hold) {
      await gate;
      await route
        .fulfill({ json: { results: [{ text: "unwanted" }] } })
        .catch(() => {});
      return;
    }
    return route.fulfill({
      json: {
        results: [
          {
            text: JSON.stringify({
              title: "A scene",
              memory: "{{char}} is a librarian.",
              startingText: "The library was quiet.",
            }),
          },
        ],
      },
    });
  });
  try {
    await page.goto("/");
    await page.getByRole("button", { name: "Create", exact: true }).click();
    await page
      .getByLabel("Character / scenario brief")
      .fill("A quiet library scene.");
    await page
      .getByRole("button", { name: "Generate memory & opening", exact: true })
      .click();
    await expect(page.getByLabel("Starting text", { exact: true })).toHaveValue(
      "The library was quiet.",
    );
    hold = true;
    await page
      .getByRole("button", { name: "Generate memory & opening", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "New", exact: true }),
    ).toBeDisabled();
    await page
      .getByRole("button", { name: "Stop creation", exact: true })
      .click();
    await expect(
      page.getByRole("button", {
        name: "Generate memory & opening",
        exact: true,
      }),
    ).toBeEnabled();
    expect(abortCount).toBe(1);
    await expect(page.getByLabel("Starting text", { exact: true })).toHaveValue(
      "The library was quiet.",
    );
    await expect(
      page.getByRole("button", { name: "New", exact: true }),
    ).toBeEnabled();
  } finally {
    release();
  }
});
test("image and brief create editable memory/opening with separate settings and private thoughts", async ({
  page,
}) => {
  let sent: any,
    fail = false;
  await page.route("https://api.nano-gpt.com/api/v1/**", (route) => {
    if (route.request().method() === "GET")
      return route.fulfill({
        json: { data: [{ id: "test/vision", context_length: 32000 }] },
      });
    sent = route.request().postDataJSON();
    return route.fulfill({
      json: {
        choices: [
          {
            message: {
              reasoning_content: "Private creation plan.",
              content: fail
                ? "bad JSON"
                : JSON.stringify({
                    title: "Mira",
                    memory:
                      "{{char}} is tall and shy. {{user}} met her at school.",
                    startingText:
                      "Mira waited by the library.\n\n“Hi,” she said.",
                  }),
            },
          },
        ],
      },
    });
  });
  await page.goto("/");
  const original = await editorValue(page);
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await page
    .getByLabel("Character / scenario brief")
    .fill("Mira is tall and shy. We first met at school. Write in English.");
  await page.keyboard.press("Control+s");
  await expect(page.getByRole("status")).toContainText("Create draft saved");
  await page
    .locator("summary")
    .filter({ hasText: /^Connection$/ })
    .click();
  await page.getByLabel("Provider", { exact: true }).selectOption("nanogpt");
  await page
    .getByLabel("API key · saved on this device")
    .fill("test-create-key");
  await page.getByRole("button", { name: "Fetch models", exact: true }).click();
  await page.getByLabel("Model", { exact: true }).fill("test/vision");
  await page.getByLabel("Reference image").setInputFiles({
    name: "reference.png",
    mimeType: "image/png",
    buffer: png,
  });
  await expect(
    page.getByRole("img", { name: "Creation reference" }),
  ).toBeVisible();
  await page.getByText("Create settings", { exact: true }).click();
  await page.getByLabel("Create Output (tokens)", { exact: true }).fill("1600");
  await page
    .getByLabel("Create Thinking Output (tokens)", { exact: true })
    .fill("500");
  await page
    .getByRole("button", { name: "Generate memory & opening", exact: true })
    .click();
  await expect(page.getByLabel("Created title")).toHaveValue("Mira");
  expect(sent.max_tokens).toBe(2100);
  expect(sent.messages[1].content[1].image_url.url).toMatch(
    /^data:image\/jpeg;base64,/,
  );
  expect(sent.stream).toBe(false);
  await page
    .getByLabel("Starting text", { exact: true })
    .fill("Mira smiled.\n\n“Hello.”");
  fail = true;
  await page
    .getByRole("button", { name: "Generate memory & opening", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("No complete");
  await expect(page.getByLabel("Starting text", { exact: true })).toHaveValue(
    "Mira smiled.\n\n“Hello.”",
  );
  await page.getByRole("button", { name: "Create story", exact: true }).click();
  await expectEditor(page, "Mira smiled.\n\n“Hello.”");
  await page.getByRole("button", { name: "Memory", exact: true }).click();
  await expect(
    page.getByLabel("Permanent memory", { exact: true }),
  ).toHaveValue("{{char}} is tall and shy. {{user}} met her at school.");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(
    page.getByLabel("Writing Output (tokens)", { exact: true }),
  ).toHaveValue("240");
  await page.getByRole("button", { name: "Thinking", exact: true }).click();
  await expect(page.locator(".thinking-record pre")).toHaveText(
    "Private creation plan.",
  );
  await expect(
    page.getByLabel("Use this thinking in context"),
  ).not.toBeChecked();
  await page.getByRole("button", { name: "My stories", exact: true }).click();
  await expect(page.locator(".story-card")).toHaveCount(2);
  expect(original).not.toBe("Mira smiled.\n\n“Hello.”");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.getByLabel("Created title")).toHaveValue("Mira");
  await expect(
    page.getByRole("img", { name: "Creation reference" }),
  ).toHaveCount(0);
  await page.screenshot({
    path: "test-results/create-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
