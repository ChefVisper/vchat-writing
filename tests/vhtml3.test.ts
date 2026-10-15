import { describe, it, expect } from "vitest";
import { parseVHTML, printVHTML } from "../src/vgame/parser";
import {
  createGameProject,
  executeVHTML,
  executeOption,
  executeGameHook,
  undoGame,
  redoGame,
  validateGameProject,
  finishGameAction,
  proposeVHTML,
  acceptGameProposal,
} from "../src/vgame/runtime";
import { exportV3, v3Value, triggerV3Mechanic } from "../src/vgame/v3";
import { aiDirective } from "../src/vgame/input";
import { readFileSync } from "node:fs";
import { vhtmlCompletions } from "../src/vgame/completion";
import { buildGamePrompt, parseGameResponse } from "../src/vgame/ai";
import { newStory } from "../src/types";
import type { GameProject } from "../src/vgame/types";
const run = (source: string, p = createGameProject()) =>
  executeVHTML(p, source, { confirmed: true }).project;
const turn = (p: GameProject) => executeGameHook(p, "turn").project;
const setup =
  '<add type="entity" id="alex"/><add type="stat" id="strength" default="10"/><configure id="strength" link="all"/><add type="variable" id="gold" norm="integer" default="100"/>';
const click = (p: GameProject, template: string) =>
  executeOption(
    p,
    p.options.find(
      (o) => o.v3?.templateId === template && o.pageId === p.activePageId,
    )!.id,
  );
describe("V-HTML 3 XML and typed registry", () => {
  it("updates legacy metadata and values through XML without silently migrating or resetting them", () => {
    let p = run(
      '<add: stat: id: "12345678-abcd" name: "Old money" type: integer default: 5 value: 75>',
    );
    p = run(
      '<configure id="12345678-abcd" ai-access="modify" name="Money"/>',
      p,
    );
    const money = p.objects.find((o) => o.id === "12345678-abcd")!;
    expect(money.value).toBe(75);
    expect(money.default).toBe(5);
    expect(money.v3).toBeUndefined();
    p = run('<modify id="12345678-abcd" value="+5"/>', p);
    expect(v3Value(p, "12345678-abcd")).toBe(80);
    expect(() =>
      run('<configure id="12345678-abcd" link="player"/>', p),
    ).toThrow(/legacy/);
  });
  it("runs legacy and V3 turn systems together, once, with one undo revision", () => {
    let p = run(
      '<add: stat: id: "money" name: "Money" type: integer default: 5 value: 75><on: id: "income" hook: turn result: <modify: stat: "money" increase: 1>><add: encounter: id: "old_event" name: "Old event" base-chance: 100 on-trigger: <modify: stat: "money" increase: 2>>',
    );
    p = run(
      '<add type="variable" id="score" norm="integer" default="0"/><add type="encounter" id="new_event" base-chance="100"/><configure id="new_event"><check-success><modify id="score" value="+3"/></check-success></configure>',
      p,
    );
    const before = p;
    p = executeGameHook(p, "turn", { minutes: 60, random: () => 0 }).project;
    expect(v3Value(p, "money")).toBe(78);
    expect(v3Value(p, "score")).toBe(3);
    expect(p.turn).toBe(1);
    expect(p.elapsedMinutes).toBe(60);
    expect(p.events[0].active).toBe(true);
    expect(p.history).toHaveLength(before.history.length + 1);
    const restored = undoGame(p);
    expect(restored.turn).toBe(0);
    expect(restored.elapsedMinutes).toBe(0);
    expect(v3Value(restored, "money")).toBe(75);
    expect(v3Value(restored, "score")).toBe(0);
    expect(restored.random).toEqual(before.random);
  });
  it("executes every fenced example from the in-app 3.0 guide", () => {
    const guide = readFileSync(
      new URL("../docs/vhtml-3-guide-tr.txt", import.meta.url),
      "utf8",
    );
    const script = [...guide.matchAll(/```vhtml\s*\n([\s\S]*?)\n```/g)]
      .map((m) => m[1])
      .join("\n");
    expect(validateGameProject(run(script))).toBe(true);
  });
  it("runs the complete core scenarios supplied in the original 3.0 specification", () => {
    const spec = readFileSync(
      new URL("../docs/vhtml-3.0-spec-tr.txt", import.meta.url),
      "utf8",
    );
    const examples = [
      ...spec.matchAll(/<vhtml version="3\.0">[\s\S]*?<\/vhtml>/g),
    ];
    expect(examples.length).toBeGreaterThanOrEqual(5);
    for (const example of examples)
      expect(() => run(example[0]), example[0]).not.toThrow();
  });
  it("keeps V3 definition exports ordered before bindings/rules and restores values", () => {
    const p = run(
      '<add type="stat" id="health" default="100"/><configure id="health" auto-link="true"/><add type="entity" id="alex"/><configure id="health" unlink="alex"/><add type="mechanic" id="watch"/><add type="stat" id="strength"/><configure id="strength" link="player"/><configure id="watch" source="strength" entity="player"><section range="[0,100]"><modify id="health" entity="player" value="-1"/></section></configure>',
    );
    const restored = run(exportV3(p));
    expect(restored.vhtml3!.bindings).toEqual(p.vhtml3!.bindings);
    expect(validateGameProject(restored)).toBe(true);
  });
  it("completes XML attributes inside quotes, real IDs and nested elements", () => {
    const p = run(setup);
    expect(vhtmlCompletions("<ad", 3, p)[0].insert).toBe("add ");
    const fields = vhtmlCompletions("<add ", 5, p);
    expect(fields.find((c) => c.label === "type")!.cursorOffset).toBe(6);
    const type = '<add type="st';
    expect(vhtmlCompletions(type, type.length, p)[0].insert).toBe('stat" ');
    const id = '<modify id="go';
    expect(vhtmlCompletions(id, id.length, p)[0].label).toBe("gold");
    const inner = '<choice id="ask"><';
    expect(
      vhtmlCompletions(inner, inner.length, p).map((c) => c.label),
    ).toEqual(["then", "transform"]);
    const prose = '<ai instruction="<ad';
    expect(vhtmlCompletions(prose, prose.length, p)).toEqual([]);
  });
  it("filters private stat bindings and private descriptions out of the 3.0 AI context", () => {
    const p = run(
      setup +
        '<configure id="alex" ai-access="none" description-noai="PRIVATE-ALPHA"/><configure id="gold" description-noai="PRIVATE-BETA"/><add type="stat" id="private_stat" ai-access="none"/><configure id="private_stat" link="player"/>',
    );
    const prompt = buildGamePrompt(p, newStory(), {
      instruction: "Offer choices.",
    }).prompt;
    expect(prompt).toContain("V-HTML 3.0");
    expect(prompt).not.toContain("PRIVATE-ALPHA");
    expect(prompt).not.toContain("PRIVATE-BETA");
    expect(prompt).not.toContain("private_stat");
    const world = JSON.parse(
      buildGamePrompt(p, newStory()).sections.find(
        (s) => s.name === "Approved world state",
      )!.text,
    );
    expect(world.bindings.strength.alex).toBeUndefined();
    expect(world.bindings.strength.player).toBe(10);
  });
  it("parses XML fragments, escapes and comments without executing arbitrary XML", () => {
    const source =
      '<vhtml version="3.0"><!-- note --><add type="variable" id="greeting" default="A &amp; B &lt; C &#x1F600;" /></vhtml>';
    const nodes = parseVHTML(source);
    expect(printVHTML(parseVHTML(printVHTML(nodes)))).toBe(printVHTML(nodes));
    expect(v3Value(run(source), "greeting")).toBe("A & B < C 😀");
    for (const bad of [
      '<add id="x" type="variable" default="A & B"/>',
      '<vhtml version="3.0"><ai /></wrong>',
      '<add type="stat" id="x">',
      "<ai instruction=oops/>",
      '<ai instruction="x"instruction="y"/>',
      '<!DOCTYPE vhtml [<!ENTITY x SYSTEM "file:///etc/passwd">]><vhtml version="3.0"/>',
    ])
      expect(() => run(bad)).toThrow();
    expect(() => run('<script src="http://test"/>')).toThrow();
  });
  it("enforces global IDs, defaults, entity bindings and auto-link without resetting old values", () => {
    let p = run(setup);
    expect(v3Value(p, "strength", "alex")).toBe(10);
    p = run(
      '<modify id="strength" entity="alex" value="+5"/><configure id="strength" link="alex"/><configure id="strength" default="20"/>',
      p,
    );
    expect(v3Value(p, "strength", "alex")).toBe(15);
    p = run(
      '<configure id="strength" auto-link="true"/><add type="entity" id="david"/>',
      p,
    );
    expect(v3Value(p, "strength", "david")).toBe(20);
    p = run('<configure id="strength" max="12"/>', p);
    expect(v3Value(p, "strength", "alex")).toBe(12);
    expect(() => run('<add type="entity" id="gold"/>', p)).toThrow(
      /DUPLICATE_ID/,
    );
    expect(() => run('<choice id="gold" label="Gold"/>', p)).toThrow(
      /DUPLICATE_ID/,
    );
    expect(() => run('<add type="entity" id="player"/>', p)).toThrow(
      /DUPLICATE_ID/,
    );
    expect(() => run('<add type="stat" id=" x "/>', p)).toThrow();
    expect(validateGameProject(JSON.parse(JSON.stringify(p)))).toBe(true);
  });
  it("separates stat defaults from bindings, supports unlink, and rejects missing instances", () => {
    let p = run(setup);
    p = run('<modify id="strength" value="15"/>', p);
    expect(p.objects.find((o) => o.id === "strength")!.default).toBe(15);
    expect(v3Value(p, "strength", "alex")).toBe(10);
    p = run('<configure id="strength" unlink="alex"/>', p);
    expect(() =>
      run('<modify id="strength" entity="alex" value="1"/>', p),
    ).toThrow(/MISSING_STAT_BINDING/);
    expect(() => run('<configure id="gold" link="alex"/>', p)).toThrow();
  });
  it("removes only displays attached to an unlinked binding and leaves character cards intact", () => {
    let p = run(
      setup +
        '<ui type="stat-bar" id="strength" entity="alex"/><ui type="entity-card" id="alex"/>',
    );
    p = run('<configure id="strength" unlink="alex"/>', p);
    expect(p.widgets.map((w) => w.style)).toEqual(["entity-card"]);
    expect(validateGameProject(p)).toBe(true);
    expect(undoGame(p).widgets).toHaveLength(2);
  });
  it("validates arithmetic, signed literals, type changes and clamping atomically", () => {
    let p = run(
      '<add type="variable" id="temp" norm="decimal" default="0"/><add type="variable" id="n" norm="integer" default="5"/>',
    );
    p = run(
      '<modify id="temp" op="set" value="-10"/><modify id="temp" value="-3"/>',
      p,
    );
    expect(v3Value(p, "temp")).toBe(-13);
    for (const source of [
      '<modify id="n" op="div" value="2"/>',
      '<modify id="n" op="div" value="0"/>',
      '<configure id="n" norm="string"/>',
      '<modify id="n" value="x"/>',
    ])
      expect(() => run(source, p)).toThrow();
    const before = JSON.stringify(p);
    expect(() =>
      run('<modify id="n" value="+1"/><modify id="missing" value="1"/>', p),
    ).toThrow();
    expect(JSON.stringify(p)).toBe(before);
    expect(
      v3Value(
        run(
          '<add type="variable" id="pct" norm="%" default="90"/><modify id="pct" value="+40"/>',
        ),
        "pct",
      ),
    ).toBe(100);
  });
});
describe("V-HTML 3 events and persistent counters", () => {
  it("supports manual mechanics and advances elapsed minutes in the same undo step", () => {
    let p = run(
      setup +
        '<add type="mechanic" id="manual" trigger="manual"/><configure id="manual"><section range="[0,100]"><modify id="gold" value="+1"/></section></configure>',
    );
    p = executeGameHook(p, "turn", { minutes: 30 }).project;
    expect(v3Value(p, "gold")).toBe(100);
    expect(p.elapsedMinutes).toBe(30);
    p = triggerV3Mechanic(p, "manual").project;
    expect(v3Value(p, "gold")).toBe(101);
    p = undoGame(p);
    expect(v3Value(p, "gold")).toBe(100);
    p = undoGame(p);
    expect(p.turn).toBe(0);
    expect(p.elapsedMinutes).toBe(0);
  });
  it("retains every counters across rule-id updates and enforces saved XML provenance", () => {
    const rule =
      '<condition id="gold" op="gte" value="0" rule-id="income"><then every="1:4"><modify id="gold" value="+1"/></then></condition>';
    let p = run(
      setup +
        '<add type="encounter" id="e"/><configure id="e">' +
        rule +
        "</configure>",
    );
    p = turn(p);
    expect(v3Value(p, "gold")).toBe(101);
    p = run('<configure id="e">' + rule + "</configure>", p);
    p = turn(p);
    expect(v3Value(p, "gold")).toBe(101);
    const broken = structuredClone(p) as any;
    broken.objects.find((o: any) => o.id === "e").v3.rules[0].authoredBy =
      "system";
    expect(validateGameProject(broken)).toBe(false);
  });
  it("preserves intermediate FIFO entries and isolates failed independent blocks", () => {
    let p = run(
      setup +
        '<add type="variable" id="courage" norm="integer" default="10"/><add type="mechanic" id="brave" source="courage"/><configure id="brave"><section range="[40,80)"><modify id="gold" value="+10"/></section></configure><add type="mechanic" id="broken" trigger="on-turn"/><configure id="broken"><section range="[0,100]" every="1:4"><modify id="gold" value="+99"/><modify id="missing" value="1"/></section></configure>',
    );
    p = run(
      '<modify id="courage" value="50"/><modify id="courage" value="10"/>',
      p,
    );
    expect(v3Value(p, "gold")).toBe(110);
    p = turn(p);
    expect(v3Value(p, "gold")).toBe(110);
    expect(p.log.some((l) => l.message.includes("rolled back"))).toBe(true);
    expect(Object.values(p.vhtml3!.usage).flat()).toEqual([]);
  });
  it("stops a toggling mechanic cascade atomically and keeps the previous project", () => {
    const p = run(
      '<add type="variable" id="n" norm="integer" default="0"/><add type="mechanic" id="loop" source="n"/><configure id="loop"><section range="[0,1)"><modify id="n" value="10"/></section><section range="[1,100]"><modify id="n" value="0"/></section></configure>',
    );
    expect(() => run('<modify id="n" value="10"/>', p)).toThrow(
      /EVENT_LOOP_LIMIT/,
    );
    expect(v3Value(p, "n")).toBe(0);
  });
  it("distinguishes failed requirements from failed rolls and resets chance before success handlers", () => {
    let p = run(
      '<add type="variable" id="night" norm="boolean" default="false"/><add type="variable" id="score" norm="integer" default="0"/><add type="encounter" id="e" base-chance="100" reset-on-success="true"/><configure id="e"><condition id="night" value="true" role="requirement"/><check-success><modify id="e" value="-10"/><modify id="score" value="+1"/></check-success><check-fail><modify id="score" value="-1"/></check-fail></configure>',
    );
    p = turn(p);
    expect(p.random.counter).toBe(0);
    expect(v3Value(p, "score")).toBe(0);
    p = run('<modify id="night" value="true"/>', p);
    p = turn(p);
    expect(v3Value(p, "e")).toBe(90);
    expect(v3Value(p, "score")).toBe(1);
    p = run('<configure id="e" base-chance="0"/>', p);
    expect(v3Value(p, "e")).toBe(0);
    p = turn(p);
    expect(v3Value(p, "score")).toBe(0);
    expect(p.random.counter).toBe(2);
    expect(p.log.some((l) => l.message.includes("roll"))).toBe(true);
  });
  it("uses composite conditions, exact string/boolean types and a sliding every window", () => {
    let p = run(
      setup +
        '<add type="variable" id="ready" norm="boolean" default="true"/><add type="encounter" id="e" base-chance="0"/><configure id="e"><condition mode="all"><condition id="ready" value="true"/><condition mode="any"><condition id="strength" value="10"/><condition id="gold" value="999"/></condition><then every="1:4"><modify id="gold" value="+1"/></then><else><modify id="gold" value="-100"/></else></condition></configure>',
    );
    p = turn(p);
    expect(v3Value(p, "gold")).toBe(101);
    for (let i = 0; i < 3; i++) p = turn(p);
    expect(v3Value(p, "gold")).toBe(101);
    p = turn(p);
    expect(v3Value(p, "gold")).toBe(102);
    p = run('<modify id="ready" value="false"/>', p);
    p = turn(p);
    expect(v3Value(p, "gold")).toBe(2);
  });
  it("fires mechanics once on entering a range, not for each change in that range", () => {
    let p = run(
      setup +
        '<add type="variable" id="courage" norm="integer" default="10"/><add type="mechanic" id="brave" source="courage"/><configure id="brave"><section range="[0,40)"><modify id="strength" entity="alex" value="+3"/></section><section range="[40,80)"><modify id="strength" entity="alex" value="+6"/></section></configure>',
    );
    expect(v3Value(p, "strength", "alex")).toBe(10);
    p = run('<modify id="courage" value="50"/>', p);
    expect(v3Value(p, "strength", "alex")).toBe(16);
    p = run('<modify id="courage" value="60"/>', p);
    expect(v3Value(p, "strength", "alex")).toBe(16);
    p = run('<modify id="courage" value="20"/>', p);
    expect(v3Value(p, "strength", "alex")).toBe(19);
    p = run('<configure id="brave" trigger="on-turn"/>', p);
    p = turn(p);
    expect(v3Value(p, "strength", "alex")).toBe(22);
  });
  it("rolls deterministic manual checks, rejects disabled checks and preserves RNG on undo", () => {
    let p = run(
      '<add type="encounter" id="trap" trigger="manual" base-chance="50"/>',
    );
    const a = run('<check id="trap"/>', p),
      b = run('<check id="trap"/>', p);
    expect(a.random).toEqual(b.random);
    expect(undoGame(a).random).toEqual(p.random);
    p = run('<configure id="trap" enabled="false"/>', p);
    expect(() => run('<check id="trap"/>', p)).toThrow();
  });
});
describe("V-HTML 3 choices, pages, approval and author input", () => {
  it("consumes a choice use even when an independent run-on-init block rolls back", () => {
    let p = run(
      setup +
        '<add type="mechanic" id="broken"/><configure id="broken"><section range="[0,100]"><modify id="unknown" value="1"/></section></configure><choice id="try" label="Try" add-as="1"><then><configure id="broken" run-on-init="true"/></then></choice>',
    );
    p = click(p, "try").project;
    expect(
      p.options.find((o) => o.v3?.templateId === "try")!.v3!.remaining,
    ).toBe(0);
    expect(p.turn).toBe(1);
    expect(validateGameProject(p)).toBe(true);
  });
  it("accepts an explicit XML-only model reply as a reviewable proposal and keeps quoted prose inert", () => {
    const source =
      '<choice id="ask" label="Ask" add-as="1"><then><ai/></then></choice>';
    for (const raw of [source, "```vhtml\n" + source + "\n```"]) {
      const response = parseGameResponse(raw);
      expect(response.narrative).toBe("");
      const result = proposeVHTML(
        createGameProject(),
        response.proposals[0],
      ).project;
      expect(result.options).toHaveLength(0);
      expect(result.proposals[0].status).toBe("pending");
    }
    expect(
      parseGameResponse(
        'She wrote "<ai instruction=\"hello\"/>" in her notebook.',
      ).proposals,
    ).toEqual([]);
  });
  it("keeps templates and page instances separate, refreshes counts and transforms after exhaustion", () => {
    let p = run(
      setup +
        '<choice id="wear" label="Wear ring" count="2" pressed="transform" add-as="1"><then><modify id="strength" entity="player" value="+3"/></then><transform id="remove_ring" label="Remove ring" add-as="1"><then><modify id="strength" entity="player" value="-6"/></then></transform></choice>',
    );
    p = click(p, "wear").project;
    expect(v3Value(p, "strength", "player")).toBe(13);
    expect(
      p.options.find((o) => o.v3?.templateId === "wear")!.v3!.remaining,
    ).toBe(1);
    p = click(p, "wear").project;
    expect(p.vhtml3!.templates.remove_ring).toBeDefined();
    p = click(p, "remove_ring").project;
    expect(v3Value(p, "strength", "player")).toBe(10);
    p = run('<choice id="wear" add-as="1"/>', p);
    expect(
      p.options.find((o) => o.v3?.templateId === "wear")!.v3!.remaining,
    ).toBe(2);
    const first = p.activePageId;
    p = run(
      '<page mode="next" page-id="market"/><choice id="wear" add-as="1" count="3"/>',
      p,
    );
    expect(p.options.filter((o) => o.v3?.templateId === "wear")).toHaveLength(
      2,
    );
    p = run(`<page go-to="${first}"/>`, p);
    expect(p.turn).toBe(3);
    expect(
      p.options.find((o) => o.v3?.templateId === "wear" && o.pageId === first)!
        .v3!.remaining,
    ).toBe(2);
    expect(validateGameProject(redoGame(undoGame(p)))).toBe(true);
  });
  it("captures the AI target at request time and leaves choices untouched on failed actions", () => {
    const p = run(setup),
      first = p.activePageId;
    expect(executeVHTML(p, '<ai/><page mode="next"/>').generation!.pageId).toBe(
      first,
    );
    const next = executeVHTML(p, '<page mode="next"/><ai/>');
    expect(next.generation!.pageId).toBe(next.project.activePageId);
    const queued = executeVHTML(
      p,
      '<ai instruction="First"/><page mode="next"/><ai instruction="Second"/>',
    );
    expect(queued.generations!.map((g) => g.pageId)).toEqual([
      first,
      queued.project.activePageId,
    ]);
    expect(() =>
      run('<page mode="next" page-id="x"/><page mode="next" page-id="x"/>', p),
    ).toThrow();
    const choice = run(
      '<choice id="bad" label="Bad" add-as="1"><then><modify id="gold" value="+1"/><modify id="unknown" value="1"/></then></choice>',
      p,
    );
    expect(() => click(choice, "bad")).toThrow();
    expect(v3Value(choice, "gold")).toBe(100);
    expect(choice.turn).toBe(0);
  });
  it("holds structural AI proposals even in Auto and enforces permissions for value edits", () => {
    let p = run(setup);
    p.settings.approval = "auto";
    expect(
      proposeVHTML(p, {
        source: '<modify id="gold" value="+1"/>',
        reason: "gold",
      }).project.proposals[0].status,
    ).toBe("failed");
    p = run('<configure id="gold" ai-access="modify"/>', p);
    expect(
      v3Value(
        proposeVHTML(p, {
          source: '<vhtml version="3.0"><modify id="gold" value="+1"/></vhtml>',
          reason: "gold",
        }).project,
        "gold",
      ),
    ).toBe(101);
    const suggestion = proposeVHTML(p, {
      source:
        '<choice id="ask" label="Ask" add-as="1"><then><ai/></then></choice>',
      reason: "choices",
    }).project;
    expect(suggestion.proposals.at(-1)!.status).toBe("pending");
    expect(
      proposeVHTML(p, {
        source: '<add: variable: id: "legacy_bypass" name: "Bypass">',
        reason: "legacy syntax",
      }).project.proposals.at(-1)!.status,
    ).toBe("pending");
    const approved = acceptGameProposal(
      suggestion,
      suggestion.proposals.at(-1)!.id,
    ).project;
    expect(click(approved, "ask").generation).toBeDefined();
    expect(
      finishGameAction(click(approved, "ask").project).actionLock,
    ).toBeUndefined();
    expect(
      proposeVHTML(p, {
        source: '<configure id="gold" ai-access="none"/>',
        reason: "permissions",
      }).project.proposals.at(-1)!.status,
    ).toBe("failed");
  });
  it("supports bound UI, explicit value references and seeded random variables", () => {
    let p = run(
      setup +
        '<ui type="entity-card" id="alex"/><ui type="stat-bar" id="strength" entity="alex" label="Strength"/><ui type="meter" id="gold" scope="page"/><modify id="gold" op="add" value-ref="alex.strength"/>',
    );
    expect(v3Value(p, "gold")).toBe(110);
    expect(p.widgets).toHaveLength(3);
    expect(validateGameProject(p)).toBe(true);
    p = run('<random min="1" max="20" norm="integer" save-to="gold"/>', p);
    expect(v3Value(p, "gold")).toBeGreaterThanOrEqual(1);
    expect(v3Value(p, "gold")).toBeLessThanOrEqual(20);
    expect(() =>
      run('<ui type="stat-bar" id="strength" entity="missing"/>', p),
    ).toThrow();
  });
  it("routes slash instructions without treating malformed quotes or plain prose as commands", () => {
    expect(aiDirective('/ai "Offer 3 choices."')).toBe("Offer 3 choices.");
    expect(aiDirective("/ai Offer 3 choices.")).toBe("Offer 3 choices.");
    expect(aiDirective('She says /ai "Hello"')).toBeUndefined();
    expect(() => aiDirective('/ai "unfinished')).toThrow();
    expect(() => aiDirective('/ai ""')).toThrow();
  });
});
