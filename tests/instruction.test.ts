import { describe, it, expect } from "vitest";
import { newStory, newNote } from "../src/types";
import { buildPrompt } from "../src/context/promptBuilder";
import { buildNotePrompt } from "../src/generation/stateUpdater";
import { buildRewritePrompt } from "../src/generation/rewrite";
import { importProject, exportProject } from "../src/storage/transfer";
describe("next instruction", () => {
  it("protects direction from context trimming without changing the continuation point", () => {
    const s = newStory();
    s.settings.thinkingMaxTokens = 0;
    s.settings.context = 1000;
    s.text = "Old prose. ".repeat(2000) + "Last sentence.";
    s.nextInstruction = "Keep Daniel silent.";
    const p = buildPrompt(s);
    expect(p.trimmed).toBeGreaterThan(0);
    expect(p.prompt).toContain(s.nextInstruction);
    expect(p.prompt.endsWith("Last sentence.")).toBe(true);
    s.nextInstruction = "Direction ".repeat(1500);
    expect(buildPrompt(s).overflow).toBe(true);
  });
  it("persists direction, pin and retry history without injecting them into notes or rewrites", () => {
    const s = newStory();
    s.text = "A sentence.";
    s.notes = [newNote()];
    s.nextInstruction = "Keep Daniel silent.";
    s.keepInstruction = true;
    s.segments = [
      {
        id: "one",
        at: 1,
        before: "",
        after: s.text,
        instruction: s.nextInstruction,
      },
    ];
    expect(importProject(exportProject(s))).toEqual(s);
    expect(buildNotePrompt(s, s.text).prompt).not.toContain(s.nextInstruction);
    expect(buildRewritePrompt(s, 0, s.text.length, "Polish")).not.toContain(
      s.nextInstruction,
    );
    s.keepInstruction = "yes" as any;
    expect(() => importProject(exportProject(s))).toThrow(
      "Invalid next instruction",
    );
  });
});
