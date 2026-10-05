import { afterEach, describe, expect, it, vi } from "vitest";
import { newNote, newStory, DEFAULT_NOTE_PROMPT } from "../src/types";
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
    source.settings.creativeNotes = true;
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
    expect(importProject(exportProject(s)).settings.creativeNotes).toBe(true);
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
    expect(importProject(JSON.stringify(legacy)).settings.creativeNotes).toBe(
      false,
    );
  });
});
describe("creative notes", () => {
  it("defaults to evidence and only lifts evidence restrictions when explicitly enabled", () => {
    const s = newStory(true);
    s.notes.push({ ...newNote(), title: "Personality" });
    expect(updaterPrompt(s, "Hello.")).toContain("NOTE MODE: EVIDENCE ONLY");
    s.settings.creativeNotes = true;
    const p = updaterPrompt(s, "Hello.");
    expect(p).toContain("NOTE MODE: CREATIVE");
    expect(p).toContain("blank notes");
    expect(p).not.toContain("Use only the supplied prose as evidence.");
    expect(p).toContain(s.memory.content);
    expect(p).toContain('"noteId"');
    expect(p).not.toContain("{{notes}}");
    s.notePromptTemplate = DEFAULT_NOTE_PROMPT + "\nCustom rule.";
    expect(updaterPrompt(s, "")).toContain(
      "overrides evidence-only restrictions",
    );
    expect(updaterPrompt(s, "")).toContain("Custom rule.");
  });
  it("keeps context budget, locks and note modes enforced in creative mode", () => {
    const s = newStory(true);
    s.settings.creativeNotes = true;
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
    s.settings.context = 1000;
    s.memory.content = "Large memory. ".repeat(500);
    expect(() => buildNotePrompt(s, "Hello.")).toThrow("Max Context");
  });
});
