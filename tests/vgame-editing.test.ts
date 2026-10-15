import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  createGameProject,
  editGamePageText,
  executeVHTML,
  executeOption,
  finishGameAction,
  undoGame,
  redoGame,
  appendGameText,
  optionEnabled,
  validateGameProject,
} from "../src/vgame/runtime";
import { vhtmlCompletions } from "../src/vgame/completion";

it("initializes new typed objects from their default without resetting configured values", () => {
  let p = executeVHTML(
    createGameProject(),
    '<add: stat: id: "money" name: "Money" type: integer default: 20><add: variable: id: "ready" name: "Ready" type: boolean default: true>',
  ).project;
  expect(p.objects.map((o) => o.value)).toEqual([20, true]);
  p = executeVHTML(
    p,
    '<set: stat: "money" value: 30><configure: stat: "money" default: 50>',
  ).project;
  expect(p.objects[0].value).toBe(30);
  expect(p.objects[0].default).toBe(50);
});

describe("Vgame direct manuscript editing", () => {
  it("groups a typing burst, isolates AI passages, and keeps deletion undoable", () => {
    let p = createGameProject("Opening.");
    const id = p.activePageId;
    p = editGamePageText(p, id, "Opening. H", 1000);
    p = editGamePageText(p, id, "Opening. Hello", 1500);
    expect(p.history).toHaveLength(1);
    expect(undoGame(p).pages[0].text).toBe("Opening.");
    expect(redoGame(undoGame(p)).pages[0].text).toBe("Opening. Hello");
    p = appendGameText(p, "\nAI passage.").project;
    p = editGamePageText(p, id, "Hello\nAI passage.", 1700);
    expect(undoGame(p).pages[0].text).toBe("Opening. Hello\nAI passage.");
    expect(undoGame(undoGame(p)).pages[0].text).toBe("Opening. Hello");
  });
  it("starts a new group after a pause or undo and keeps long prose deltas compact", () => {
    let p = createGameProject("Long prose. ".repeat(50000));
    const id = p.activePageId;
    p = editGamePageText(p, id, p.pages[0].text + "X", 1000);
    p = editGamePageText(p, id, p.pages[0].text + "Y", 2500);
    expect(p.history).toHaveLength(2);
    expect(JSON.stringify(p).length).toBeLessThan(p.pages[0].text.length * 1.1);
    p = undoGame(p);
    p = editGamePageText(p, id, p.pages[0].text + "Z", 2700);
    expect(p.future).toHaveLength(0);
    expect(undoGame(p).pages[0].text.endsWith("X")).toBe(true);
    expect(validateGameProject(p)).toBe(true);
  });
});
describe("decision groups and page flow", () => {
  it("resolves only the selected decision group, and undo restores its alternatives", () => {
    const p = executeVHTML(
      createGameProject("Opening."),
      '<option: id: "a" name: "A" group: "decision" result: <page: append>><option: id: "b" name: "B" group: "decision" result: <page: append>><option: id: "c" name: "C" group: "independent" result: <page: append>>',
    ).project;
    const result = executeOption(p, "a").project;
    expect(result.options.map((o) => !!o.resolved)).toEqual([
      true,
      true,
      false,
    ]);
    expect(optionEnabled(result, result.options[1])).toBe(false);
    expect(optionEnabled(result, result.options[2])).toBe(true);
    expect(undoGame(result).options.map((o) => !!o.resolved)).toEqual([
      false,
      false,
      false,
    ]);
    expect(redoGame(undoGame(result)).options[1].resolved).toBe(true);
  });
  it("moves AI choices to a fresh page by default, with an explicit append preference", () => {
    const p = executeVHTML(
      createGameProject("Opening."),
      '<option: id: "a" name: "A" result: <page: append><ai>>',
    ).project;
    const result = executeOption(p, "a");
    expect(result.project.pages).toHaveLength(2);
    expect(result.generation).toBeDefined();
    expect(undoGame(finishGameAction(result.project)).pages).toHaveLength(1);
    const append = executeVHTML(p, "<config: choice-new-page: false>").project;
    expect(executeOption(append, "a").project.pages).toHaveLength(1);
  });
  it("leaves alternatives intact when a later choice action fails", () => {
    const p = executeVHTML(
      createGameProject(),
      '<option: id: "a" name: "A" result: <modify: stat: "missing" increase: 1>>',
    ).project;
    const before = JSON.stringify(p);
    expect(() => executeOption(p, "a")).toThrow();
    expect(JSON.stringify(p)).toBe(before);
  });
});
describe("contextual V-HTML completion", () => {
  const list = (text: string) => vhtmlCompletions(text, text.length);
  it("explains suggested commands using executable examples and describes real references", () => {
    const game = executeVHTML(
      createGameProject(),
      '<add: stat: id: "money" name: "Para" type: integer default: 50><add: event: id: "chase" name: "Chase"><display: id: "money-view" target: "money" style: counter ui: global>',
    ).project;
    for (const item of list("<")) {
      expect(item.kind).toBe("command");
      expect(item.detail).not.toBe("");
      expect(() =>
        executeVHTML(
          item.label === "add" ? createGameProject() : game,
          item.example,
          { confirmed: true },
        ),
      ).not.toThrow();
    }
    const ref = vhtmlCompletions('<set: stat: "mo', 15, game)[0];
    expect(ref.kind).toBe("reference");
    expect(ref.detail).toContain("Para");
    expect(ref.example).toBe('"money"');
  });
  it("opens only inside commands, never in prose, closed tags, strings or comments", () => {
    for (const text of [
      "Normal prose",
      "<ai>",
      '<text: append: "<add:',
      "// <add:",
      "/* <add:",
    ])
      expect(list(text)).toEqual([]);
    expect(list("<ad").map((c) => c.label)).toContain("add");
    expect(list("<add:").map((c) => c.label)).toContain("stat");
    expect(list("<add: stat:").map((c) => c.label)).toContain("name");
    expect(list("<add: stat:").map((c) => c.label)).not.toContain("mechanic");
    expect(list("<add: stat: type: per").map((c) => c.insert)).toContain(
      "percentage ",
    );
    expect(list("<option: result: <pa").map((c) => c.label)).toContain("page");
  });
  it("replaces existing tokens, suggests real IDs, and uses executed field schemas", () => {
    const p = executeVHTML(
      createGameProject(),
      '<add: stat: id: "coins" name: "Coins">',
    ).project;
    const text = '<modify: stat: "co">';
    const cursor = text.indexOf("co") + 2;
    const item = vhtmlCompletions(text, cursor, p)[0];
    expect(text.slice(0, item.from) + item.insert + text.slice(item.to)).toBe(
      '<modify: stat: "coins">',
    );
    expect(list("<config: thinking-o").map((c) => c.insert)).toContain(
      "thinking-output-tokens: ",
    );
    expect(list('<modify: stat: "coins" inc').map((c) => c.insert)).toEqual([
      "increase: ",
    ]);
  });
});

it("keeps every executable example in the guide valid against the actual runtime", () => {
  const guide = readFileSync(
    new URL("../docs/vhtml-guide-tr.txt", import.meta.url),
    "utf8",
  );
  const script = guide
    .split("\n")
    .filter((line) => line.startsWith("<") && line.trimEnd().endsWith(">"))
    .join("\n");
  expect(script).toContain("<option:");
  expect(
    validateGameProject(
      executeVHTML(createGameProject(), script, { confirmed: true }).project,
    ),
  ).toBe(true);
});
