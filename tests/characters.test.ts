import { afterEach, describe, expect, it, vi } from "vitest";
import {
  newNote,
  newStory,
  DEFAULT_NOTE_PROMPT,
  upgradeNoteCreativity,
} from "../src/types";
import { creationStory } from "../src/generation/creation";
import { greetingStory } from "../src/generation/greetings";
import {
  chubPath,
  mapCharacterCard,
  fetchChubCharacter,
} from "../src/generation/characterImport";
import { exportProject, importProject } from "../src/storage/transfer";
import {
  updaterPrompt,
  buildNotePrompt,
  validateUpdates,
} from "../src/generation/stateUpdater";

const definition = {
  name: "Mira",
  personality: "{{char}} is a librarian.",
  tavern_personality: "Reserved.",
  scenario: "A public library.",
  first_message: "Mira opened the door.",
  alternate_greetings: ["Mira waved from the desk.", "A book fell."],
  example_dialogs: "{{char}}: Hello.",
  description: "A creator's explanation.",
  system_prompt: "Use quiet dialogue.",
  post_history_instructions: "Stay in the library.",
  embedded_lorebook: {
    entries: [
      {
        name: "Library",
        content: "Built in 1980.",
        keys: ["library"],
        enabled: true,
      },
    ],
  },
};
afterEach(() => vi.unstubAllGlobals());
describe("character links and import", () => {
  it.each([
    "chub.ai/author/mira",
    "https://chub.ai/characters/author/mira?x=1#test",
    "https://characterhub.org/author/mira/",
  ])("parses supported link %s", (u) =>
    expect(chubPath(u)).toBe("author/mira"),
  );
  it.each([
    "https://chub.ai.evil.test/a/b",
    "https://chub.ai@evil.test/a/b",
    "https://chub.ai:4433/a/b",
    "https://chub.ai/presets/a",
    "https://chub.ai/characters/a/b/c",
    "https://chub.ai/a/%2Fsecret",
    "javascript:alert(1)",
  ])("rejects invalid link %s", (u) => expect(() => chubPath(u)).toThrow());
  it("maps Chub definitions to editable character fields without importing credentials or settings", () => {
    const card = mapCharacterCard(
      { node: { definition }, settings: { apiKey: "must-not-copy" } },
      "https://chub.ai/characters/a/b",
    );
    expect(card.result).toMatchObject({
      title: "Mira",
      startingText: definition.first_message,
      alternateGreetings: definition.alternate_greetings,
    });
    expect(card.result.memory).toContain(
      "Description:\n{{char}} is a librarian.",
    );
    expect(card.result.memory).toContain("Scenario:\nA public library.");
    expect(card.author).toBe("Use quiet dialogue.\n\nStay in the library.");
    expect(card.lore[0]).toMatchObject({
      title: "Library",
      keywords: "library",
      content: "Built in 1980.",
    });
    expect(JSON.stringify(card)).not.toContain("must-not-copy");
    expect(card.result.memory).not.toContain(definition.description);
  });
  it("accepts Tavern V1, V2 and V3 fields and rejects malformed or excessive data", () => {
    const data = {
      name: "Mira",
      description: "Tall.",
      first_mes: "Hello.",
      alternate_greetings: ["Bye."],
    };
    expect(mapCharacterCard(data).result).toEqual(
      mapCharacterCard({ spec: "chara_card_v2", data }).result,
    );
    expect(mapCharacterCard({ spec: "chara_card_v3", data }).result).toEqual(
      mapCharacterCard(data).result,
    );
    expect(() =>
      mapCharacterCard({ data: { ...data, alternate_greetings: [5] } }),
    ).toThrow();
    expect(() => mapCharacterCard({ node: {} })).toThrow();
    expect(() =>
      mapCharacterCard({
        data: { ...data, character_book: { entries: [null] } },
      }),
    ).toThrow();
  });
  it("fetches only the public Chub endpoint without cookies or app API keys", async () => {
    const fetch = vi.fn(async () => Response.json({ node: { definition } }));
    vi.stubGlobal("fetch", fetch);
    expect(
      (
        await fetchChubCharacter(
          "chub.ai/author/mira",
          new AbortController().signal,
        )
      ).result.title,
    ).toBe("Mira");
    expect(fetch.mock.calls[0]).toMatchObject([
      "https://api.chub.ai/api/characters/author/mira?full=true",
      { credentials: "omit", headers: { Accept: "application/json" } },
    ]);
    fetch.mockImplementation(async () => new Response("no", { status: 404 }));
    await expect(
      fetchChubCharacter("chub.ai/author/mira", new AbortController().signal),
    ).rejects.toThrow("not found");
  });
  it("rejects HTML and responses larger than 4 MB", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<html>no</html>")),
    );
    await expect(
      fetchChubCharacter("chub.ai/a/b", new AbortController().signal),
    ).rejects.toThrow("JSON");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("x".repeat(4 * 1024 * 1024 + 1))),
    );
    await expect(
      fetchChubCharacter("chub.ai/a/b", new AbortController().signal),
    ).rejects.toThrow("4 MB");
  });
});
describe("greetings", () => {
  it("starts an independent session with copied context/settings and fresh generation history", () => {
    const source = newStory(true);
    source.notes[0].creative = true;
    source.greetings = [
      { id: "g", title: "Greeting 1", text: "Different opening." },
    ];
    source.past = ["Old."];
    source.pending = [
      { noteId: source.notes[0].id, oldContent: "", newContent: "Pending." },
    ];
    const s = greetingStory(source, source.greetings[0]);
    expect(s.text).toBe("Different opening.");
    expect(s.memory).toEqual(source.memory);
    expect(s.notes).toEqual(source.notes);
    expect(s.settings).toEqual(source.settings);
    expect(s.id).not.toBe(source.id);
    expect(s.past).toEqual([]);
    expect(s.pending).toEqual([]);
    s.notes[0].content = "Changed.";
    expect(source.notes[0].content).not.toBe("Changed.");
    expect(importProject(exportProject(s)).greetings).toEqual(s.greetings);
    expect(importProject(exportProject(s)).notes[0].creative).toBe(true);
    expect(() =>
      greetingStory(source, { id: "x", title: "Empty", text: "" }),
    ).toThrow();
  });
  it("stores both primary and alternate openings from creation", () => {
    const source = newStory();
    const result = mapCharacterCard({ node: { definition } }).result;
    const s = creationStory(result, source, "", source.connection);
    expect(s.greetings?.map((g) => g.text)).toEqual([
      definition.first_message,
      ...definition.alternate_greetings,
    ]);
    expect(new Set(s.greetings?.map((g) => g.id)).size).toBe(3);
    const exported = JSON.parse(exportProject(s));
    exported.story.greetings = [{ id: "1", title: "bad", text: 9 }];
    expect(() => importProject(JSON.stringify(exported))).toThrow("greetings");
    const legacy = JSON.parse(exportProject(s));
    delete legacy.story.greetings;
    delete legacy.story.settings.creativeNotes;
    expect(
      importProject(JSON.stringify(legacy)).settings.creativeNotes,
    ).toBeUndefined();
    expect(newNote().creative).toBe(false);
  });
});
describe("creative notes", () => {
  it("migrates legacy global permission across saved notes and history without changing explicit note choices", () => {
    const s = newStory(true);
    delete s.notes[0].creative;
    s.settings.creativeNotes = true;
    s.notes.push({ ...newNote(), creative: false });
    s.snapshots.push({
      id: "snap",
      title: "Old",
      at: 1,
      text: "Old.",
      notes: structuredClone(s.notes),
    });
    s.segments.push({
      id: "seg",
      before: "",
      after: "Old.",
      at: 1,
      notesBefore: structuredClone(s.notes),
      notesAfter: structuredClone(s.notes),
    });
    const migrated = upgradeNoteCreativity(s);
    expect(migrated.notes.map((n) => n.creative)).toEqual([true, false]);
    expect(migrated.snapshots[0].notes.map((n) => n.creative)).toEqual([
      true,
      false,
    ]);
    expect(migrated.segments[0].notesBefore?.map((n) => n.creative)).toEqual([
      true,
      false,
    ]);
    expect(migrated.segments[0].notesAfter?.map((n) => n.creative)).toEqual([
      true,
      false,
    ]);
    expect(migrated.settings.creativeNotes).toBeUndefined();
    expect(s.notes[0].creative).toBeUndefined();
    const roundTrip = importProject(exportProject(s));
    expect(roundTrip.notes.map((n) => n.creative)).toEqual([true, false]);
    const old = JSON.parse(exportProject(newStory(true)));
    old.story.settings.creativeNotes = true;
    delete old.story.notes[0].creative;
    expect(importProject(JSON.stringify(old)).notes[0].creative).toBe(true);
    old.story.notes[0].creative = "yes";
    expect(() => importProject(JSON.stringify(old))).toThrow();
  });
  it("only editable, enabled, unlocked creative notes activate the creative request", () => {
    const s = newStory(true);
    s.notes[0].creative = true;
    for (const patch of [
      { enabled: false },
      { aiEditable: false },
      { locked: true },
      { mode: "off" as const },
    ]) {
      const blocked = { ...s, notes: [{ ...s.notes[0], ...patch }] };
      expect(updaterPrompt(blocked, "")).toContain("NOTE MODE: EVIDENCE ONLY");
    }
    s.notes[0].creative = false;
    expect(updaterPrompt(s, "")).toContain("NOTE MODE: EVIDENCE ONLY");
  });
  it("defaults to evidence and only lifts evidence restrictions when explicitly enabled", () => {
    const s = newStory(true);
    s.notes.push({ ...newNote(), title: "Personality" });
    expect(updaterPrompt(s, "Hello.")).toContain("NOTE MODE: EVIDENCE ONLY");
    s.notes[1].creative = true;
    const p = updaterPrompt(s, "Hello.");
    expect(p).toContain("NOTE MODE: PER NOTE");
    expect(p).toContain("blank notes");
    expect(p).not.toContain("Use only the supplied prose as evidence.");
    expect(p).toContain(s.memory.content);
    const notes = JSON.parse(p.split("NOTES:\n")[1].split("\n\nNEW PROSE:")[0]);
    expect(notes.map((n: any) => [n.noteId, n.creative])).toEqual([
      [s.notes[0].id, false],
      [s.notes[1].id, true],
    ]);
    expect(p).toContain("never transfer creative permission from another note");
    expect(p).not.toContain("{{notes}}");
    s.notePromptTemplate = DEFAULT_NOTE_PROMPT + "\nCustom rule.";
    expect(updaterPrompt(s, "")).toContain(
      "overrides evidence-only restrictions",
    );
    expect(updaterPrompt(s, "")).toContain("Custom rule.");
  });
  it("keeps context budget, locks and note modes enforced in creative mode", () => {
    const s = newStory(true);
    s.notes[0].creative = true;
    s.notes[0].locked = true;
    expect(updaterPrompt(s, "Hello.")).not.toContain(s.notes[0].id);
    expect(() =>
      validateUpdates(
        JSON.stringify({
          updates: [{ noteId: s.notes[0].id, newContent: "Invented." }],
        }),
        s.notes,
      ),
    ).toThrow();
    s.notes.push({ ...newNote(), creative: true });
    s.settings.context = 6000;
    s.memory.content = "Large memory. ".repeat(2000);
    expect(() => buildNotePrompt(s, "Hello.")).toThrow("Max Context");
  });
});
