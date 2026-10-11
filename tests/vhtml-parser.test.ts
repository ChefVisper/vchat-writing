import { describe, expect, it } from "vitest";
import {
  parseVHTML,
  printVHTML,
  VHTMLError,
  VHTML_LIMITS,
  type VCommand,
  type VValue,
} from "../src/vgame/parser";

const shapeValue = (value: VValue): unknown =>
  typeof value === "object" && "name" in value ? shape(value) : value;
const shape = (node: VCommand): unknown => ({
  name: node.name,
  positional: node.positional.map(shapeValue),
  fields: Object.fromEntries(
    Object.entries(node.fields).map(([key, values]) => [
      key,
      values.map(shapeValue),
    ]),
  ),
});
const shapes = (nodes: VCommand[]) => nodes.map(shape);
const parse = (source: string) => shapes(parseVHTML(source));
const error = (source: string) => {
  try {
    parseVHTML(source);
  } catch (e) {
    expect(e).toBeInstanceOf(VHTMLError);
    return e as VHTMLError;
  }
  throw new Error("Expected parser rejection.");
};

describe("V-HTML recursive grammar", () => {
  it("parses markers, bare values, quoted references, aliases and typed scalars", () => {
    expect(
      parse(
        '<ADD: mechanic: name: "Gaze"> <conf: var: "IsOutside" default: TRUE> <page: next> <ai>',
      ),
    ).toEqual([
      {
        name: "add",
        fields: { mechanic: [true], name: ["Gaze"] },
        positional: [],
      },
      {
        name: "configure",
        fields: { variable: ["IsOutside"], default: [true] },
        positional: [],
      },
      { name: "page", fields: {}, positional: ["next"] },
      { name: "ai", fields: {}, positional: [] },
    ]);
  });
  it("keeps multiple ordered child commands in result and repeated field arrays", () => {
    const command = parseVHTML(
      '<option: id: "wallet" add-as: 2 name: "Parasını çal" result: <modify: stat: "Money" increase: 1000> <page: next> result: <ai>>',
    )[0];
    expect(command.fields.name).toEqual(["Parasını çal"]);
    expect(command.fields.result.map((v) => (v as VCommand).name)).toEqual([
      "modify",
      "page",
      "ai",
    ]);
    expect(command.fields.result[0]).toMatchObject({
      fields: { stat: ["Money"], increase: [1000] },
    });
  });
  it("handles conditions and nested on-trigger effects with comparisons as positional values", () => {
    const command = parseVHTML(
      '<configure: encounter: "Selfie" conditions: <require: variable: "IsOutside" == true> <require: stat: "Fame" >= 100> on-trigger: <modify: stat: "Fame" increase: 2> <modify: mechanic: "Gaze" increase: 5>>',
    )[0];
    expect(command.fields.conditions).toHaveLength(2);
    expect(command.fields.conditions[0]).toMatchObject({
      fields: { variable: ["IsOutside"] },
      positional: ["==", true],
    });
    expect(command.fields.conditions[1]).toMatchObject({
      fields: { stat: ["Fame"] },
      positional: [">=", 100],
    });
    expect(command.fields["on-trigger"]).toHaveLength(2);
  });
  it.each([">", "<", ">=", "<=", "==", "!="])(
    "recognizes %s without confusing tag delimiters",
    (operator) => {
      const node = parseVHTML(
        `<if: stat: "Fame" ${operator} 100 result: <text: append: "Changed.">>`,
      )[0];
      expect(node.positional).toEqual([operator, 100]);
      expect(node.fields.result[0]).toMatchObject({ name: "text" });
      expect(parse(printVHTML([node]))).toEqual([shape(node)]);
    },
  );
  it("parses disjoint ranges and does not interpret them as JavaScript arrays", () => {
    const command = parseVHTML(
      '<configure: mechanic: "Gaze" section-apart: <section: [0,20) result: <increase: chance: 10 encounter: "Selfie">> <section: [20,50) result: <increase: chance: 30 encounter: "Selfie">> <section: [50,100] result: <increase: chance: 50 encounter: "Selfie">>>',
    )[0];
    expect(
      command.fields["section-apart"].map((v) => (v as VCommand).positional[0]),
    ).toEqual([
      { kind: "range", min: 0, max: 20, includeMax: false },
      { kind: "range", min: 20, max: 50, includeMax: false },
      { kind: "range", min: 50, max: 100, includeMax: true },
    ]);
  });
  it("normalizes only the documented legacy typed-bounds syntax", () => {
    expect(
      parse(
        '<define: stat: "Reputation" type: value: <min: 0 max: 150> default: 50>',
      ),
    ).toEqual(
      parse(
        '<define: stat: "Reputation" type: value min: 0 max: 150 default: 50>',
      ),
    );
    expect(
      error('<define: type: value: <min: "zero" max: 150>>').diagnostics[0]
        .code,
    ).toBe("invalid-legacy-bounds");
  });
  it("accepts numeric exponent/negative bounds and inclusive singleton ranges", () => {
    const node = parseVHTML(
      "<define: default: -1.5e2 min: -.5 max: +20.0> <section: [-3,-3]>",
    );
    expect(node[0].fields).toMatchObject({
      default: [-150],
      min: [-0.5],
      max: [20],
    });
    expect(node[1].positional[0]).toEqual({
      kind: "range",
      min: -3,
      max: -3,
      includeMax: true,
    });
  });
  it("keeps quoted angle brackets, colons, comments, escapes and multilingual text as data", () => {
    const node = parseVHTML(
      String.raw`<text: append: "Merhaba\n\"<ai>\" //not a comment\u263A"> <option: name: '112\'yi ara'>`,
    );
    expect(node[0].fields.append).toEqual(['Merhaba\n"<ai>" //not a comment☺']);
    expect(node[1].fields.name).toEqual(["112'yi ara"]);
  });
  it("ignores comments and returns no commands for blank/comment-only scripts", () => {
    expect(parseVHTML("// nothing\r\n /* <ai> */")).toEqual([]);
    expect(
      parse("// before\n<ai> /* between */\n<page: append> // after"),
    ).toHaveLength(2);
    expect(
      parseVHTML('<display:ui:global/**/label:"Money">')[0].fields.ui,
    ).toEqual(["global"]);
  });
  it("preserves safe unknown properties and parses unknown command names without executing them", () => {
    const nodes = parseVHTML(
      '<future-command: custom-setting: "preserve me" nested: <future-child: enabled: false>>',
    );
    expect(parse(printVHTML(nodes))).toEqual(shapes(nodes));
    expect(nodes[0].name).toBe("future-command");
  });
  it("cannot mutate Object.prototype through field names", () => {
    const node = parseVHTML(
      '<thing: __proto__: "plain data" constructor: "plain data">',
    )[0];
    expect(Object.getPrototypeOf(node.fields)).toBeNull();
    expect(node.fields.__proto__).toEqual(["plain data"]);
    expect(({} as Record<string, unknown>)["plain data"]).toBeUndefined();
    expect(parse(printVHTML([node]))).toEqual([shape(node)]);
  });
});

describe("V-HTML source diagnostics and bounded work", () => {
  it("tracks UTF-16 offsets and CRLF line/column spans for both parent and child", () => {
    const source = '// comment\r\n  <option: name: "😀" result:\r\n    <ai>>';
    const node = parseVHTML(source)[0],
      child = node.fields.result[0] as VCommand;
    expect(node.span).toEqual({
      start: source.indexOf("<option"),
      end: source.length,
      line: 2,
      column: 3,
    });
    expect(child.span).toEqual({
      start: source.indexOf("<ai>"),
      end: source.indexOf("<ai>") + 4,
      line: 3,
      column: 5,
    });
    expect(source.slice(child.span.start, child.span.end)).toBe("<ai>");
  });
  it("reports a useful span and suggestion for an unclosed nested command", () => {
    const source = '<option: result:\n  <ai: instruction: "hello"';
    const diagnostic = error(source).diagnostics[0];
    expect(diagnostic.code).toBe("unclosed-command");
    expect(diagnostic.span).toMatchObject({ line: 2, column: 3 });
    expect(diagnostic.suggestion).toContain(">");
  });
  it.each([
    ['<text: append: "unfinished>', "unclosed-string"],
    ['<text: value: "bad\\x">', "invalid-escape"],
    ['<text: value: "bad\\uQQQQ">', "invalid-escape"],
    ["/* unfinished", "unclosed-comment"],
    ["<section: [20,10)>", "invalid-range"],
    ["<section: [1,1)>", "invalid-range"],
    ["<section: [0,20>", "unclosed-range"],
    ["<define: value: 1e999>", "invalid-number"],
    ["<9bad: x: 1>", "invalid-identifier"],
    ["<ai> story prose", "unexpected-token"],
    ["<text: append: (unsafe)>", "unexpected-character"],
  ])("rejects malformed source %s", (source, code) => {
    const diagnostic = error(source).diagnostics[0];
    expect(diagnostic.code).toBe(code);
    expect(diagnostic.span.line).toBeGreaterThan(0);
    expect(diagnostic.span.column).toBeGreaterThan(0);
    expect(diagnostic.span.end).toBeGreaterThanOrEqual(diagnostic.span.start);
  });
  it("rejects excessive depth before recursive parsing can overflow", () => {
    expect(
      error(
        "<option: result: ".repeat(VHTML_LIMITS.depth + 1) +
          "<ai>" +
          ">".repeat(VHTML_LIMITS.depth + 1),
      ).diagnostics[0].code,
    ).toBe("depth-limit");
  });
  it("bounds source, command count, token count, identifiers and strings", () => {
    expect(
      error(" ".repeat(VHTML_LIMITS.sourceLength + 1)).diagnostics[0].code,
    ).toBe("source-limit");
    expect(
      error("<ai>".repeat(VHTML_LIMITS.commands + 1)).diagnostics[0].code,
    ).toBe("command-limit");
    expect(
      error("<config: x: " + "0 ".repeat(VHTML_LIMITS.tokens) + ">")
        .diagnostics[0].code,
    ).toBe("token-limit");
    expect(
      error("<" + "a".repeat(VHTML_LIMITS.identifierLength + 1) + ">")
        .diagnostics[0].code,
    ).toBe("invalid-identifier");
    expect(
      error(
        '<text: value: "' + "a".repeat(VHTML_LIMITS.stringLength + 1) + '">',
      ).diagnostics[0].code,
    ).toBe("string-limit");
  });
});

describe("canonical AST/source round-trip", () => {
  it("round-trips representative Phase 1–5 definitions, pages, UI and AI settings", () => {
    const source = `
      <add: stat: name: "Money" id: "money">
      <define: stat: "Money" type: value min: 0 max: 100000 default: 10 persistent: true>
      <panel: id: "character" name: "Character" ui: global drawer: right>
      <display: id: "money-hud" stat: "Money" style: counter ui: global panel: "Character">
      <page: create: id: "hospital_room" title: "Hospital Room" persistent: true>
      <page: goto: "hospital_room"><text: append: "The man woke up.">
      <ai-instruct: id: "style" scope: global priority: high content: "Preserve the author's voice.">
      <ai-context: include: current-page active-events important-world-state>
      <ai-permission: scope: mechanic target: "Gaze" access: modify>
      <config: max-context-tokens: 64000 max-history-pages: 30 reserve-tokens: 8192>
    `;
    const nodes = parseVHTML(source),
      canonical = printVHTML(nodes);
    expect(parse(canonical)).toEqual(shapes(nodes));
    expect(printVHTML(parseVHTML(canonical))).toBe(canonical);
  });
  it("rejects invalid or cyclic externally constructed ASTs rather than serializing executable guesses", () => {
    const node = parseVHTML("<ai>")[0];
    node.fields.result = [node];
    expect(() => printVHTML([node])).toThrow(VHTMLError);
    expect(() =>
      printVHTML([{ ...parseVHTML("<ai>")[0], name: "ai><script" }]),
    ).toThrow(VHTMLError);
    expect(() =>
      printVHTML([{ ...parseVHTML("<ai>")[0], positional: [Infinity] }]),
    ).toThrow(VHTMLError);
    expect(() =>
      printVHTML([
        {
          ...parseVHTML("<ai>")[0],
          positional: Array(VHTML_LIMITS.tokens + 1).fill(0),
        },
      ]),
    ).toThrow(VHTMLError);
  });
});
