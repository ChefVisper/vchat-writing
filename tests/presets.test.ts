import { afterEach, describe, it, expect, vi } from "vitest";
import { providers } from "../src/providers";
import {
  taskInstruction,
  taskInstructions,
  type Request,
} from "../src/providers/types";
import { DEFAULT_PROMPT_TEMPLATE, newNote, newStory } from "../src/types";
import {
  activeWritingTemplate,
  addWriterBlockNotes,
  isWriterBlockConfig,
  newWriterBlockConfig,
  wbGroups,
  wbModules,
  wbTones,
  writerBlockRules,
  WRITERS_BLOCK_TEMPLATE,
} from "../src/presets/writersBlock";
import { buildPrompt } from "../src/context/promptBuilder";
import {
  buildNotePrompt,
  updaterPrompt,
  validateUpdates,
} from "../src/generation/stateUpdater";
import { buildRewritePrompt } from "../src/generation/rewrite";
import { creationStory } from "../src/generation/creation";
import { greetingStory } from "../src/generation/greetings";
import { importProject, exportProject } from "../src/storage/transfer";

afterEach(() => vi.unstubAllGlobals());
describe("writing presets", () => {
  it.each(["openrouter", "nanogpt"] as const)(
    "%s honors preset viewpoint controls without changing the Default system contract",
    async (kind) => {
      const s = newStory();
      let body: any;
      vi.stubGlobal(
        "fetch",
        vi.fn(async (_url, init) => {
          body = JSON.parse(init.body);
          return Response.json({
            choices: [{ message: { content: "A sentence." } }],
          });
        }),
      );
      const r: Request = {
        prompt: "Continue",
        settings: { ...s.settings, streaming: false },
        connection: {
          kind,
          url: "https://test.invalid/v1",
          model: "test/writer",
        },
        key: "test-key",
        purpose: "writing",
        signal: new AbortController().signal,
        onToken: vi.fn(),
      };
      await providers[kind].generate(r);
      expect(body.messages[0].content).toBe(taskInstructions.writing);
      r.writingPreset = "writers-block";
      await providers[kind].generate(r);
      expect(body.messages[0].content).toContain(
        "unless the author or selected writing controls explicitly change",
      );
      expect(body.messages[0].content).toBe(
        taskInstruction("writing", "writers-block"),
      );
      for (const purpose of ["notes", "rewrite", "create"] as const)
        expect(taskInstruction(purpose, "writers-block")).toBe(
          taskInstructions[purpose],
        );
      s.connection = r.connection;
      s.writingPreset = "writers-block";
      expect(buildPrompt(s).budget).toBe(
        s.settings.context -
          s.settings.maxTokens -
          s.settings.thinkingMaxTokens -
          Math.ceil(
            new TextEncoder().encode(body.messages[0].content).length / 3.5,
          ) -
          12,
      );
    },
  );
  it("starts on Default, leaves the existing prompt and requests unchanged after switching", () => {
    const s = newStory(true);
    expect(s.writingPreset).toBe("default");
    expect(activeWritingTemplate(s)).toBe(DEFAULT_PROMPT_TEMPLATE);
    const original = structuredClone(s);
    const before = buildPrompt(s);
    const noteBefore = updaterPrompt(s, "Prose.");
    const rewriteBefore = buildRewritePrompt(s, 0, 20, "Polish");
    s.writingPreset = "writers-block";
    s.writersBlock = newWriterBlockConfig();
    s.writersBlock.choices.vocabulary = "ornate";
    s.writersBlock.extraInstructions = "WB-specific instruction.";
    expect(buildPrompt(s).prompt).toContain("WB-specific instruction.");
    s.writingPreset = "default";
    expect(buildPrompt(s)).toEqual(before);
    expect(updaterPrompt(s, "Prose.")).toBe(noteBefore);
    expect(buildRewritePrompt(s, 0, 20, "Polish")).toBe(rewriteBefore);
    for (const key of [
      "text",
      "memory",
      "author",
      "notes",
      "settings",
      "connection",
    ] as const)
      expect(s[key]).toEqual(original[key]);
  });
  it("isolates custom templates and honors missing placeholder errors for the active preset only", () => {
    const s = newStory();
    s.promptTemplate = "My original template\n{{context}}\n{{story}}";
    s.writersBlockTemplate = "My WB template\n{{context}}\n{{story}}";
    expect(activeWritingTemplate(s)).toBe(s.promptTemplate);
    s.writingPreset = "writers-block";
    expect(activeWritingTemplate(s)).toBe(s.writersBlockTemplate);
    expect(buildPrompt(s).invalidTemplate).toBe(false);
    s.writersBlockTemplate = "Invalid";
    expect(buildPrompt(s).invalidTemplate).toBe(true);
    s.writingPreset = "default";
    expect(buildPrompt(s).invalidTemplate).toBe(false);
    s.writingPreset = "writers-block";
    delete s.writersBlockTemplate;
    expect(activeWritingTemplate(s)).toBe(WRITERS_BLOCK_TEMPLATE);
  });
  it("every catalogue choice and toggle affects only the selected modular rules", () => {
    const s = newStory();
    s.writingPreset = "writers-block";
    s.writersBlock = newWriterBlockConfig();
    for (const [key, group] of Object.entries(wbGroups)) {
      for (const option of group.options) {
        s.writersBlock.choices[key as keyof typeof wbGroups] = option.id;
        const rules = writerBlockRules(s);
        if (option.rule) expect(rules).toContain(option.rule);
      }
    }
    for (const tone of wbTones) {
      s.writersBlock.tones = [tone.id];
      expect(writerBlockRules(s)).toContain(tone.rule);
    }
    s.writersBlock.modules = [];
    for (const module of wbModules) {
      expect(writerBlockRules(s)).not.toContain(module.rule);
      s.writersBlock.modules = [module.id];
      expect(writerBlockRules(s)).toContain(module.rule);
      s.writersBlock.modules = [];
    }
    expect(writerBlockRules(s)).not.toMatch(/\{\{|<\/?.*?>|setvar|getvar/);
  });
  it("protects selected rules during context trimming and reports overflow rather than removing them", () => {
    const s = newStory();
    s.writingPreset = "writers-block";
    s.writersBlock = newWriterBlockConfig();
    s.settings.context = 6000;
    s.text = "Long old prose. ".repeat(6000) + "Last character.";
    s.nextInstruction = "Keep the scene in the kitchen.";
    const p = buildPrompt(s);
    expect(p.trimmed).toBeGreaterThan(0);
    expect(p.overflow).toBe(false);
    expect(p.prompt.endsWith("Last character.")).toBe(true);
    expect(p.prompt).toContain(writerBlockRules(s));
    expect(p.prompt).toContain(s.nextInstruction);
    expect(p.breakdown["Writer's Block rules"]).toBeGreaterThan(0);
    s.settings.context = 256;
    expect(buildPrompt(s).overflow).toBe(true);
    expect(buildPrompt(s).prompt).toContain(writerBlockRules(s));
  });
  it("only asks for a separate continuity check when writing thinking has an allowance", () => {
    const s = newStory();
    s.writingPreset = "writers-block";
    s.writersBlock = newWriterBlockConfig();
    expect(writerBlockRules(s)).not.toContain("Continuity check:");
    s.settings.thinking = true;
    expect(writerBlockRules(s)).toContain("Continuity check:");
    expect(writerBlockRules(s)).toContain("do not print planning");
    s.settings.thinkingMaxTokens = 0;
    expect(writerBlockRules(s)).not.toContain("Continuity check:");
    s.settings.thinkingMaxTokens = 200;
    s.writersBlock.planning = false;
    expect(writerBlockRules(s)).not.toContain("Continuity check:");
  });
  it("rewrites use style without momentum, new cast or POV overrides", () => {
    const s = newStory(true);
    s.writingPreset = "writers-block";
    s.writersBlock = newWriterBlockConfig();
    s.writersBlock.choices.pov = "second";
    s.writersBlock.choices.vocabulary = "ornate";
    s.writersBlock.modules = wbModules.map((m) => m.id);
    const p = buildRewritePrompt(s, 0, 25, "Keep all events unchanged.");
    expect(p).toContain("Vocabulary: Use richly textured");
    expect(p).toContain("editing instruction takes priority");
    for (const excluded of [
      "Scene momentum:",
      "Point of view:",
      "Passage length:",
      "Distinct side characters:",
      "Lived-in setting:",
      "append after the final character",
    ])
      expect(p).not.toContain(excluded);
  });
  it("tracking notes are optional, idempotent, strict and reviewed without overwriting existing notes", () => {
    const s = newStory();
    s.writingPreset = "writers-block";
    expect(s.notes).toEqual([]);
    const existing = {
      ...newNote(),
      title: " scene STATE ",
      content: "Keep this.",
      locked: true,
      creative: true,
    };
    s.notes = addWriterBlockNotes([existing]);
    expect(s.notes).toHaveLength(3);
    expect(s.notes[0]).toBe(existing);
    expect(addWriterBlockNotes(s.notes)).toEqual(s.notes);
    for (const note of s.notes.slice(1))
      expect(note).toMatchObject({
        mode: "review",
        creative: false,
        content: "",
        aiEditable: true,
      });
    const p = buildNotePrompt(s, "Mira enters the kitchen.").prompt;
    expect(p).toContain("WRITER'S BLOCK NOTE TRACKING");
    expect(p).toContain("NOTE MODE: EVIDENCE ONLY");
    expect(p).not.toContain(existing.id);
    expect(() =>
      validateUpdates(
        JSON.stringify({
          updates: [{ noteId: existing.id, newContent: "Change" }],
        }),
        s.notes,
      ),
    ).toThrow();
    s.notes[1].creative = true;
    expect(updaterPrompt(s, "Prose.")).toContain("NOTE MODE: PER NOTE");
  });
  it("preserves profiles, both templates and choices in exports, creation and alternate greetings", () => {
    const s = newStory(true);
    s.writingPreset = "writers-block";
    s.writersBlock = newWriterBlockConfig();
    s.writersBlock.choices.pov = "first";
    s.writersBlock.tones = ["dark", "tender"];
    s.writersBlock.extraInstructions = "Be specific.";
    s.promptTemplate = "Default custom {{context}} {{story}}";
    s.writersBlockTemplate = "WB custom {{context}} {{story}}";
    expect(importProject(exportProject(s))).toEqual(s);
    const created = creationStory(
      { title: "New", memory: "Memory", startingText: "Start." },
      s,
      "",
      s.connection,
    );
    expect(created.writingPreset).toBe("writers-block");
    expect(created.writersBlock).toEqual(s.writersBlock);
    expect(created.writersBlock).not.toBe(s.writersBlock);
    expect(created.promptTemplate).toBe(s.promptTemplate);
    expect(created.writersBlockTemplate).toBe(s.writersBlockTemplate);
    const greeting = greetingStory(s, {
      id: "g",
      title: "Greeting",
      text: "Opening.",
    });
    expect(greeting.writersBlock).toEqual(s.writersBlock);
    expect(greeting.writingPreset).toBe("writers-block");
    expect(greeting.text).toBe("Opening.");
  });
  it("loads old stories on Default without replacing their custom template", () => {
    const d = JSON.parse(exportProject(newStory()));
    delete d.story.writingPreset;
    d.story.promptTemplate = "Keep custom {{context}} {{story}}";
    const s = importProject(JSON.stringify(d));
    expect(s.writingPreset).toBe("default");
    expect(activeWritingTemplate(s)).toBe(d.story.promptTemplate);
  });
  it("rejects unknown profiles, malformed module selections and oversized imported instructions", () => {
    const s = newStory();
    const good = newWriterBlockConfig();
    expect(isWriterBlockConfig(good)).toBe(true);
    for (const bad of [
      { ...good, choices: { pov: "omniscient" } },
      { ...good, choices: { constructor: "inherit" } },
      { ...good, tones: ["neutral", "neutral"] },
      { ...good, tones: wbTones.slice(0, 7).map((x) => x.id) },
      { ...good, modules: ["remote-script"] },
      { ...good, choices: [] },
      { ...good, planning: "yes" },
      { ...good, extraInstructions: "x".repeat(5001) },
    ]) {
      expect(isWriterBlockConfig(bad)).toBe(false);
      const d = JSON.parse(exportProject(s));
      d.story.writersBlock = bad;
      expect(() => importProject(JSON.stringify(d))).toThrow(
        "Invalid writing preset",
      );
    }
    for (const patch of [
      { writingPreset: "unknown" },
      { writersBlockTemplate: 4 },
      { writersBlockTemplate: "x".repeat(20001) },
    ]) {
      const d = JSON.parse(exportProject(s));
      Object.assign(d.story, patch);
      expect(() => importProject(JSON.stringify(d))).toThrow(
        "Invalid writing preset",
      );
    }
  });
});
