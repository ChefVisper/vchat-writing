import { describe, expect, it } from "vitest";
import { parseVHTML } from "../src/vgame/parser";
import {
  acceptGameProposal,
  appendGameText,
  createGameProject,
  editGameProposal,
  executeGameHook,
  executeOption,
  executeVHTML,
  finishGameAction,
  generateVHTML,
  optionEnabled,
  proposeVHTML,
  redoGame,
  rejectGameProposal,
  replaceGamePageText,
  undoGame,
  validateGameProject,
  visibleGameWidgets,
} from "../src/vgame/runtime";

const setup = (source: string) =>
  executeVHTML(createGameProject("Opening."), source, { definitionMode: true })
    .project;
const money = `<define: stat: "money" id: "money" name: "Money" type: integer default: 0 ai-access: modify>`;
const forest = `<add: event: name: "ForestPursuit" id: "forest"><define: mechanic: "suspicion" id: "suspicion" name: "Suspicion" type: percentage default: 0><display: id: "forest-meter" mechanic: "suspicion" style: progress-bar ui: event event: "forest" position: page-top remove-on: event-end>`;

describe("Vgame transactions, pages and options", () => {
  it("keeps prose-only pages unrestricted and never adds automatic options", () => {
    const p = createGameProject();
    const prose = "A quiet paragraph.\n\n".repeat(25);
    const result = executeVHTML(p, `<text: append: ${JSON.stringify(prose)}>`, {
      confirmed: true,
    });
    expect(result.project.pages[0].text).toBe(prose);
    expect(result.project.options).toEqual([]);
    expect(result.project.objects).toEqual([]);
    expect(p.pages[0].text).toBe("");
    expect(validateGameProject(result.project)).toBe(true);
  });
  it("defines bounded typed values and rejects invalid actions atomically", () => {
    const p = setup(
      money + `<define: mechanic: "Health" type: percentage default: 50>`,
    );
    expect(p.objects.find((o) => o.name === "Health")?.value).toBe(50);
    expect(() =>
      executeVHTML(
        p,
        `<modify: stat: "money" increase: 100><set: mechanic: "Health" value: 101>`,
      ),
    ).toThrow();
    expect(p.objects[0].value).toBe(0);
    expect(() => executeVHTML(p, `<set: stat: "money" value: 1.5>`)).toThrow(
      /integer/,
    );
    expect(() =>
      executeVHTML(
        p,
        `<modify: stat: "money" increase: 1 unexpected-code: "x">`,
      ),
    ).toThrow(/Unsupported/);
  });
  it("locks a consumed choice, commits state before exactly one AI request and undoes everything", () => {
    const p = setup(
      money +
        `<define: stat: "crime" name: "Criminality" type: number default: 0><option: id: "wallet" name: "Take wallet" result: <modify: stat: "money" increase: 1000><modify: stat: "crime" increase: 10><page: next><ai><ai: instruction: "Show consequences.">>`,
    );
    const result = executeOption(p, "wallet");
    expect(result.project.objects[0].value).toBe(1000);
    expect(result.project.objects[1].value).toBe(10);
    expect(result.project.pages).toHaveLength(2);
    expect(result.generation?.instruction).toBe("Show consequences.");
    expect(result.warnings).toHaveLength(1);
    expect(() => executeOption(result.project, "wallet")).toThrow();
    const unlocked = finishGameAction(result.project);
    const restored = undoGame(unlocked);
    expect(restored.pages).toHaveLength(1);
    expect(restored.activePageId).toBe(p.activePageId);
    expect(restored.objects[0].value).toBe(0);
    expect(restored.options[0].used).toBe(false);
    expect(redoGame(restored).objects[0].value).toBe(1000);
    expect(redoGame(restored).actionLock).toBeUndefined();
  });
  it("separates append, next, view-back and confirmed clearing", () => {
    const p = setup(
      money +
        `<option: id: "wake" name: "Wake man" result: <page: append><ai: instruction: "He wakes.">>`,
    );
    p.settings.choiceNewPage = false;
    const action = executeOption(p, "wake");
    expect(action.project.pages).toHaveLength(1);
    const next = executeVHTML(finishGameAction(action.project), `<page: next>`);
    expect(next.generation).toBeUndefined();
    const changed = executeVHTML(
      next.project,
      `<modify: stat: "money" increase: 5><page: back>`,
    ).project;
    expect(changed.activePageId).toBe(p.activePageId);
    expect(changed.objects[0].value).toBe(5);
    expect(() => executeVHTML(changed, `<page: clear>`)).toThrow(/Confirm/);
    expect(
      executeVHTML(changed, `<page: clear>`, { confirmed: true }).project
        .pages[0].text,
    ).toBe("");
  });
  it("keeps option conditions and explicit once semantics", () => {
    const p = setup(
      money +
        `<option: id: "buy" name: "Buy" once: false condition: <require: stat: "money" >= 10> result: <modify: stat: "money" decrease: 10>>`,
    );
    expect(optionEnabled(p, p.options[0])).toBe(false);
    const funded = executeVHTML(p, `<set: stat: "money" value: 20>`).project;
    expect(executeOption(funded, "buy").project.objects[0].value).toBe(10);
    expect(() => executeOption(p, "buy")).toThrow();
  });
});

describe("scoped UI and reusable event state", () => {
  it("global widgets survive pages while event widgets end without deleting their metric", () => {
    const p = setup(
      money +
        `<panel: id: "character" name: "Character" ui: global><display: id: "cash" stat: "money" panel: "character" ui: global>` +
        forest,
    );
    expect(visibleGameWidgets(p).map((w) => w.id)).toEqual(["cash"]);
    const started = executeVHTML(
      p,
      `<trigger: event: "forest" action: start><modify: mechanic: "suspicion" increase: 15><page: next>`,
    ).project;
    expect(visibleGameWidgets(started).map((w) => w.id)).toEqual([
      "cash",
      "forest-meter",
    ]);
    const ended = executeVHTML(
      started,
      `<trigger: event: "forest" action: end>`,
    ).project;
    expect(visibleGameWidgets(ended).map((w) => w.id)).toEqual(["cash"]);
    expect(ended.objects.find((o) => o.id === "suspicion")?.value).toBe(15);
    expect(() =>
      executeVHTML(ended, `<remove: mechanic: "suspicion">`, {
        confirmed: true,
      }),
    ).toThrow(/dependent/);
    expect(
      executeVHTML(ended, `<remove: ui: "forest-meter">`, { confirmed: true })
        .project.objects,
    ).toHaveLength(3);
  });
  it("page widgets expire only their view and drawer appearance creates no hidden statistics", () => {
    const p = setup(
      money +
        `<display: id: "page-money" stat: "money" ui: page remove-on: page-exit>`,
    );
    expect(visibleGameWidgets(p)).toHaveLength(1);
    const next = executeVHTML(p, `<page: next>`).project;
    expect(visibleGameWidgets(next)).toHaveLength(0);
    expect(next.objects[0].value).toBe(0);
    expect(next.widgets).toHaveLength(1);
    const objectOnly = setup(money);
    expect(objectOnly.widgets).toHaveLength(0);
  });
});

describe("AI proposal approval and permissions", () => {
  it("never executes AI commands directly in manual mode; rejection changes no game data", () => {
    const p = createGameProject();
    const proposed = executeVHTML(
      p,
      `<add: mechanic: id: "alert" name: "Alertness"><define: mechanic: "alert" type: percentage default: 0>`,
      { origin: "ai" },
    );
    expect(proposed.project.objects).toHaveLength(0);
    expect(proposed.project.proposals[0].status).toBe("pending");
    expect(
      rejectGameProposal(proposed.project, proposed.project.proposals[0].id)
        .objects,
    ).toHaveLength(0);
    const accepted = acceptGameProposal(
      proposed.project,
      proposed.project.proposals[0].id,
    ).project;
    expect(accepted.objects[0].owner).toBe("ai");
    expect(accepted.objects[0].type).toBe("percentage");
    const restored = undoGame(accepted);
    expect(restored.objects).toHaveLength(0);
    expect(restored.proposals[0].status).toBe("pending");
    expect(redoGame(restored).proposals[0].status).toBe("approved");
  });
  it("Smart allows routine changes within permissions and never auto-applies structure", () => {
    const p = setup(money + `<config: approval: smart>`);
    const changed = proposeVHTML(p, {
      id: "cash",
      source: `<modify: stat: "money" increase: 5>`,
      reason: "Reward",
    }).project;
    expect(changed.objects[0].value).toBe(5);
    expect(changed.proposals[0].status).toBe("approved");
    const structure = proposeVHTML(p, {
      source: `<add: stat: name: "Trust" id: "trust">`,
      reason: "Track trust",
    }).project;
    expect(structure.objects).toHaveLength(1);
    expect(structure.proposals[0].status).toBe("pending");
    const denied = setup(
      `<define: stat: "locked" type: number default: 0><config: approval: auto>`,
    );
    expect(
      proposeVHTML(denied, {
        source: `<set: stat: "locked" value: 3>`,
        reason: "No permission",
      }).project.proposals[0].status,
    ).toBe("failed");
    expect(
      proposeVHTML(p, {
        source: `<ai-permission: target: "money" access: modify>`,
        reason: "Escalate",
      }).project.proposals[0].status,
    ).toBe("failed");
    expect(
      proposeVHTML(p, {
        source: `<config: approval: auto>`,
        reason: "Escalate",
      }).project.settings.approval,
    ).toBe("smart");
  });
  it("revalidates stale values, dependency bundles and rejects unsafe nested commands", () => {
    let p = setup(
      `<define: stat: "hp" type: percentage default: 90 ai-access: modify>`,
    );
    p = proposeVHTML(p, {
      id: "heal",
      source: `<modify: stat: "hp" increase: 10>`,
      reason: "Heal",
    }).project;
    p = executeVHTML(p, `<set: stat: "hp" value: 99>`).project;
    expect(() => acceptGameProposal(p, "heal")).toThrow();
    expect(p.objects[0].value).toBe(99);
    p = proposeVHTML(p, {
      id: "child",
      source: `<display: id: "cash" stat: "new-money" ui: global>`,
      reason: "Counter",
      dependencies: ["parent"],
    }).project;
    p = proposeVHTML(p, {
      id: "parent",
      source: `<add: stat: id: "new-money" name: "New Money">`,
      reason: "Metric",
    }).project;
    const accepted = acceptGameProposal(p, "child").project;
    expect(accepted.objects.some((o) => o.id === "new-money")).toBe(true);
    expect(accepted.widgets.some((o) => o.id === "cash")).toBe(true);
    expect(
      accepted.proposals.filter((o) => o.status === "approved"),
    ).toHaveLength(2);
    expect(
      proposeVHTML(p, {
        source: `<option: name: "Run" result: <script: content: "alert(1)">>`,
        reason: "Bad",
      }).project.proposals.at(-1)?.status,
    ).toBe("failed");
  });
  it("audits malformed scripts without discarding narrative and prevents autonomous AI loops", () => {
    const p = setup(`<config: approval: auto>`);
    const bad = proposeVHTML(p, {
      source: `<add:`,
      reason: "Malformed",
    }).project;
    expect(bad.pages[0].text).toBe("Opening.");
    expect(bad.proposals[0].status).toBe("failed");
    const ai = proposeVHTML(p, { source: `<ai>`, reason: "Generate again" });
    expect(ai.generation).toBeUndefined();
    expect(ai.project.proposals[0].status).toBe("pending");
    expect(
      acceptGameProposal(ai.project, ai.project.proposals[0].id).generation,
    ).toBeDefined();
    const repaired = editGameProposal(
      bad,
      bad.proposals[0].id,
      `<add: stat: name: "Focus" id: "focus">`,
    );
    expect(repaired.proposals[0].status).toBe("pending");
    expect(repaired.settings.approval).toBe("auto");
  });
});

describe("deterministic sections, encounters and hooks", () => {
  const sections = (mode: string) =>
    `<configure: mechanic: "gaze" section-${mode}: <section: [0,20) result: <increase: chance: 10 encounter: "selfie">><section: [20,50) result: <increase: chance: 30 encounter: "selfie">><section: [50,100] result: <increase: chance: 50 encounter: "selfie">>>`;
  const scene = `<define: mechanic: "gaze" type: percentage default: 35><define: encounter: "selfie" base-chance: 5 cooldown: 30>`;
  it("selects apart ranges and stack thresholds once per explicit hook", () => {
    const apart = setup(scene + sections("apart"));
    const result = executeGameHook(apart, "turn", { random: () => 0.36 });
    expect(result.project.events[0].active).toBe(false);
    expect(result.project.log.some((l) => l.message.includes("35%"))).toBe(
      true,
    );
    expect(apart.random.counter).toBe(0);
    const stack = setup(scene + sections("stack"));
    expect(
      executeGameHook(stack, "turn", { random: () => 0.36 }).project.events[0]
        .active,
    ).toBe(true);
    const boundary = executeVHTML(
      apart,
      `<set: mechanic: "gaze" value: 20>`,
    ).project;
    expect(
      executeGameHook(boundary, "turn", {
        random: () => 0.36,
      }).project.log.some((l) => l.message.includes("35%")),
    ).toBe(true);
    expect(() =>
      executeVHTML(
        apart,
        `<configure: mechanic: "gaze" section-apart: <section: [0,20] result: <increase: chance: 10 encounter: "selfie">><section: [20,50) result: <increase: chance: 20 encounter: "selfie">>>`,
      ),
    ).toThrow(/overlap/);
  });
  it("separates eligibility, cooldown, chance and post-trigger effects with reproducible seeds", () => {
    const p = setup(
      money +
        `<define: variable: "outside" type: boolean default: false>` +
        scene +
        `<configure: encounter: "selfie" conditions: <require: variable: "outside" == true> on-trigger: <modify: stat: "money" increase: 2>>`,
    );
    expect(executeGameHook(p, "turn").project.random.counter).toBe(0);
    const ready = executeVHTML(
      p,
      `<set: variable: "outside" value: true>`,
    ).project;
    expect(executeGameHook(ready, "turn").project.random).toEqual(
      executeGameHook(ready, "turn").project.random,
    );
    const fired = executeGameHook(ready, "turn", { random: () => 0 }).project;
    expect(fired.objects[0].value).toBe(2);
    const ended = executeVHTML(
      fired,
      `<trigger: encounter: "selfie" action: end>`,
    ).project;
    expect(
      executeGameHook(ended, "turn", { minutes: 10, random: () => 0 }).project
        .objects[0].value,
    ).toBe(2);
    expect(
      executeGameHook(ended, "turn", { minutes: 30, random: () => 0 }).project
        .objects[0].value,
    ).toBe(4);
  });
});

describe("canonical editing and compact durable state", () => {
  it.each([
    ["conditions", `<notification: content: "Not a predicate">`],
    ["disabledIf", `<notification: content: "Not a predicate">`],
    ["conditions", `<require: stat: "missing" >= 1>`],
    ["disabledIf", `<require: stat: "missing" >= 1>`],
  ] as const)(
    "safely disables imported %s with a malformed or stale predicate",
    (field, source) => {
      const original = setup(
        money +
          `<option: id: "reward" name: "Reward" result: <modify: stat: "money" increase: 2>>`,
      );
      original.options[0][field] = parseVHTML(source);
      const imported = JSON.parse(JSON.stringify(original));
      expect(validateGameProject(imported)).toBe(true);
      const before = structuredClone(imported);
      expect(optionEnabled(imported, imported.options[0])).toBe(false);
      expect(() => executeOption(imported, "reward")).toThrow(/unavailable/);
      expect(imported).toEqual(before);
    },
  );
  it("reports destructive effects explicitly while ordinary Back navigation stays reversible without a review", () => {
    const p = setup(money);
    const changed = executeVHTML(
      p,
      '<remove: stat: "money"> <add: stat: name: "New money" id: "newmoney">',
      { confirmed: true },
    );
    expect(changed.project.objects).toHaveLength(1);
    expect(changed.requiresConfirmation).toBe(true);
    const next = executeVHTML(p, "<page: next>").project;
    expect(executeVHTML(next, "<page: back>").requiresConfirmation).toBe(false);
    expect(p.objects[0].id).toBe("money");
  });
  it("rejects ambiguous arithmetic and conflicting section modes instead of ignoring effects", () => {
    const p = setup(money);
    expect(() =>
      executeVHTML(p, '<modify: stat: "money" increase: 10 multiply: 2>'),
    ).toThrow(/separate commands/);
    expect(() =>
      executeVHTML(
        p,
        '<configure: stat: "money" section-apart: <section: [0,20) result: <increase: chance: 10 encounter: "missing">> section-stack: <section: [0,20) result: <increase: chance: 10 encounter: "missing">>>',
      ),
    ).toThrow(/section mode/);
    expect(p.objects[0].value).toBe(0);
  });
  it("clones events with an independent inactive lifecycle and compact undo", () => {
    const p = setup(
      money +
        `<add: event: id: "reward" name: "Reward" on-trigger: <modify: stat: "money" increase: 2>>`,
    );
    const cloned = executeVHTML(
      p,
      `<clone: event: "reward" new-id: "copy" name: "Copy">`,
    ).project;
    expect(cloned.events).toHaveLength(2);
    const triggered = executeVHTML(
      cloned,
      `<trigger: event: "copy" action: start>`,
    ).project;
    expect(triggered.objects.find((o) => o.id === "money")?.value).toBe(2);
    expect(triggered.events.find((e) => e.id === "reward")?.active).toBe(false);
    expect(triggered.events.find((e) => e.id === "copy")?.active).toBe(true);
    expect(undoGame(cloned).events).toHaveLength(1);
  });
  it("keeps copied AI event effects within source permissions and AI authority", () => {
    const p = setup(
      money +
        `<define: stat: "private" type: integer default: 7 ai-access: none><add: event: id: "reward" name: "Reward" ai-access: modify on-trigger: <set: stat: "private" value: 99>>`,
    );
    const forbidden = proposeVHTML(p, {
      source: `<clone: stat: "private" new-id: "leak" name: "Leak">`,
      reason: "Copy",
    }).project;
    expect(forbidden.proposals[0].status).toBe("failed");
    const proposed = proposeVHTML(p, {
      source: `<clone: event: "reward" new-id: "copy" name: "Copy">`,
      reason: "Copy",
    }).project;
    const cloned = acceptGameProposal(
      proposed,
      proposed.proposals[0].id,
    ).project;
    expect(cloned.objects.find((o) => o.id === "copy")?.onTriggerOwner).toBe(
      "ai",
    );
    expect(() =>
      executeVHTML(cloned, `<trigger: event: "copy" action: start>`),
    ).toThrow();
    expect(cloned.objects.find((o) => o.id === "private")?.value).toBe(7);
    const privileged = setup(
      `<add: event: id: "settings" name: "Settings" ai-access: modify on-trigger: <config: approval: auto>>`,
    );
    expect(
      proposeVHTML(privileged, {
        source: `<clone: event: "settings" new-id: "copy" name: "Copy">`,
        reason: "Copy",
      }).project.proposals[0].status,
    ).toBe("failed");
  });
  it("source and visual canonical edits share the same versioned model without duplicate systems", () => {
    const p = setup(
      money +
        `<panel: id: "main" name: "Main" ui: global><display: id: "cash" stat: "money" panel: "main" ui: global><ai-instruct: id: "voice" scope: global content: "Use clear prose.">`,
    );
    const source = generateVHTML(p);
    const edited = executeVHTML(p, source, { definitionMode: true }).project;
    expect(edited.objects).toEqual(p.objects);
    expect(edited.widgets).toEqual(p.widgets);
    expect(edited.pages.map((a) => a.text)).toEqual(p.pages.map((a) => a.text));
    expect(edited.instructions).toEqual(p.instructions);
    expect(validateGameProject(JSON.parse(JSON.stringify(edited)))).toBe(true);
    expect(
      executeVHTML(
        p,
        `<define: stat: "money" name: "Savings" type: integer default: 5 value: 20>`,
        { definitionMode: true },
      ).project.objects[0].name,
    ).toBe("Savings");
  });
  it("keeps all pages despite context history limits and stores compact prose deltas", () => {
    const p = createGameProject("x".repeat(150000));
    const updated = executeVHTML(
      p,
      `<text: append: "The new sentence.">`,
    ).project;
    expect(JSON.stringify(updated.history).length).toBeLessThan(2000);
    expect(undoGame(updated).pages[0].text).toBe(p.pages[0].text);
    expect(redoGame(undoGame(updated)).pages[0].text).toBe(
      updated.pages[0].text,
    );
    let pages = p;
    for (let i = 0; i < 35; i++)
      pages = executeVHTML(pages, `<page: next>`).project;
    pages = executeVHTML(
      pages,
      `<config: max-context-tokens: 64000 max-history-pages: 30 reserve-tokens: 8192>`,
    ).project;
    expect(pages.pages).toHaveLength(36);
    expect(pages.settings.maxHistoryPages).toBe(30);
    expect(validateGameProject(pages)).toBe(true);
  });
  it("rejects prototype history paths and malicious project imports", () => {
    const p = createGameProject();
    const invalid = structuredClone(p);
    invalid.history.push({
      id: "bad",
      at: 1,
      label: "Bad",
      origin: "user",
      changes: [{ path: ["__proto__", "polluted"], after: true }],
    });
    expect(validateGameProject(invalid)).toBe(false);
    expect(() => undoGame(invalid)).toThrow();
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
    expect(validateGameProject({ ...p, activePageId: "missing" })).toBe(false);
    expect(() =>
      executeVHTML(p, `<script: content: "fetch('secret')">`),
    ).toThrow();
  });
  it("edits large plain prose atomically without parsing or copying every old page", () => {
    const original = createGameProject("x".repeat(500000));
    const text = "<script>plain text</script>".repeat(1000);
    const appended = appendGameText(original, text, {
      label: "AI narrative",
    }).project;
    expect(appended.pages[0].text).toBe(original.pages[0].text + text);
    expect(JSON.stringify(appended.history).length).toBeLessThan(30000);
    const replaced = replaceGamePageText(
      appended,
      appended.activePageId,
      "y".repeat(500000),
      { confirmed: true },
    );
    expect(undoGame(replaced).pages[0].text).toBe(appended.pages[0].text);
    const source = generateVHTML(replaced);
    expect(source.length).toBeLessThan(1000);
    expect(
      executeVHTML(replaced, source, { definitionMode: true }).project.pages[0]
        .text,
    ).toBe(replaced.pages[0].text);
    expect(() => createGameProject("x".repeat(2000001))).toThrow();
  });
  it("keeps imported history from producing an invalid project through Undo", () => {
    const p = createGameProject();
    p.history.push({
      id: "bad-settings",
      at: 1,
      label: "Bad",
      origin: "user",
      changes: [
        { path: ["settings", "approval"], before: "invalid", after: "manual" },
      ],
    });
    expect(validateGameProject(p)).toBe(true);
    expect(() => undoGame(p)).toThrow();
    expect(p.settings.approval).toBe("manual");
    const poisoned = structuredClone(p);
    poisoned.history[0].changes[0].before = JSON.parse(
      '{"constructor":{"polluted":true}}',
    );
    expect(validateGameProject(poisoned)).toBe(false);
    const illegalRoot = structuredClone(p);
    illegalRoot.history[0].changes[0].path = ["future", 0];
    expect(validateGameProject(illegalRoot)).toBe(false);
    const percentage = setup(
      `<define: stat: "rate" name: "Rate" type: percentage default: 0>`,
    );
    delete percentage.objects[0].min;
    delete percentage.objects[0].max;
    percentage.objects[0].value = 999;
    expect(validateGameProject(percentage)).toBe(false);
  });
});
