import { describe, it, expect } from "vitest";
import { newStory, newNote } from "../src/types";
import { packStory, unpackStory } from "../src/storage/compact";
import { exportProject, importProject } from "../src/storage/transfer";
import { branchTitle, trimIncomplete } from "../src/generation/history";
import { buildRewritePrompt } from "../src/generation/rewrite";
import { buildPrompt, estimate } from "../src/context/promptBuilder";
import { taskInstructions } from "../src/providers/types";

describe("compact persistence", () => {
  it("retains a large manuscript's complete history without full copies", () => {
    const s = newStory();
    const base = "A paragraph of a long manuscript.\n\n".repeat(16000);
    for (let i = 0; i < 50; i++) {
      const before = base + " Another sentence.".repeat(i);
      const after = before + " Another sentence.";
      s.past.push(before);
      s.segments.push({ id: String(i), before, after, at: i });
    }
    s.text = s.segments.at(-1)!.after;
    s.lastUpdateText = s.text;
    s.snapshots = [
      { id: "snapshot", title: "Saved", text: base, at: 0, notes: [] },
    ];
    const old = JSON.stringify({
      format: "margin-project",
      version: 1,
      story: s,
    });
    const packed = exportProject(s);
    expect(old.length).toBeGreaterThan(50_000_000);
    expect(packed.length).toBeLessThan(800_000);
    expect(importProject(packed)).toEqual(s);
    expect(importProject(old)).toEqual(s);
    expect(unpackStory(packStory(s))).toEqual(s);
  }, 20000);
  it("round-trips middle replacements, deletions, redo states and note revisions", () => {
    const s = newStory();
    const text = "Before. ".repeat(80) + "Original." + " After.".repeat(80);
    s.text = text.replace("Original.", "Replacement.");
    s.past = [text, text.slice(20)];
    s.future = [s.text + " Future."];
    const note = newNote();
    note.content = "At home.";
    note.revisions = [
      { id: "revision", content: "At school.", at: 1, source: "AI" },
    ];
    s.notes = [note];
    s.segments = [
      {
        id: "segment",
        before: text,
        after: s.text,
        at: 2,
        notesBefore: structuredClone(s.notes),
        notesAfter: structuredClone(s.notes),
      },
    ];
    s.snapshots = [
      {
        id: "snap",
        title: "Saved",
        text,
        at: 1,
        notes: structuredClone(s.notes),
      },
    ];
    expect(importProject(exportProject(s))).toEqual(s);
    const packed = packStory(s);
    expect(packed.revisions).toHaveLength(1);
    expect(packed.noteSnapshots).toHaveLength(1);
  });
  it("rejects broken and cyclic delta references", () => {
    const packed = packStory(newStory());
    packed.documents.push({ base: 1, keep: 0, tail: 0, insert: "invalid" });
    expect(() => unpackStory(packed)).toThrow("Invalid document delta");
  });
});

describe("writing controls", () => {
  it("reserves context for OpenRouter's system instruction", () => {
    const s = newStory();
    s.connection.kind = "openrouter";
    expect(buildPrompt(s).budget).toBe(
      s.settings.context -
        s.settings.maxTokens -
        s.settings.thinkingMaxTokens -
        estimate(taskInstructions.writing) -
        12,
    );
  });
  it("trims only incomplete AI suffixes, keeping user text untouched", () => {
    expect(trimIncomplete("She looked at her with", " a smile. Then she")).toBe(
      " a smile.",
    );
    expect(
      trimIncomplete("An unfinished input", " and more unfinished text"),
    ).toBe("");
    expect(trimIncomplete("", '"Come in," she said.\n\nHe smiled.\n')).toBe(
      '"Come in," she said.\n\nHe smiled.\n',
    );
    expect(trimIncomplete("", "She smiled. She looked at her with...")).toBe(
      "She smiled.",
    );
    expect(trimIncomplete("", "Dr. Smith paid 3.14 dollars. Then")).toBe(
      "Dr. Smith paid 3.14 dollars.",
    );
    expect(trimIncomplete("", "Merhaba! Sonra kapıya")).toBe("Merhaba!");
    expect(trimIncomplete("", "她笑了。然后她")).toBe("她笑了。");
  });
  it("numbers branches across a family without repeated suffixes", () => {
    const root = newStory();
    root.title = "My story";
    const first = {
      ...root,
      id: "one",
      parent: root.id,
      title: "My story · Branch 1",
    };
    const second = {
      ...root,
      id: "two",
      parent: first.id,
      title: "My story · Branch 2",
    };
    expect(branchTitle(root, [root])).toBe("My story · Branch 1");
    expect(branchTitle(first, [root, first, second])).toBe(
      "My story · Branch 3",
    );
  });
  it("keeps selection and instructions while trimming surrounding rewrite context", () => {
    const s = newStory();
    s.settings.context = 1200;
    s.settings.thinkingMaxTokens = 0;
    s.text =
      "Old prose. ".repeat(400) +
      "Selected passage." +
      " Following prose.".repeat(400);
    const from = s.text.indexOf("Selected passage.");
    const prompt = buildRewritePrompt(
      s,
      from,
      from + 17,
      "Keep events; make the dialogue natural.",
    );
    expect(prompt).toContain('SELECTED PASSAGE: "Selected passage."');
    expect(prompt).toContain("make the dialogue natural");
    expect(prompt).not.toContain("Old prose. ".repeat(400));
    s.settings.context = 300;
    expect(() =>
      buildRewritePrompt(s, 0, s.text.length, "Improve clarity"),
    ).toThrow("Max Context");
  });
});
