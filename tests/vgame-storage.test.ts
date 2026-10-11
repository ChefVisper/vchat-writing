import { describe, expect, it } from "vitest";
import { newStory } from "../src/types";
import { exportProject, importProject } from "../src/storage/transfer";
import {
  appendGameText,
  createGameProject,
  executeVHTML,
  executeOption,
  proposeVHTML,
  undoGame,
  redoGame,
  validateGameProject,
} from "../src/vgame/runtime";

describe("Vgame storage compatibility", () => {
  it("keeps legacy co-writing projects unchanged and without a game", () => {
    const story = newStory();
    story.text = "Existing manuscript.\n\nSecond paragraph.";
    story.past = ["Existing manuscript."];
    story.future = [story.text + " Future."];
    const restored = importProject(exportProject(story));
    expect(restored.text).toBe(story.text);
    expect(restored.past).toEqual(story.past);
    expect(restored.future).toEqual(story.future);
    expect(restored.vgame).toBeUndefined();
  });

  it("round-trips independent pages, scopes, events, instructions and pending proposals", () => {
    const story = newStory();
    story.text = "The original Vchat manuscript.";
    let game = createGameProject(story.text);
    game = executeVHTML(
      game,
      '<add: stat: id: "money" name: "Money"> <set: stat: "money" value: 40> <add: event: id: "forest" name: "Forest"> <trigger: event: "forest" action: start> <panel: id: "stats" name: "Stats" ui: global> <display: id: "funds" stat: "money" ui: global panel: "stats"> <display: id: "danger" stat: "money" ui: event event: "forest" remove-on: event-end> <ai-instruct: id: "style" scope: global content: "Keep a close viewpoint."> <page: next> <text: append: "A different game page.">',
    ).project;
    game = proposeVHTML(game, {
      id: "new-world",
      source: '<add: thing: id: "stone" name: "Stone">',
      reason: "A new object.",
    }).project;
    game.settings.maxContextTokens = 64000;
    game.settings.maxHistoryPages = 30;
    game.settings.reserveTokens = 8192;
    game.settings.maxOutputTokens = 1024;
    game.settings.thinking = true;
    story.vgame = game;
    const restored = importProject(exportProject(story));
    expect(restored.vgame).toEqual(game);
    expect(restored.text).toBe(story.text);
    expect(restored.vgame!.proposals[0].status).toBe("pending");
    expect(restored.vgame!.history).toEqual(game.history);
    expect(validateGameProject(restored.vgame)).toBe(true);
    expect(redoGame(undoGame(restored.vgame!)).pages).toEqual(game.pages);
  });

  it("clears a crashed generation lock on import while retaining once-only option usage", () => {
    const story = newStory();
    const game = executeVHTML(
      createGameProject(),
      '<add: stat: id: "money" name: "Money"> <option: id: "take" name: "Take" result: <modify: stat: "money" increase: 10> <ai>>',
    ).project;
    story.vgame = executeOption(game, "take").project;
    expect(story.vgame.actionLock).toBeDefined();
    const restored = importProject(exportProject(story));
    expect(restored.vgame!.actionLock).toBeUndefined();
    expect(restored.vgame!.options[0].used).toBe(true);
    expect(restored.vgame!.objects[0].value).toBe(10);
    expect(() => executeOption(restored.vgame!, "take")).toThrow();
  });

  it("rejects invalid game state and prototype history paths without replacing the story", () => {
    const story = newStory();
    story.vgame = createGameProject();
    story.vgame.history = [
      {
        id: "bad",
        at: 1,
        origin: "user",
        label: "bad",
        changes: [{ path: ["__proto__", "injected"], after: true }],
      },
    ];
    expect(() => importProject(exportProject(story))).toThrow(/Vgame/);
    expect(({} as Record<string, unknown>).injected).toBeUndefined();
    story.vgame.history = [];
    story.vgame.activePageId = "missing";
    expect(() => importProject(exportProject(story))).toThrow(/Vgame/);
  });

  it("rejects malformed proposal messages before they reach the inbox", () => {
    const story = newStory();
    story.vgame = proposeVHTML(createGameProject(), {
      id: "bad-message",
      source: '<add: thing: id: "stone" name: "Stone">',
      reason: "A new object.",
    }).project;
    Object.assign(story.vgame.proposals[0], { error: { malformed: true } });
    expect(() => importProject(exportProject(story))).toThrow(/Vgame/);
  });

  it("stores a long manuscript and 80 appends as compact changes, not 80 full copies", () => {
    const story = newStory();
    story.text = "Saved prose. ".repeat(40000);
    let game = createGameProject(story.text);
    for (let i = 0; i < 80; i++)
      game = appendGameText(game, `\nContinuation ${i}.`).project;
    story.vgame = game;
    const raw = exportProject(story),
      restored = importProject(raw);
    expect(raw.length).toBeLessThan(story.text.length * 2.3);
    expect(restored.vgame!.pages[0].text).toBe(game.pages[0].text);
    expect(restored.vgame!.history).toHaveLength(80);
    expect(undoGame(restored.vgame!).pages[0].text).toBe(
      game.pages[0].text.replace(/\nContinuation 79\.$/, ""),
    );
  }, 15000);
});
