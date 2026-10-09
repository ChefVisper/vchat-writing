import { expect, test, type Page, type Route } from "@playwright/test";
import { editorValue, expectEditor, setEditorText } from "./editor";

const endpoint = "https://openrouter.ai/api/v1";
const modules = [
  ["agendas", "Character agendas", "Characters"],
  ["locations", "Character locations", "Characters"],
  ["relationships", "Relationships", "Characters"],
  ["thoughts", "Fictional character thoughts", "Characters"],
  ["inventory", "Inventory & condition", "Characters"],
  ["factions", "Factions", "Plot & setting"],
  ["quests", "Objectives & quests", "Plot & setting"],
  ["seeds", "Secrets & narrative seeds", "Plot & setting"],
  ["notebook", "GM notebook", "Plot & setting"],
  ["rpg", "RPG checks", "Game & simulation"],
  ["world", "Background world", "Game & simulation"],
  ["physics", "Environment & scene geometry", "Game & simulation"],
] as const;

type Captured = {
  body: any;
  authorization: string;
  kind: "writing" | "states" | "notes";
};

function controlledProvider() {
  const sent: Captured[] = [];
  let writing = 0;
  let states = 0;
  let notes = 0;
  let next: "valid" | "unknown" | "truncated" | "hold" = "valid";
  let nextNotes: "valid" | "invalid" | "hold" = "valid";
  let release: (() => void) | undefined;
  const contentFor = (module: string, n: number) =>
    module === "agendas"
      ? `Established: Mira waits for a letter. Proposed: ask Daniel about it. Agenda update ${n}.`
      : module === "locations"
        ? `Established: Mira is in the kitchen. Location update ${n}.`
        : module === "thoughts"
          ? `Proposed: Mira hopes the letter explains the delay. Fictional thought ${n}.`
          : `Established: ${module} continuity update ${n}.`;
  return {
    sent,
    get stateCount() {
      return states;
    },
    get noteCount() {
      return notes;
    },
    nextState(value: typeof next) {
      next = value;
    },
    nextNote(value: typeof nextNotes) {
      nextNotes = value;
    },
    release() {
      release?.();
      release = undefined;
    },
    async handle(route: Route) {
      const body = route.request().postDataJSON();
      const instruction = body.messages[0].content as string;
      const kind = instruction.includes("fictional manuscript Internal States")
        ? "states"
        : instruction.includes("continuity notes")
          ? "notes"
          : "writing";
      sent.push({
        body,
        kind,
        authorization: route.request().headers().authorization ?? "",
      });
      if (kind === "writing") {
        const prose = [
          " The clock rang once.",
          " Rain tapped the window.",
          " Mira opened the letter.",
          " Daniel knocked on the door.",
        ][writing++ % 4];
        return route.fulfill({
          contentType: "text/event-stream",
          body:
            `data: ${JSON.stringify({ choices: [{ delta: { reasoning: `Private writing reasoning ${writing}.` } }] })}\n\n` +
            prose
              .match(/[\s\S]{1,9}/g)!
              .map(
                (content) =>
                  `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`,
              )
              .join("") +
            "data: [DONE]\n\n",
        });
      }
      if (kind === "notes") {
        notes++;
        const behavior = nextNotes;
        nextNotes = "valid";
        if (behavior === "hold")
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
                      behavior === "invalid"
                        ? '{"updates":['
                        : '{"updates":[]}',
                  },
                },
              ],
            },
          })
          .catch(() => {});
        return;
      }
      states++;
      const selected = [
        ...(body.messages[1].content as string).matchAll(/^([a-z]+) \(/gm),
      ].map((m) => m[1]);
      const output = JSON.stringify({
        states: selected.map((module) => ({
          module,
          content: contentFor(module, states),
        })),
      });
      const behavior = next;
      next = "valid";
      if (behavior === "hold")
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      const content =
        behavior === "unknown"
          ? JSON.stringify({
              states: [
                { module: "unknown", content: "Must never be accepted." },
              ],
            })
          : behavior === "truncated"
            ? output.slice(0, -8)
            : output;
      await route
        .fulfill({
          json: {
            choices: [
              {
                message: {
                  content,
                  reasoning: `Private state reasoning ${states}.`,
                },
              },
            ],
          },
        })
        .catch(() => {});
    },
  };
}

async function seed(page: Page, enabled = false) {
  await page.addInitScript((endpoint) => {
    localStorage.setItem(
      "margin-local-credentials-v1",
      JSON.stringify({
        [`writing:openrouter:${endpoint}`]: "fake-writing-key",
        [`notes:openrouter:${endpoint}`]: "fake-notes-key",
      }),
    );
  }, endpoint);
  await page.goto("/");
  await page.getByRole("textbox", { name: "Story manuscript" }).waitFor();
  await page.evaluate(
    async ({ enabled, endpoint }) => {
      const storePath = "/src/store.ts",
        typesPath = "/src/types.ts",
        presetPath = "/src/presets/ff54.ts";
      const { useStore } = await import(storePath);
      const { newStory } = await import(typesPath);
      const { newFF54Config } = await import(presetPath);
      const story = newStory();
      story.title = "State test";
      story.text = "Mira waited.";
      story.connection = {
        kind: "openrouter",
        url: endpoint,
        model: "test/writer",
      };
      story.noteConnectionMode = "separate";
      story.noteConnection = {
        kind: "openrouter",
        url: endpoint,
        model: "test/continuity",
      };
      story.settings = {
        ...story.settings,
        context: 32000,
        maxTokens: 150,
        thinkingMaxTokens: 300,
      };
      if (enabled)
        story.ff54 = {
          ...newFF54Config(),
          enabled: true,
          modules: ["agendas", "locations"],
          thinkingMaxTokens: 256,
        };
      useStore.getState().add(story);
      await useStore.getState().flush();
    },
    { enabled, endpoint },
  );
  await expectEditor(page, "Mira waited.");
}

async function currentStory(page: Page) {
  return page.evaluate(async () => {
    const path = "/src/store.ts";
    const { useStore } = await import(path);
    const store = useStore.getState();
    await store.flush();
    return store.stories.find((s: any) => s.id === store.current);
  });
}

async function prompt(page: Page) {
  return page.evaluate(async () => {
    const storePath = "/src/store.ts",
      promptPath = "/src/context/promptBuilder.ts";
    const { useStore } = await import(storePath);
    const { buildPrompt } = await import(promptPath);
    const store = useStore.getState();
    return buildPrompt(
      store.stories.find((s: any) => s.id === store.current),
      store.lorebooks,
    ).prompt;
  });
}

async function idle(page: Page) {
  await expect(
    page.getByRole("button", { name: "Write", exact: true }),
  ).toBeEnabled();
}

async function openPanel(
  page: Page,
  name: "Settings" | "Internal States" | "Thinking" | "History",
) {
  const heading = name === "History" ? "History & files" : name;
  if (
    !(await page
      .getByRole("heading", { name: heading, exact: true })
      .isVisible())
  )
    await page.getByRole("button", { name, exact: true }).click();
}

async function ffSettings(page: Page) {
  await openPanel(page, "Settings");
  const details = page.locator("details.ff54-settings");
  if ((await details.getAttribute("open")) === null)
    await details.locator(":scope > summary").click();
  return details;
}

async function chooseModules(page: Page, selected: string[]) {
  const details = await ffSettings(page);
  for (const group of ["Characters", "Plot & setting", "Game & simulation"]) {
    const summary = details.locator("summary").filter({
      hasText: new RegExp(`^${group.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`),
    });
    const section = summary.locator("..");
    if ((await section.getAttribute("open")) === null) await summary.click();
    for (const [id, label] of modules.filter((m) => m[2] === group)) {
      await details
        .getByLabel(label, { exact: true })
        .setChecked(selected.includes(id));
    }
  }
}

async function refresh(page: Page) {
  await openPanel(page, "Internal States");
  await page
    .getByRole("button", { name: "Refresh states", exact: true })
    .click();
  await idle(page);
}

test("FF controls preserve writing presets and states use independent Notes output and Thinking", async ({
  page,
}) => {
  const api = controlledProvider();
  await page.route(`${endpoint}/chat/completions`, (route) =>
    api.handle(route),
  );
  await seed(page);
  const original = await currentStory(page);
  const ff = await ffSettings(page);
  await expect(
    ff.getByLabel("Enable Internal States", { exact: true }),
  ).not.toBeChecked();
  await page
    .getByLabel("Writing preset", { exact: true })
    .selectOption("writers-block");
  await expect(
    ff.getByLabel("Enable Internal States", { exact: true }),
  ).not.toBeChecked();
  await ff.getByLabel("Enable Internal States", { exact: true }).check();
  await chooseModules(page, ["agendas", "locations", "thoughts"]);
  await ff
    .locator("summary")
    .filter({ hasText: /^State generation & context$/ })
    .click();
  await ff
    .getByLabel("Internal States Output (tokens)", { exact: true })
    .fill("1536");
  await ff
    .getByLabel("Internal States Thinking Output (tokens)", { exact: true })
    .fill("256");
  await ff
    .getByLabel("Internal States Context allowance (tokens)", { exact: true })
    .fill("1000");
  await ff.getByLabel("Internal States Thinking", { exact: true }).check();
  await ff
    .getByLabel("Internal States Thinking level", { exact: true })
    .selectOption("medium");
  await ff
    .getByLabel("FF 5.4 extra direction", { exact: true })
    .fill("Keep character plans concise.");
  await page
    .getByLabel("Writing preset", { exact: true })
    .selectOption("default");
  const configured = await currentStory(page);
  expect(configured.promptTemplate).toBe(original.promptTemplate);
  expect(configured.writersBlockTemplate).toBe(original.writersBlockTemplate);
  expect(configured.settings.maxTokens).toBe(150);
  await page.reload();
  const persisted = await ffSettings(page);
  await expect(
    persisted.getByLabel("Enable Internal States", { exact: true }),
  ).toBeChecked();
  await persisted
    .locator("summary")
    .filter({ hasText: /^State generation & context$/ })
    .click();
  await expect(
    persisted.getByLabel("Internal States Output (tokens)", { exact: true }),
  ).toHaveValue("1536");
  await expect(
    persisted.getByLabel("Internal States Thinking level", { exact: true }),
  ).toHaveValue("medium");
  await page.getByRole("button", { name: "Write", exact: true }).click();
  await idle(page);
  await expectEditor(page, "Mira waited. The clock rang once.");
  expect(api.sent.map((r) => r.kind)).toEqual(["writing", "states"]);
  expect(api.sent[0].body.model).toBe("test/writer");
  expect(api.sent[0].authorization).toBe("Bearer fake-writing-key");
  expect(api.sent[1].body.model).toBe("test/continuity");
  expect(api.sent[1].authorization).toBe("Bearer fake-notes-key");
  expect(api.sent[1].body.stream).toBe(false);
  expect(api.sent[1].body.max_tokens).toBe(1792);
  expect(api.sent[1].body.reasoning.effort).toBe("medium");
  expect(api.sent[1].body.messages[1].content).toContain(
    "Keep character plans concise.",
  );
  await openPanel(page, "Internal States");
  await expect(
    page.getByRole("textbox", { name: "Character agendas state", exact: true }),
  ).toHaveValue(/Agenda update 1/);
  await expect(
    page.getByRole("textbox", {
      name: "Fictional character thoughts state",
      exact: true,
    }),
  ).toHaveValue(/Fictional thought 1/);
  await expect(page.locator(".internal-states-panel")).not.toContainText(
    "Private state reasoning",
  );
  await page
    .locator(".panel-body")
    .evaluate((element) => (element.scrollTop = 0));
  await page.screenshot({
    path: "test-results/internal-states-desktop.png",
    fullPage: true,
  });
  await openPanel(page, "Thinking");
  await expect(page.locator(".thinking-record pre")).toContainText([
    "Private state reasoning 1.",
    "Private writing reasoning 1.",
  ]);
  const assembled = await prompt(page);
  expect(assembled).toContain("Agenda update 1");
  expect(assembled).toContain("Fictional thought 1");
  expect(assembled).not.toContain("Private state reasoning");
  expect((await currentStory(page)).internalStates.records).toHaveLength(1);
});

test("refresh leaves prose intact and rejects unknown or incomplete states without losing drafts", async ({
  page,
}) => {
  const api = controlledProvider();
  await page.route(`${endpoint}/chat/completions`, (route) =>
    api.handle(route),
  );
  await seed(page, true);
  await refresh(page);
  const first = await currentStory(page);
  await expectEditor(page, "Mira waited.");
  for (const response of ["unknown", "truncated"] as const) {
    api.nextState(response);
    await refresh(page);
    await expect(page.getByRole("alert")).toContainText(
      "Internal States response is incomplete or invalid",
    );
    const after = await currentStory(page);
    expect(after.internalStates).toEqual(first.internalStates);
    await expectEditor(page, "Mira waited.");
  }
  const agenda = page.getByRole("textbox", {
    name: "Character agendas state",
    exact: true,
  });
  await agenda.fill("Established: manual unsaved correction.");
  await expect(
    page.getByRole("button", { name: "Refresh states", exact: true }),
  ).toBeDisabled();
  // An arriving background result must not silently overwrite an unsaved draft.
  await page.evaluate(async () => {
    const storePath = "/src/store.ts",
      statesPath = "/src/generation/internalStates.ts",
      typesPath = "/src/types.ts";
    const { useStore } = await import(storePath);
    const { makeStateRecord, appendStateRecord } = await import(statesPath);
    const { noteConnection } = await import(typesPath);
    const store = useStore.getState(),
      story = store.stories.find((s: any) => s.id === store.current);
    const record = makeStateRecord(
      story,
      [{ module: "agendas", content: "Established: new source snapshot." }],
      noteConnection(story),
    );
    store.patch({ internalStates: appendStateRecord(story, record) });
  });
  await expect(agenda).toHaveValue("Established: manual unsaved correction.");
  await expect(
    page.getByRole("button", { name: "Save state edits", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Load latest states", exact: true })
    .click();
  await expect(agenda).toHaveValue("Established: new source snapshot.");
  await expectEditor(page, "Mira waited.");
});

test("module, context and master switches preserve state history while controlling prompt inclusion", async ({
  page,
}) => {
  const api = controlledProvider();
  await page.route(`${endpoint}/chat/completions`, (route) =>
    api.handle(route),
  );
  await seed(page, true);
  await chooseModules(page, ["agendas", "locations", "inventory"]);
  await refresh(page);
  await chooseModules(page, ["agendas"]);
  await refresh(page);
  expect(api.sent.at(-1)?.body.messages[1].content).not.toContain(
    "inventory continuity update 1",
  );
  // Inactive modules are retained in the current snapshot across updates, so
  // enabling them again restores continuity without searching through history.
  await chooseModules(page, ["locations", "inventory"]);
  expect(await prompt(page)).toContain("inventory continuity update 1");
  let assembled = await prompt(page);
  expect(assembled).toContain("Location update 1");
  expect(assembled).not.toContain("Agenda update 2");
  const ff = await ffSettings(page);
  await ff
    .getByLabel("Include current states in writing context", { exact: true })
    .uncheck();
  expect(await prompt(page)).not.toContain("FF 5.4 INTERNAL STATES");
  await ff
    .getByLabel("Include current states in writing context", { exact: true })
    .check();
  await ff.getByLabel("Enable Internal States", { exact: true }).uncheck();
  const before = await currentStory(page);
  await page.getByRole("button", { name: "Write", exact: true }).click();
  await idle(page);
  expect(api.stateCount).toBe(2);
  expect(api.sent.at(-1)?.kind).toBe("writing");
  expect(api.sent.at(-1)?.body.messages[1].content).not.toContain(
    "FF 5.4 INTERNAL STATES",
  );
  expect((await currentStory(page)).internalStates).toEqual(
    before.internalStates,
  );
  await openPanel(page, "Internal States");
  await expect(
    page.getByRole("textbox", { name: "Character agendas state", exact: true }),
  ).toHaveValue(/Agenda update 2/);
  await expect(page.locator(".internal-states-panel")).toContainText(
    "Module disabled",
  );
  await expect(
    page.getByRole("button", { name: "Refresh states", exact: true }),
  ).toBeDisabled();
  await ffSettings(page);
  await page.getByLabel("Enable Internal States", { exact: true }).check();
  await page
    .getByLabel("Update states after writing", { exact: true })
    .uncheck();
  await page.getByRole("button", { name: "Note", exact: true }).click();
  await idle(page);
  expect(api.stateCount).toBe(3); // Standalone Note explicitly refreshes states, even with auto-update off.
  assembled = await prompt(page);
  expect(assembled).toContain("Location update 3");
  expect(
    (await currentStory(page)).internalStates.records[0].blocks,
  ).toHaveLength(3);
  await page.reload();
  await openPanel(page, "Internal States");
  await expect(
    page.getByRole("textbox", {
      name: "Character locations state",
      exact: true,
    }),
  ).toHaveValue(/Location update 3/);
  await chooseModules(page, ["agendas", "locations", "inventory"]);
  await openPanel(page, "Internal States");
  const olderAgenda = page.getByRole("textbox", {
    name: "Character agendas state",
    exact: true,
  });
  await expect(olderAgenda).toHaveValue(/Agenda update 2/);
  await expect(
    page.locator(".internal-state-block").filter({ has: olderAgenda }),
  ).toContainText("Needs refresh");
  expect(await prompt(page)).not.toContain("Agenda update 2");
  const oldRecord = (await currentStory(page)).internalStates.records.at(-1);
  const oldAgendaBasis = oldRecord.blocks.find(
    (block: any) => block.module === "agendas",
  ).basis;
  const location = page.getByRole("textbox", {
    name: "Character locations state",
    exact: true,
  });
  await location.fill(`${await location.inputValue()} Verified location.`);
  await page
    .getByRole("button", { name: "Save state edits", exact: true })
    .click();
  const editedLocationRecord = (
    await currentStory(page)
  ).internalStates.records.at(-1);
  expect(
    editedLocationRecord.blocks.find((block: any) => block.module === "agendas")
      .basis,
  ).toBe(oldAgendaBasis);
  await expect(
    page.locator(".internal-state-block").filter({ has: olderAgenda }),
  ).toContainText("Needs refresh");
  expect(await prompt(page)).not.toContain("Agenda update 2");
  await olderAgenda.fill("Established: Mira reviewed her revised agenda.");
  await page
    .getByRole("button", { name: "Save state edits", exact: true })
    .click();
  const verifiedRecord = (await currentStory(page)).internalStates.records.at(
    -1,
  );
  expect(
    verifiedRecord.blocks.find((block: any) => block.module === "agendas")
      .basis,
  ).toBe(verifiedRecord.basis);
  await expect(
    page.locator(".internal-state-block").filter({ has: olderAgenda }),
  ).not.toContainText("Needs refresh");
  expect(await prompt(page)).toContain("Mira reviewed her revised agenda");
});

test("Continue keeps valid states after a note failure, while Stop notes cancels the remaining pipeline", async ({
  page,
}) => {
  const api = controlledProvider();
  await page.route(`${endpoint}/chat/completions`, (route) =>
    api.handle(route),
  );
  await seed(page, true);
  await page.evaluate(async () => {
    const storePath = "/src/store.ts",
      typesPath = "/src/types.ts";
    const { useStore } = await import(storePath);
    const { newNote } = await import(typesPath);
    useStore.getState().patch({
      notes: [
        {
          ...newNote(),
          title: "Scene",
          content: "Mira waits in the kitchen.",
          mode: "auto",
        },
      ],
    });
  });
  const before = await currentStory(page);
  api.nextNote("invalid");
  await page.getByRole("button", { name: /^Continue/ }).click();
  await idle(page);
  await expectEditor(page, "Mira waited. The clock rang once.");
  await expect(page.getByRole("alert")).toContainText("No notes were changed");
  expect(api.sent.map((request) => request.kind)).toEqual([
    "writing",
    "notes",
    "states",
  ]);
  const first = await currentStory(page);
  expect(first.notes).toEqual(before.notes);
  expect(first.internalStates.records).toHaveLength(1);
  api.nextNote("hold");
  await page.getByRole("button", { name: /^Continue/ }).click();
  await expect.poll(() => api.noteCount).toBe(2);
  try {
    await page.getByRole("button", { name: "Stop notes", exact: true }).click();
    await idle(page);
    await expectEditor(
      page,
      "Mira waited. The clock rang once. Rain tapped the window.",
    );
    const stopped = await currentStory(page);
    expect(stopped.notes).toEqual(before.notes);
    expect(stopped.internalStates).toEqual(first.internalStates);
    expect(api.stateCount).toBe(1);
    expect(api.sent.map((request) => request.kind)).toEqual([
      "writing",
      "notes",
      "states",
      "writing",
      "notes",
    ]);
  } finally {
    api.release();
  }
});

test("states follow passage undo, redo, retry, manual edits, snapshots, branches and portable projects", async ({
  page,
  context,
}) => {
  const api = controlledProvider();
  await page.route(`${endpoint}/chat/completions`, (route) =>
    api.handle(route),
  );
  await seed(page, true);
  await refresh(page);
  const initial = await currentStory(page);
  await page.getByRole("button", { name: "Write", exact: true }).click();
  await idle(page);
  const passage = await currentStory(page);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expectEditor(page, "Mira waited.");
  expect((await currentStory(page)).internalStates.currentId).toBe(
    initial.internalStates.currentId,
  );
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expectEditor(page, passage.text);
  expect((await currentStory(page)).internalStates.currentId).toBe(
    passage.internalStates.currentId,
  );
  await openPanel(page, "Internal States");
  await page
    .getByRole("textbox", { name: "Character agendas state", exact: true })
    .fill("Established: Mira wants a manual correction.");
  await page
    .getByRole("button", { name: "Save state edits", exact: true })
    .click();
  const manual = await currentStory(page);
  expect(manual.internalStates.records.at(-1).source).toBe("manual");
  expect(manual.segments.at(-1).statesAfter).toBe(
    manual.internalStates.currentId,
  );
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  expect((await currentStory(page)).internalStates.currentId).toBe(
    manual.internalStates.currentId,
  );
  await page
    .getByRole("button", { name: "Create snapshot", exact: true })
    .click();
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await idle(page);
  await expectEditor(page, "Mira waited. Rain tapped the window.");
  const retryRequest = api.sent.filter((r) => r.kind === "writing").at(-1)!;
  expect(retryRequest.body.messages[1].content).toContain("Agenda update 1");
  expect(retryRequest.body.messages[1].content).not.toContain(
    "manual correction",
  );
  const retried = await currentStory(page);
  expect(retried.internalStates.currentId).not.toBe(
    manual.internalStates.currentId,
  );
  await openPanel(page, "History");
  await page.getByRole("button", { name: "Restore", exact: true }).click();
  await expectEditor(page, manual.text);
  expect((await currentStory(page)).internalStates.currentId).toBe(
    manual.internalStates.currentId,
  );
  await page.getByRole("button", { name: "Branch", exact: true }).click();
  const branch = await currentStory(page);
  expect(branch.parent).toBe(manual.id);
  expect(branch.internalStates.currentId).toBe(manual.internalStates.currentId);
  expect(branch.ff54).toEqual(manual.ff54);
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
    await expectEditor(other, manual.text);
    await openPanel(other, "Internal States");
    await expect(
      other.getByRole("textbox", {
        name: "Character agendas state",
        exact: true,
      }),
    ).toHaveValue("Established: Mira wants a manual correction.");
    expect((await currentStory(other)).ff54).toEqual(branch.ff54);
  } finally {
    await fresh.close();
  }
  await openPanel(page, "Internal States");
  const agenda = page.getByRole("textbox", {
    name: "Character agendas state",
    exact: true,
  });
  await agenda.fill("Unsaved change stays in the draft.");
  await setEditorText(
    page,
    `${await editorValue(page)} A manual manuscript edit.`,
  );
  await expect(page.locator(".internal-states-panel")).toContainText(
    "Stale states",
  );
  await expect(agenda).toHaveValue("Unsaved change stays in the draft.");
  await expect(
    page.getByRole("button", { name: "Save state edits", exact: true }),
  ).toBeDisabled();
  expect(await prompt(page)).not.toContain("FF 5.4 INTERNAL STATES");
  await page
    .getByRole("button", { name: "Discard state edits", exact: true })
    .click();
  await refresh(page);
  await expect(agenda).toBeEnabled();
  await expectEditor(page, `${manual.text} A manual manuscript edit.`);
});

test("portrait mobile can stop a pending state update and retains the previous snapshot", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const api = controlledProvider();
  await page.route(`${endpoint}/chat/completions`, (route) =>
    api.handle(route),
  );
  await seed(page, true);
  await refresh(page);
  const previous = await currentStory(page);
  api.nextState("hold");
  await page
    .getByRole("button", { name: "Refresh states", exact: true })
    .click();
  await expect.poll(() => api.stateCount).toBe(2);
  const stop = page
    .locator(".internal-states-panel")
    .getByRole("button", { name: "Stop states", exact: true });
  try {
    await expect(stop).toBeVisible();
    await expect(stop).toBeEnabled();
    await expect(
      page.getByRole("textbox", {
        name: "Character agendas state",
        exact: true,
      }),
    ).toBeDisabled();
    await stop.click();
    await idle(page);
    expect((await currentStory(page)).internalStates).toEqual(
      previous.internalStates,
    );
    await expectEditor(page, "Mira waited.");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: "test-results/internal-states-mobile.png",
      fullPage: true,
    });
  } finally {
    api.release();
  }
});
