import { afterEach, describe, expect, it, vi } from "vitest";
import { newLore, newStory, upgradeContinuationSettings } from "../src/types";
import {
  fetchLorebook,
  lorebookLink,
  mapLorebook,
  parseLorebookJSON,
} from "../src/lore/import";
import {
  attachImportedLorebooks,
  migrateLorebooks,
  newLorebook,
} from "../src/lore/library";
import { activateLore, buildPrompt } from "../src/context/promptBuilder";
import { buildRewritePrompt } from "../src/generation/rewrite";
import { exportProject, importProject } from "../src/storage/transfer";
import {
  continuationText,
  trimRepeatedPrefix,
} from "../src/generation/history";

afterEach(() => vi.unstubAllGlobals());
describe("universal lorebooks", () => {
  it("migrates existing lore without changing prose, history or entry options and is idempotent", () => {
    const s = newStory(true);
    s.lore = [
      { ...newLore(), title: "Mira", keywords: "Mira", probability: 60 },
    ];
    const initial = structuredClone(s);
    const m = migrateLorebooks([s], []);
    expect(m.library[0].entries).toEqual(initial.lore);
    expect(m.stories[0].text).toBe(initial.text);
    expect(m.stories[0].notes).toEqual(initial.notes);
    expect(m.stories[0].lore).toEqual([]);
    expect(m.stories[0].activeLorebooks).toEqual([m.library[0].id]);
    expect(migrateLorebooks(m.stories, m.library).changed).toBe(false);
    expect(migrateLorebooks([s], m.library).library).toHaveLength(1);
    expect(s).toEqual(initial);
  });
  it("selects shared books per story and uses the same references for rewriting and continuation", () => {
    const book = newLorebook("City", [
      { ...newLore(), constant: true, content: "City fact." },
    ]);
    const a = newStory();
    const b = newStory();
    a.activeLorebooks = [book.id];
    a.text = b.text = "A sentence.";
    expect(buildPrompt(a, [book]).prompt).toContain("City fact.");
    expect(buildPrompt(b, [book]).prompt).not.toContain("City fact.");
    expect(buildRewritePrompt(a, 0, 11, "Polish", [book])).toContain(
      "City fact.",
    );
    book.entries[0].content = "Updated shared fact.";
    expect(buildPrompt(a, [book]).prompt).toContain("Updated shared fact.");
    expect(buildPrompt(b, [book]).prompt).not.toContain("Updated shared fact.");
    a.loreBudget = 0;
    expect(activateLore(a, [book])[0].reason).toBe("Token budget");
  });
  it("portable projects bundle selected books; ID conflicts never replace a shared edited book", () => {
    const b = newLorebook("City", [
      { ...newLore(), constant: true, content: "Exported fact." },
    ]);
    const s = newStory();
    s.activeLorebooks = [b.id];
    const imported = importProject(
      exportProject(s, [b, newLorebook("Inactive")]),
    );
    expect(imported.lorebookCopies).toEqual([b]);
    const empty = attachImportedLorebooks(imported, []);
    expect(buildPrompt(empty.stories[0], empty.library).prompt).toContain(
      "Exported fact.",
    );
    expect(empty.stories[0].lorebookCopies).toBeUndefined();
    const same = attachImportedLorebooks(imported, [b]);
    expect(same.library).toHaveLength(1);
    const edited = structuredClone(b);
    edited.entries[0].content = "Local edited fact.";
    const conflict = attachImportedLorebooks(imported, [edited]);
    expect(conflict.library).toHaveLength(2);
    expect(conflict.library[0]).toEqual(edited);
    expect(conflict.stories[0].activeLorebooks).not.toContain(edited.id);
    expect(buildPrompt(conflict.stories[0], conflict.library).prompt).toContain(
      "Exported fact.",
    );
    const bad = JSON.parse(exportProject(s, [b]));
    bad.story.lorebookCopies[0].entries[0].content = 42;
    expect(() => importProject(JSON.stringify(bad))).toThrow(
      "Invalid shared lorebook",
    );
  });
  it("maps ST dictionaries and character-book arrays including commas inside keys and disabled entries", () => {
    const raw = {
      name: "Cities",
      entries: {
        0: {
          key: ["Rome, Italy"],
          keysecondary: ["rain", "night"],
          selectiveLogic: 3,
          content: "Rome fact",
          comment: "Rome",
          order: 90,
          probability: 75,
          matchWholeWords: true,
        },
        1: { key: ["Mira"], content: "Hidden", disable: true },
      },
    };
    const b = mapLorebook(raw);
    expect(b.entries[0]).toMatchObject({
      primaryKeys: ["Rome, Italy"],
      secondaryKeys: ["rain", "night"],
      selectiveLogic: "and-all",
      probability: 75,
      priority: 90,
      matchWholeWords: true,
    });
    expect(b.entries[1].enabled).toBe(false);
    expect(
      mapLorebook({
        data: {
          character_book: {
            name: "Mira's book",
            entries: [
              {
                keys: ["Mira"],
                content: "Fact",
                enabled: false,
                extensions: { probability: 30 },
              },
            ],
          },
        },
      }).entries[0],
    ).toMatchObject({ keywords: "Mira", enabled: false, probability: 30 });
    const round = parseLorebookJSON(
      JSON.stringify({ format: "vchat-lorebook", ...b }),
    )[0];
    expect(round.entries[0].primaryKeys).toEqual(["Rome, Italy"]);
  });
  it("honors whole words and all four selective logics without regex execution", () => {
    const s = newStory();
    const e = {
      ...newLore(),
      keywords: "cat",
      secondary: "rain, night",
      matchWholeWords: true,
    };
    s.lore = [e];
    for (const [mode, samples] of Object.entries({
      "and-any": ["cat rain", "cat night", "cat rain night"],
      "and-all": ["cat rain night"],
      "not-any": ["cat"],
      "not-all": ["cat", "cat rain", "cat night"],
    })) {
      e.selectiveLogic = mode as typeof e.selectiveLogic;
      for (const sample of ["cat", "cat rain", "cat night", "cat rain night"]) {
        s.text = sample;
        expect(activateLore(s)[0].active).toBe(samples.includes(sample));
      }
    }
    s.text = "scattered rain";
    expect(activateLore(s)[0].active).toBe(false);
    e.keywords = "Rome, Italy";
    e.primaryKeys = ["Rome, Italy"];
    e.secondary = "";
    s.text = "Rome, Italy";
    expect(activateLore(s)[0].active).toBe(true);
    const regex = mapLorebook({
      entries: [{ keys: ["/(a+)+$/"], content: "Unsafe", use_regex: true }],
    });
    expect(regex.entries[0].enabled).toBe(false);
    expect(regex.warnings?.join(" ")).toContain("Regex");
  });
  it("rejects invalid documents atomically and previews unsupported options", () => {
    for (const raw of [
      "[]",
      "{}",
      "no",
      '{"entries":[{"content":42}]}',
      '{"entries":[{"content":"ok","probability":-1}]}',
    ])
      expect(() => parseLorebookJSON(raw)).toThrow();
    const b = mapLorebook({
      entries: [
        {
          content: "Fact",
          constant: true,
          position: 4,
          sticky: 2,
          scanDepth: 4,
        },
      ],
    });
    expect(b.warnings?.join(" ")).toContain("paragraphs");
    expect(b.warnings?.join(" ")).toContain("not executed");
    const library = parseLorebookJSON(
      JSON.stringify({ format: "vchat-lorebook-library", books: [b] }),
    );
    expect(library[0].entries).toEqual(b.entries);
    expect(library[0].id).not.toBe(b.id);
  });
  it("normalizes link targets and rejects character links and credential URLs", () => {
    expect(lorebookLink("https://chat.chub.ai/lorebooks/user/world").url).toBe(
      "https://chub.ai/lorebooks/user/world",
    );
    expect(lorebookLink("chub.ai/lorebooks/user/world?x=1#section").path).toBe(
      "lorebooks/user/world",
    );
    expect(lorebookLink("https://files.example/book.json").path).toBe("");
    for (const link of [
      "chub.ai/characters/user/name",
      "https://user:pass@chub.ai/lorebooks/user/name",
      "https://chub.ai.evil.test/lorebooks/user/name",
      "javascript:alert(1)",
    ])
      expect(() => lorebookLink(link)).toThrow();
  });
  it("downloads current Chub metadata then repository JSON without sending credentials or manuscripts", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url, init) => {
        calls.push(url);
        expect(init.credentials).toBe("omit");
        expect(init.body).toBeUndefined();
        return Response.json(
          calls.length === 1
            ? { node: { id: 123 } }
            : {
                name: "World",
                entries: { 0: { key: ["City"], content: "City fact" } },
              },
        );
      }),
    );
    const b = await fetchLorebook(
      "chub.ai/lorebooks/user/world",
      new AbortController().signal,
    );
    expect(calls).toEqual([
      "https://api.chub.ai/api/lorebooks/user/world",
      "https://api.chub.ai/api/v4/projects/123/repository/files/raw%252Fsillytavern_raw.json/raw",
    ]);
    expect(b.source).toBe("https://chub.ai/lorebooks/user/world");
    expect(b.entries[0].content).toBe("City fact");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({}, { status: 403 })),
    );
    await expect(
      fetchLorebook(
        "chub.ai/lorebooks/user/world",
        new AbortController().signal,
      ),
    ).rejects.toThrow("private");
  });
});

describe("continuation boundary cleanup", () => {
  it.each([
    [
      "You walked with a",
      "You walked with a confidence that surprised her.",
      " confidence that surprised her.",
    ],
    [
      "Old scene. You walked with a",
      " You walked with a quiet confidence.",
      " quiet confidence.",
    ],
    [
      "You walked with a...",
      "You walked with a quiet confidence.",
      " quiet confidence.",
    ],
    [
      "She opened the door.",
      "She opened the door. Then she smiled.",
      " Then she smiled.",
    ],
    [
      "You\nwalked with a",
      "You walked with a quiet confidence.",
      " quiet confidence.",
    ],
    ["You walked with conf", "You walked with confidence.", "idence."],
    ["You walked with a", " quiet confidence.", " quiet confidence."],
    ["She said hello.", "Hello. How are you?", "Hello. How are you?"],
    ["I know.", "I know. She smiled.", "I know. She smiled."],
  ])(
    "removes only a substantial echoed suffix: %s",
    (before, output, expected) => {
      expect(trimRepeatedPrefix(before, output)).toBe(expected);
      expect(continuationText(before, output, true)).toBe(expected);
      expect(continuationText(before, output, false)).toBe(output);
    },
  );
  it("holds streamed echoes until divergence and preserves genuine short words", () => {
    expect(
      continuationText(
        "You walked with a",
        "Assistant: You walked with a quiet confidence.",
        true,
      ),
    ).toBe(" quiet confidence.");
    expect(continuationText("You walked with a", "You wal", true, true)).toBe(
      "",
    );
    expect(
      continuationText(
        "You walked with a",
        "You walked with a confi",
        true,
        true,
      ),
    ).toBe(" confi");
    expect(continuationText("A new scene.", "Hello", true, true)).toBe("Hello");
  });
  it("enables both options on first migration then preserves explicit saved choices", () => {
    const s = newStory();
    expect(s.settings.trimIncomplete).toBe(true);
    expect(s.settings.trimRepeatedPrefix).toBe(true);
    s.settings.trimIncomplete = false;
    s.settings.trimRepeatedPrefix = false;
    expect(upgradeContinuationSettings(s)).toBe(s);
    delete s.continuationCleanupVersion;
    delete s.settings.trimRepeatedPrefix;
    expect(upgradeContinuationSettings(s).settings).toMatchObject({
      trimIncomplete: true,
      trimRepeatedPrefix: true,
    });
    const old = JSON.parse(exportProject(s));
    delete old.story.continuationCleanupVersion;
    expect(importProject(JSON.stringify(old)).settings.trimIncomplete).toBe(
      true,
    );
  });
});
