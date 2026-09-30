import { describe, it, expect } from "vitest";
import { newStory, newLore, newNote } from "../src/types";
import { buildPrompt, activateLore } from "../src/context/promptBuilder";
import { validateUpdates, applyUpdate } from "../src/generation/stateUpdater";
import { retryBase, cleanContinuation } from "../src/generation/history";
import { importProject, exportProject } from "../src/storage/transfer";
describe("context assembly", () => {
  it("respects an independent input limit", () => {
    const s = newStory(true);
    s.text = "Old paragraph.\n\n".repeat(500) + "The final sentence.";
    s.settings.inputTokens = 400;
    s.settings.context = 8192;
    s.settings.maxTokens = 200;
    const p = buildPrompt(s);
    expect(p.budget).toBe(400);
    expect(p.total).toBeLessThanOrEqual(400);
    expect(p.trimmed).toBeGreaterThan(0);
    expect(p.prompt).toContain("The final sentence.");
  });
  it("caps input by total context after reserving output", () => {
    const s = newStory();
    s.settings.inputTokens = 6000;
    s.settings.context = 2000;
    s.settings.maxTokens = 500;
    expect(buildPrompt(s).budget).toBe(1500);
  });
  it("includes separate context and ends at the exact continuation", () => {
    const s = newStory(true);
    s.author.depth = 0;
    const p = buildPrompt(s);
    expect(p.prompt).toContain("[MEMORY]");
    expect(p.prompt).toContain("[CURRENT STATE");
    expect(p.prompt.endsWith(s.text.split("\n\n").at(-1)!)).toBe(true);
    expect(p.sections.some((s) => s.name === "Notes")).toBe(true);
  });
  it("trims old prose first and keeps permanent context", () => {
    const s = newStory(true);
    s.text = "OLD ".repeat(5000) + "END";
    s.settings.context = 650;
    s.settings.maxTokens = 100;
    const p = buildPrompt(s);
    expect(p.trimmed).toBeGreaterThan(0);
    expect(p.prompt).toContain(s.memory.content);
    expect(p.prompt).toContain(s.notes[0].content);
    expect(p.total).toBeLessThanOrEqual(550);
    expect(p.prompt.endsWith("END")).toBe(true);
  });
  it("blocks rather than discards oversized memory", () => {
    const s = newStory();
    s.memory.content = "Important ".repeat(5000);
    s.settings.context = 500;
    const p = buildPrompt(s);
    expect(p.overflow).toBe(true);
    expect(p.prompt).toContain(s.memory.content);
  });
  it("honors disabled memory, notes and keyword gates", () => {
    const s = newStory(true);
    s.memory.enabled = false;
    s.notes[0].keywords = "nonexistent";
    const p = buildPrompt(s);
    expect(p.prompt).not.toContain(s.memory.content);
    expect(p.prompt).not.toContain(s.notes[0].content);
  });
  it("uses a custom saved prompt template without dropping story context", () => {
    const s = newStory();
    s.text = "An opening line.";
    s.memory.content = "The room is quiet.";
    s.promptTemplate = "Write in a spare style.\n{{context}}\n{{story}}";
    const p = buildPrompt(s);
    expect(p.invalidTemplate).toBe(false);
    expect(p.prompt).toContain("Write in a spare style.");
    expect(p.prompt).toContain("The room is quiet.");
    expect(p.prompt.endsWith("An opening line.")).toBe(true);
    s.promptTemplate = "Missing placeholders";
    expect(buildPrompt(s).invalidTemplate).toBe(true);
  });
});
describe("lore", () => {
  it("honors keyword, secondary, case and constant activation", () => {
    const s = newStory();
    s.text = "Mira entered Tokyo.";
    s.lore = [
      {
        ...newLore(),
        keywords: "mira",
        content: "A student",
        secondary: "Tokyo",
      },
    ];
    expect(activateLore(s)[0].active).toBe(true);
    s.lore[0].caseSensitive = true;
    expect(activateLore(s)[0].active).toBe(false);
    s.lore[0].constant = true;
    expect(activateLore(s)[0].active).toBe(true);
    s.lore[0].probability = 0;
    expect(activateLore(s)[0].active).toBe(false);
  });
  it("prioritizes lore within the budget and respects scan depth", () => {
    const s = newStory();
    s.text = "Mira\n\nDaniel";
    s.loreBudget = 10;
    s.lore = [
      {
        ...newLore(),
        constant: true,
        priority: 1,
        content: "Long ".repeat(10),
      },
      {
        ...newLore(),
        keywords: "Daniel",
        priority: 100,
        content: "Photographer",
      },
      { ...newLore(), keywords: "Mira", scanDepth: 1, content: "Student" },
    ];
    const result = activateLore(s);
    expect(result.find((x) => x.entry.priority === 100)?.active).toBe(true);
    expect(result.filter((x) => x.active)).toHaveLength(1);
  });
  it("uses identical probability decisions across previews", () => {
    const s = newStory(true);
    s.lore = [{ ...newLore(), constant: true, probability: 50 }];
    expect(buildPrompt(s).prompt).toBe(buildPrompt(s).prompt);
  });
});
describe("safe note updates", () => {
  it("rejects locked or uneditable notes", () => {
    const n = { ...newNote(), locked: true };
    expect(() =>
      validateUpdates(
        JSON.stringify({ updates: [{ noteId: n.id, newContent: "changed" }] }),
        [n],
      ),
    ).toThrow();
    n.locked = false;
    n.aiEditable = false;
    expect(() =>
      validateUpdates(
        JSON.stringify({ updates: [{ noteId: n.id, newContent: "changed" }] }),
        [n],
      ),
    ).toThrow();
  });
  it.each([
    "bad",
    "{}",
    '{"updates":null}',
    '{"updates":[{"noteId":"missing","newContent":"x"}]}',
  ])("rejects malformed output %s", (raw) =>
    expect(() => validateUpdates(raw, [newNote()])).toThrow(),
  );
  it("records history and rejects stale patches", () => {
    const n = { ...newNote(), content: "old" };
    const u = validateUpdates(
      JSON.stringify({ updates: [{ noteId: n.id, newContent: "new" }] }),
      [n],
    )[0];
    const result = applyUpdate([n], u);
    expect(result[0].content).toBe("new");
    expect(result[0].revisions[0].content).toBe("old");
    expect(applyUpdate([{ ...n, content: "edited" }], u)[0].content).toBe(
      "edited",
    );
  });
  it("rejects duplicate operations", () => {
    const n = newNote();
    const u = { noteId: n.id, newContent: "new" };
    expect(() =>
      validateUpdates(JSON.stringify({ updates: [u, u] }), [n]),
    ).toThrow();
  });
});
describe("history and transfer", () => {
  it("allows exact retry and rejects edits to earlier prose", () => {
    const s = newStory();
    s.text = "before after";
    s.segments = [{ id: "a", before: "before", after: s.text, at: 1 }];
    expect(retryBase(s).before).toBe("before");
    s.text = "edited after";
    expect(() => retryBase(s)).toThrow();
  });
  it("removes model prefaces without damaging prose", () => {
    expect(cleanContinuation("Assistant: Daniel arrived.")).toBe(
      "Daniel arrived.",
    );
    expect(cleanContinuation(" Daniel arrived.")).toBe(" Daniel arrived.");
  });
  it("round-trips project context and rejects invalid imports", () => {
    const s = newStory(true);
    expect(importProject(exportProject(s)).text).toBe(s.text);
    expect(importProject(exportProject(s)).notes).toEqual(s.notes);
    expect(() => importProject('{"story":null}')).toThrow();
  });
  it("imports older projects without an input-token setting", () => {
    const s = newStory();
    const data = JSON.parse(exportProject(s));
    delete data.story.settings.inputTokens;
    expect(importProject(JSON.stringify(data)).settings.inputTokens).toBe(
      s.settings.context,
    );
  });
  it("strips extra credential fields from exports", () => {
    const s = newStory();
    Object.assign(s.connection, { apiKey: "secret" });
    expect(exportProject(s)).not.toContain("secret");
  });
});
