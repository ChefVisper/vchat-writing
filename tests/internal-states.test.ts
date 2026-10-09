import { describe, expect, it } from "vitest";
import { newLore, newNote, newStory } from "../src/types";
import { newLorebook } from "../src/lore/library";
import { estimate } from "../src/context/promptBuilder";
import {
  ff54Config,
  ff54Modules,
  isFF54Config,
  newFF54Config,
} from "../src/presets/ff54";
import {
  appendStateRecord,
  buildInternalStatePrompt,
  currentState,
  internalStateContext,
  isInternalStateData,
  isInternalStateRecord,
  isStateCurrent,
  makeStateRecord,
  stateFingerprint,
  stateForReconciliation,
  updatedStateBlocks,
  validateInternalStates,
} from "../src/generation/internalStates";

const fixture = () => {
  const story = newStory();
  story.text = "Mira put her key in her coat and stepped into the kitchen.";
  story.ff54 = {
    ...newFF54Config(),
    enabled: true,
    modules: ["agendas", "locations"],
  };
  return story;
};
const output = (
  states = [
    {
      module: "agendas",
      content: "Established: Mira is home. Proposed: she plans to cook.",
    },
    { module: "locations", content: "Mira: kitchen, key in her coat." },
  ],
) => JSON.stringify({ states });

describe("FF 5.4 modules and author configuration", () => {
  it("defaults to an optional independent adaptation with compact modules", () => {
    const c = newFF54Config();
    expect(c.enabled).toBe(false);
    expect(c.autoUpdate).toBe(true);
    expect(c.includeContext).toBe(true);
    expect(c.modules).toEqual([
      "agendas",
      "locations",
      "relationships",
      "thoughts",
      "inventory",
      "notebook",
    ]);
    expect(isFF54Config(c)).toBe(true);
    expect(ff54Modules.map((m) => m.id)).toHaveLength(12);
    expect(ff54Modules.every((m) => m.sourceId && m.rule)).toBe(true);
    const a = newFF54Config(),
      b = newFF54Config();
    a.modules.pop();
    expect(b.modules).toHaveLength(6);
    expect(ff54Config(newStory())).toEqual(c);
  });
  it("rejects invalid module choices, numeric limits and unsafe config types", () => {
    const c = newFF54Config();
    for (const patch of [
      { modules: ["thoughts", "thoughts"] },
      { modules: ["arbitrary"] },
      { enabled: "yes" },
      { maxTokens: 0 },
      { thinkingMaxTokens: -1 },
      { contextTokens: Infinity },
      { contextTokens: 32001 },
      { thinkingLevel: "maximum" },
      { extraInstructions: "x".repeat(5001) },
    ])
      expect(isFF54Config({ ...c, ...patch })).toBe(false);
    expect(isFF54Config({ ...c, modules: [], contextTokens: 0 })).toBe(true);
  });
});

describe("atomic Internal States JSON validation", () => {
  it("accepts complete JSON or a single fence and returns only enabled modules in selected order", () => {
    const blocks = validateInternalStates(output(), ["locations", "agendas"]);
    expect(blocks.map((b) => b.module)).toEqual(["locations", "agendas"]);
    expect(
      validateInternalStates("```json\n" + output() + "\n```", [
        "agendas",
        "locations",
      ]),
    ).toHaveLength(2);
    expect(
      validateInternalStates(
        JSON.stringify({ states: [{ module: "locations", content: "  " }] }),
        ["locations"],
      )[0].content,
    ).toBe("None");
    const quoted = [
      { module: "locations", content: 'Mira: beside a door marked "{open}".' },
    ];
    expect(validateInternalStates(output(quoted), ["locations"])).toEqual(
      quoted,
    );
  });
  it.each([
    "not json",
    "{}",
    '{"states":null}',
    '{"states":[]}',
    '{"states":[{"module":"agendas","content":"Mira',
    'Preface: {"states":[]}',
    '```json\n{"states":[]}',
    '{"states":[{"module":"agendas","content":null},{"module":"locations","content":"kitchen"}]}',
  ])(
    "rejects incomplete or malformed output without a partial update: %s",
    (raw) => {
      expect(() =>
        validateInternalStates(raw, ["agendas", "locations"]),
      ).toThrow(/no state was changed/i);
    },
  );
  it("rejects omitted, duplicate or unknown modules, HTML and executable source macros", () => {
    const valid = JSON.parse(output()).states;
    for (const states of [
      [valid[0]],
      [valid[0], valid[0]],
      [valid[0], { module: "unknown", content: "x" }],
      [
        valid[0],
        { module: "locations", content: "<details>kitchen</details>" },
      ],
      [valid[0], { module: "locations", content: "<!-- GFX_START -->" }],
      [
        valid[0],
        { module: "locations", content: "{{setvar::location::kitchen}}" },
      ],
      [valid[0], { module: "locations", content: "x".repeat(4001) }],
    ])
      expect(() =>
        validateInternalStates(output(states), ["agendas", "locations"]),
      ).toThrow();
    expect(() =>
      validateInternalStates(output(), ["agendas", "agendas"]),
    ).toThrow();
    const huge = ff54Modules.map((m) => ({
      module: m.id,
      content: "x".repeat(3000),
    }));
    expect(() =>
      validateInternalStates(
        output(huge),
        huge.map((b) => b.module),
      ),
    ).toThrow();
  });
});

describe("separate state storage and bounded writing context", () => {
  it("uses a compact manuscript basis and never stores a manuscript copy in state history", () => {
    const story = fixture(),
      blocks = validateInternalStates(output(), story.ff54!.modules);
    const r = makeStateRecord(story, blocks, story.connection);
    expect(r.basis).toBe(stateFingerprint(story.text));
    expect(isStateCurrent(story, r)).toBe(true);
    expect(isInternalStateRecord(r)).toBe(true);
    expect(JSON.stringify(r)).not.toContain(story.text);
    story.internalStates = appendStateRecord(story, r);
    expect(currentState(story)).toEqual(r);
    expect(isInternalStateData(story.internalStates)).toBe(true);
    expect(stateFingerprint("\ud83d\ude00Mira")).not.toBe(
      stateFingerprint("Mira\ud83d\ude00"),
    );
    story.text += " She closed the door.";
    expect(isStateCurrent(story, r)).toBe(false);
    expect(currentState(story)).toEqual(r);
    expect(internalStateContext(story)).toBe("");
  });
  it("includes only current selected modules when enabled and obeys the separate context budget", () => {
    const story = fixture();
    const record = makeStateRecord(
      story,
      [
        { module: "agendas", content: "Plan ".repeat(700) },
        { module: "locations", content: "Mira: kitchen" },
        { module: "inventory", content: "DISABLED INVENTORY" },
      ],
      story.connection,
    );
    story.internalStates = appendStateRecord(story, record);
    story.ff54!.contextTokens = 180;
    const context = internalStateContext(story);
    expect(estimate(context)).toBeLessThanOrEqual(180);
    expect(context).toContain("Character agendas");
    expect(context).toContain("Mira: kitchen");
    expect(context).not.toContain("DISABLED INVENTORY");
    story.ff54!.includeContext = false;
    expect(internalStateContext(story)).toBe("");
    story.ff54!.includeContext = true;
    story.ff54!.enabled = false;
    expect(internalStateContext(story)).toBe("");
    story.ff54!.enabled = true;
    story.ff54!.contextTokens = 0;
    expect(internalStateContext(story)).toBe("");
  });
  it("keeps latest records and older IDs required by segment undo or snapshots", () => {
    const story = fixture(),
      blocks = validateInternalStates(output(), story.ff54!.modules);
    const first = makeStateRecord(story, blocks, story.connection);
    story.internalStates = appendStateRecord(story, first);
    const second = makeStateRecord(story, blocks, story.connection);
    story.internalStates = appendStateRecord(story, second);
    const third = makeStateRecord(story, blocks, story.connection);
    story.internalStates = appendStateRecord(story, third);
    story.segments = [
      {
        id: "passage",
        at: 1,
        before: "",
        after: story.text,
        statesBefore: first.id,
        statesAfter: second.id,
      },
    ];
    story.snapshots = [
      {
        id: "snapshot",
        at: 1,
        title: "Saved",
        text: story.text,
        notes: [],
        stateId: third.id,
      },
    ];
    for (let i = 0; i < 105; i++)
      story.internalStates = appendStateRecord(
        story,
        makeStateRecord(story, blocks, story.connection),
      );
    expect(story.internalStates!.records).toHaveLength(103);
    expect(story.internalStates!.records.slice(0, 3).map((r) => r.id)).toEqual([
      first.id,
      second.id,
      third.id,
    ]);
    expect(currentState(story)).toEqual(story.internalStates!.records.at(-1));
    expect(
      isInternalStateData({ ...story.internalStates, currentId: "missing" }),
    ).toBe(false);
    expect(
      isInternalStateData({ ...story.internalStates, records: [first, first] }),
    ).toBe(false);
    expect(isInternalStateRecord({ ...first, basis: story.text })).toBe(false);
    expect(isInternalStateRecord({ ...first, at: 8640000000000001 })).toBe(
      false,
    );
    expect(isInternalStateRecord({ ...first, at: -1 })).toBe(false);
  });
  it("retains disabled modules across refresh while excluding them from requests and writing context", () => {
    const story = fixture();
    story.ff54!.modules = ["agendas", "inventory"];
    const original = makeStateRecord(
      story,
      [
        { module: "inventory", content: "Mira owns the SPARE KEY." },
        { module: "agendas", content: "Proposed: Mira plans to cook." },
      ],
      story.connection,
    );
    story.internalStates = appendStateRecord(story, original);
    story.ff54!.modules = ["agendas"];
    expect(buildInternalStatePrompt(story).prompt).not.toContain("SPARE KEY");
    expect(internalStateContext(story)).not.toContain("SPARE KEY");
    story.text += " She began preparing dinner.";
    const merged = updatedStateBlocks(story, [
      { module: "agendas", content: "Established: Mira is preparing dinner." },
    ]);
    expect(merged.map((b) => b.module)).toEqual(["agendas", "inventory"]);
    const next = makeStateRecord(story, merged, story.connection);
    story.internalStates = appendStateRecord(story, next);
    expect(currentState(story)!.blocks).toContainEqual(
      expect.objectContaining({
        module: "inventory",
        content: "Mira owns the SPARE KEY.",
        basis: original.basis,
      }),
    );
    expect(buildInternalStatePrompt(story).prompt).not.toContain("SPARE KEY");
    expect(internalStateContext(story)).not.toContain("SPARE KEY");
    story.ff54!.modules = ["agendas", "inventory"];
    expect(internalStateContext(story)).not.toContain("SPARE KEY");
    expect(buildInternalStatePrompt(story).prompt).toContain("SPARE KEY");
    expect(isStateCurrent(story, currentState(story)!)).toBe(true);
    expect(original.blocks[1].content).toBe("Proposed: Mira plans to cook.");
    const reconciled = makeStateRecord(
      story,
      updatedStateBlocks(story, [
        { module: "agendas", content: "Mira is preparing dinner." },
        { module: "inventory", content: "Mira still owns the SPARE KEY." },
      ]),
      story.connection,
    );
    story.internalStates = appendStateRecord(story, reconciled);
    expect(internalStateContext(story)).toContain("SPARE KEY");
  });
  it("restores current context for a disabled module when the manuscript stayed unchanged", () => {
    const story = fixture();
    story.ff54!.modules = ["agendas", "inventory"];
    const initial = makeStateRecord(
      story,
      [{ module: "inventory", content: "UNCHANGED KEY" }],
      story.connection,
    );
    // Old project blocks without per-module bases remain compatible.
    delete initial.blocks[0].basis;
    expect(isInternalStateRecord(initial)).toBe(true);
    story.internalStates = appendStateRecord(story, initial);
    story.ff54!.modules = ["agendas"];
    const refreshed = makeStateRecord(
      story,
      updatedStateBlocks(story, [
        { module: "agendas", content: "Proposed: Mira plans dinner." },
      ]),
      story.connection,
    );
    story.internalStates = appendStateRecord(story, refreshed);
    expect(refreshed.blocks.find((b) => b.module === "inventory")?.basis).toBe(
      initial.basis,
    );
    story.ff54!.modules = ["agendas", "inventory"];
    expect(internalStateContext(story)).toContain("UNCHANGED KEY");
    expect(
      isInternalStateRecord({
        ...refreshed,
        blocks: [{ module: "inventory", content: "key", basis: "not-a-basis" }],
      }),
    ).toBe(false);
  });
  it("uses the same explicit Redo checkpoint to retain inactive modules without accepting future state", () => {
    const story = fixture(),
      before = story.text;
    const original = makeStateRecord(
      story,
      [{ module: "inventory", content: "Mira owns the ORIGINAL KEY." }],
      story.connection,
    );
    story.text += " She opened the pantry.";
    const future = makeStateRecord(
      story,
      [{ module: "inventory", content: "FUTURE KEY" }],
      story.connection,
    );
    story.internalStates = { currentId: null, records: [original, future] };
    story.segments = [
      {
        id: "redone",
        at: 1,
        before,
        after: story.text,
        statesBefore: original.id,
        statesAfter: null,
      },
    ];
    story.ff54!.modules = ["agendas"];
    expect(stateForReconciliation(story)).toEqual(original);
    const merged = updatedStateBlocks(story, [
      { module: "agendas", content: "Mira is looking for ingredients." },
    ]);
    expect(merged).toContainEqual(
      expect.objectContaining({
        module: "inventory",
        content: "Mira owns the ORIGINAL KEY.",
        basis: original.basis,
      }),
    );
    expect(JSON.stringify(merged)).not.toContain("FUTURE KEY");
    expect(internalStateContext(story)).toBe("");
    story.segments[0].statesBefore = future.id;
    expect(stateForReconciliation(story)).toBeUndefined();
    expect(
      updatedStateBlocks(story, [
        { module: "agendas", content: "Mira is looking for ingredients." },
      ]),
    ).toHaveLength(1);
  });
  it("rejects duplicate, unknown, omitted and oversized combined updates without mutating prior data", () => {
    const story = fixture();
    story.ff54!.modules = ["agendas"];
    const original = makeStateRecord(
      story,
      [{ module: "inventory", content: "x".repeat(4000) }],
      story.connection,
    );
    story.internalStates = appendStateRecord(story, original);
    for (const blocks of [
      [],
      [{ module: "unknown", content: "invalid" }],
      [
        { module: "agendas", content: "ok" },
        { module: "agendas", content: "duplicate" },
      ],
      [{ module: "inventory", content: "disabled input" }],
    ])
      expect(() => updatedStateBlocks(story, blocks)).toThrow();
    story.ff54!.modules = ff54Modules
      .filter((m) => m.id !== "inventory")
      .slice(0, 8)
      .map((m) => m.id);
    expect(() =>
      updatedStateBlocks(
        story,
        story.ff54!.modules.map((module) => ({
          module,
          content: "y".repeat(4000),
        })),
      ),
    ).toThrow(/retained disabled modules/);
    expect(currentState(story)).toEqual(original);
    expect(story.internalStates.records).toHaveLength(1);
  });
});

describe("state request context and evidence rules", () => {
  it("protects memory, notes, active lore and prior state while trimming older manuscript only", () => {
    const story = fixture();
    story.memory.content = "CONTINUITY MEMORY";
    story.notes = [
      { ...newNote(), content: "CONTINUITY NOTE" },
      { ...newNote(), enabled: false, content: "DISABLED NOTE" },
    ];
    const record = makeStateRecord(
      story,
      [{ module: "agendas", content: "Older fact must remain." }],
      story.connection,
    );
    story.internalStates = appendStateRecord(story, record);
    const library = [
      newLorebook("Active", [
        { ...newLore(), constant: true, content: "ACTIVE LORE" },
      ]),
      newLorebook("Inactive", [
        { ...newLore(), constant: true, content: "INACTIVE LORE" },
      ]),
    ];
    story.activeLorebooks = [library[0].id];
    story.text = "Old manuscript. ".repeat(10000) + "FINAL EVENT.";
    story.ff54!.maxTokens = 500;
    story.ff54!.thinkingMaxTokens = 100;
    story.settings.context = 2500;
    const p = buildInternalStatePrompt(story, library);
    expect(p.budget).toBe(1900);
    expect(p.trimmed).toBeGreaterThan(0);
    expect(p.total).toBeLessThanOrEqual(p.budget);
    for (const data of [
      "CONTINUITY MEMORY",
      "CONTINUITY NOTE",
      "ACTIVE LORE",
      "Older fact must remain.",
      "FINAL EVENT.",
    ])
      expect(p.prompt).toContain(data);
    expect(p.prompt).not.toContain("DISABLED NOTE");
    expect(p.prompt).not.toContain("INACTIVE LORE");
    expect(p.prompt).toContain("Older prose was omitted");
    expect(p.prompt).toContain("Proposed");
    expect(p.prompt).toContain("not a new role-play turn");
  });
  it("reserves dedicated visible and thinking budgets plus provider system overhead", () => {
    const story = fixture();
    story.connection = {
      kind: "openrouter",
      model: "test",
      url: "http://localhost",
    };
    const p = buildInternalStatePrompt(story);
    expect(p.budget).toBeLessThan(
      story.settings.context -
        story.ff54!.maxTokens -
        story.ff54!.thinkingMaxTokens,
    );
    expect(p.prompt).toContain("2048 visible tokens");
    story.ff54!.creative = false;
    expect(buildInternalStatePrompt(story).prompt).toContain(
      "CREATIVE PLANNING OFF",
    );
  });
  it("reconciles an untracked redone passage against its explicit before checkpoint without future-state leaks", () => {
    const story = fixture();
    const before = story.text;
    const prior = makeStateRecord(
      story,
      [
        {
          module: "agendas",
          content: "Mira promised to return the spare key.",
        },
      ],
      story.connection,
    );
    story.internalStates = appendStateRecord(story, prior);
    story.text = before + " Older scene. ".repeat(10000) + "FINAL EVENT.";
    const future = makeStateRecord(
      story,
      [{ module: "agendas", content: "FUTURE BRANCH EVENT" }],
      story.connection,
    );
    story.internalStates = { currentId: null, records: [prior, future] };
    story.segments = [
      {
        id: "passage",
        at: 1,
        before,
        after: story.text,
        statesBefore: prior.id,
        statesAfter: null,
      },
    ];
    story.settings.context = 2200;
    story.ff54!.maxTokens = 500;
    story.ff54!.thinkingMaxTokens = 0;
    const result = buildInternalStatePrompt(story);
    expect(result.trimmed).toBeGreaterThan(0);
    expect(result.prompt).toContain("Mira promised to return the spare key.");
    expect(result.prompt).not.toContain("FUTURE BRANCH EVENT");
    expect(internalStateContext(story)).toBe("");
    story.segments[0].statesBefore = future.id;
    expect(buildInternalStatePrompt(story).prompt).not.toContain(
      "FUTURE BRANCH EVENT",
    );
    story.text = before;
    expect(buildInternalStatePrompt(story).prompt).not.toContain(
      "Mira promised to return the spare key.",
    );
    expect(buildInternalStatePrompt(story).prompt).not.toContain(
      "FUTURE BRANCH EVENT",
    );
  });
  it("blocks oversized protected context instead of silently discarding it", () => {
    const story = fixture();
    story.memory.content = "Important permanent fact. ".repeat(10000);
    expect(() => buildInternalStatePrompt(story)).toThrow(
      /protected context exceed Max Context/,
    );
    story.ff54!.enabled = false;
    expect(() => buildInternalStatePrompt(story)).toThrow(/Enable FF 5.4/);
    story.ff54!.enabled = true;
    story.ff54!.modules = [];
    expect(() => buildInternalStatePrompt(story)).toThrow(/at least one/);
  });
});
