import { parseXML, printXML, looksLikeXML } from "./xml";
/** Legacy grammar plus strict V-HTML 3.0 XML. Parsing never executes commands. */
export interface VSpan {
  start: number;
  end: number;
  line: number;
  column: number;
}
export interface VRange {
  kind: "range";
  min: number;
  max: number;
  includeMax: boolean;
}
export type VValue = string | number | boolean | VCommand | VRange;
export interface VCommand {
  syntax?: "xml";
  authoredBy?: "user" | "ai";
  blockId?: string;
  name: string;
  fields: Record<string, VValue[]>;
  positional: VValue[];
  span: VSpan;
}
export interface VDiagnostic {
  code: string;
  message: string;
  span: VSpan;
  suggestion?: string;
}
export class VHTMLError extends Error {
  readonly diagnostics: VDiagnostic[];
  readonly span: VSpan;
  constructor(diagnostics: VDiagnostic[]) {
    const first = diagnostics[0];
    super(
      first
        ? `${first.message} (line ${first.span.line}, column ${first.span.column})`
        : "Invalid V-HTML.",
    );
    this.name = "VHTMLError";
    this.diagnostics = diagnostics;
    this.span = first?.span ?? { start: 0, end: 0, line: 1, column: 1 };
  }
}
export const VHTML_LIMITS = Object.freeze({
  sourceLength: 262144,
  commands: 2000,
  depth: 32,
  tokens: 30000,
  stringLength: 16384,
  identifierLength: 120,
});

type TokenKind =
  | "bare"
  | "string"
  | "number"
  | "operator"
  | "<"
  | ">"
  | ":"
  | "["
  | "]"
  | ")"
  | ","
  | "eof";
interface Token {
  kind: TokenKind;
  value: string | number;
  span: VSpan;
}
const identifier = /^[\p{L}_][\p{L}\p{N}_.-]*$/u;
const numeric = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const operators = new Set(["==", "!=", ">=", "<=", ">", "<"]);
const emptySpan: VSpan = { start: 0, end: 0, line: 1, column: 1 };
const commandName = (name: string) =>
  name.toLowerCase() === "conf" ? "configure" : name.toLowerCase();
const fieldName = (name: string) =>
  name.toLowerCase() === "var" ? "variable" : name.toLowerCase();

class Lexer {
  private index = 0;
  private lines = [0];
  private tokens: Token[] = [];
  constructor(private source: string) {
    const newline = /\r\n|\r|\n/g;
    let match: RegExpExecArray | null;
    while ((match = newline.exec(source)))
      this.lines.push(match.index + match[0].length);
  }
  span(start: number, end: number): VSpan {
    let low = 0,
      high = this.lines.length;
    while (low + 1 < high) {
      const middle = (low + high) >>> 1;
      if (this.lines[middle] <= start) low = middle;
      else high = middle;
    }
    return { start, end, line: low + 1, column: start - this.lines[low] + 1 };
  }
  fail(
    code: string,
    message: string,
    start: number,
    end = start + 1,
    suggestion?: string,
  ): never {
    throw new VHTMLError([
      {
        code,
        message,
        span: this.span(start, Math.min(end, this.source.length)),
        suggestion,
      },
    ]);
  }
  private add(kind: TokenKind, value: string | number, start: number) {
    this.tokens.push({ kind, value, span: this.span(start, this.index) });
    if (this.tokens.length > VHTML_LIMITS.tokens)
      this.fail(
        "token-limit",
        "V-HTML has too many tokens.",
        start,
        this.index,
        "Split the script into smaller actions.",
      );
  }
  private quoted() {
    const start = this.index,
      quote = this.source[this.index++];
    let value = "",
      closed = false;
    while (this.index < this.source.length) {
      const char = this.source[this.index++];
      if (char === quote) {
        closed = true;
        break;
      }
      if (char !== "\\") value += char;
      else {
        const escapeStart = this.index - 1;
        const escaped = this.source[this.index++];
        const escapes: Record<string, string> = {
          '"': '"',
          "'": "'",
          "\\": "\\",
          "/": "/",
          n: "\n",
          r: "\r",
          t: "\t",
          b: "\b",
          f: "\f",
        };
        if (escaped === "u") {
          const digits = this.source.slice(this.index, this.index + 4);
          if (!/^[0-9a-f]{4}$/i.test(digits))
            this.fail(
              "invalid-escape",
              "Unicode escapes need four hexadecimal digits.",
              escapeStart,
              this.index + 4,
            );
          value += String.fromCharCode(parseInt(digits, 16));
          this.index += 4;
        } else if (Object.hasOwn(escapes, escaped)) value += escapes[escaped];
        else
          this.fail(
            "invalid-escape",
            "Unknown or incomplete string escape.",
            escapeStart,
            this.index,
            "Use a supported JSON string escape.",
          );
      }
      if (value.length > VHTML_LIMITS.stringLength)
        this.fail(
          "string-limit",
          "A V-HTML string is too long.",
          start,
          this.index,
          "Split long text into separate commands.",
        );
    }
    if (!closed)
      this.fail(
        "unclosed-string",
        "The quoted string is not closed.",
        start,
        this.source.length,
        `Add the closing ${quote} quote.`,
      );
    this.add("string", value, start);
  }
  read(): Token[] {
    while (this.index < this.source.length) {
      const start = this.index,
        char = this.source[this.index];
      if (/\s/u.test(char)) {
        this.index++;
        continue;
      }
      if (this.source.startsWith("//", this.index)) {
        while (
          this.index < this.source.length &&
          !/[\r\n]/.test(this.source[this.index])
        )
          this.index++;
        continue;
      }
      if (this.source.startsWith("/*", this.index)) {
        const end = this.source.indexOf("*/", this.index + 2);
        if (end < 0)
          this.fail(
            "unclosed-comment",
            "The block comment is not closed.",
            start,
            this.source.length,
            "Add */.",
          );
        this.index = end + 2;
        continue;
      }
      if (char === '"' || char === "'") {
        this.quoted();
        continue;
      }
      const pair = this.source.slice(this.index, this.index + 2);
      if ([">=", "<=", "==", "!="].includes(pair)) {
        this.index += 2;
        this.add("operator", pair, start);
        continue;
      }
      if ("<>:[]),".includes(char)) {
        this.index++;
        this.add(char as TokenKind, char, start);
        continue;
      }
      if ("(!=".includes(char))
        this.fail(
          "unexpected-character",
          `Unexpected '${char}'.`,
          start,
          start + 1,
          "Use an inclusive-lower range [min,max), or a supported comparison operator.",
        );
      while (
        this.index < this.source.length &&
        !/[\s<>:\[\](),"'!=]/u.test(this.source[this.index]) &&
        !this.source.startsWith("//", this.index) &&
        !this.source.startsWith("/*", this.index)
      )
        this.index++;
      const word = this.source.slice(start, this.index);
      if (!word)
        this.fail(
          "unexpected-character",
          "Unexpected character in V-HTML.",
          start,
        );
      if (word.length > VHTML_LIMITS.stringLength)
        this.fail(
          "string-limit",
          "A V-HTML value is too long.",
          start,
          this.index,
        );
      if (numeric.test(word)) {
        const number = Number(word);
        if (!Number.isFinite(number))
          this.fail(
            "invalid-number",
            "Numbers must be finite.",
            start,
            this.index,
          );
        this.add("number", number, start);
      } else this.add("bare", word, start);
    }
    this.tokens.push({
      kind: "eof",
      value: "",
      span: this.span(this.index, this.index),
    });
    return this.tokens;
  }
}

class Parser {
  private index = 0;
  private count = 0;
  constructor(private tokens: Token[]) {}
  private peek(offset = 0) {
    return this.tokens[Math.min(this.index + offset, this.tokens.length - 1)];
  }
  private take() {
    return this.tokens[this.index++];
  }
  private fail(
    code: string,
    message: string,
    token = this.peek(),
    suggestion?: string,
  ): never {
    throw new VHTMLError([{ code, message, span: token.span, suggestion }]);
  }
  private expect(kind: TokenKind, message: string) {
    if (this.peek().kind !== kind)
      this.fail("unexpected-token", message, this.peek());
    return this.take();
  }
  private name(token: Token) {
    if (
      token.kind !== "bare" ||
      !identifier.test(String(token.value)) ||
      String(token.value).length > VHTML_LIMITS.identifierLength
    )
      this.fail(
        "invalid-identifier",
        "Command and field names must be identifiers.",
        token,
        "Use letters, digits, underscores, dots or hyphens; start with a letter or underscore.",
      );
    return String(token.value);
  }
  private fieldStart() {
    return this.peek().kind === "bare" && this.peek(1).kind === ":";
  }
  private scalar(token: Token) {
    return (
      token.kind === "string" ||
      token.kind === "number" ||
      (token.kind === "bare" && /^(true|false)$/i.test(String(token.value)))
    );
  }
  private comparison() {
    const token = this.peek();
    return (
      token.kind === "operator" ||
      ((token.kind === "<" || token.kind === ">") && this.scalar(this.peek(1)))
    );
  }
  private end() {
    return this.peek().kind === ">" && !this.comparison();
  }
  private range(): VRange {
    this.take();
    const minToken = this.expect(
        "number",
        "A range must start with a numeric lower bound.",
      ),
      min = Number(minToken.value);
    this.expect(",", "A range needs a comma between its bounds.");
    const maxToken = this.expect(
        "number",
        "A range needs a numeric upper bound.",
      ),
      max = Number(maxToken.value);
    const ending = this.peek();
    if (ending.kind !== "]" && ending.kind !== ")")
      this.fail("unclosed-range", "Close the range with ] or ).", ending);
    this.take();
    if (min > max || (min === max && ending.kind === ")"))
      this.fail(
        "invalid-range",
        "The range is empty or its bounds are reversed.",
        minToken,
        "Use ascending bounds, and ] for a single inclusive value.",
      );
    return { kind: "range", min, max, includeMax: ending.kind === "]" };
  }
  private value(depth: number): VValue {
    const token = this.peek();
    if (this.comparison()) return String(this.take().value);
    if (token.kind === "<") return this.command(depth + 1);
    if (token.kind === "[") return this.range();
    if (token.kind === "string" || token.kind === "number")
      return this.take().value;
    if (token.kind === "bare") {
      this.take();
      if (/^true$/i.test(String(token.value))) return true;
      if (/^false$/i.test(String(token.value))) return false;
      return String(token.value);
    }
    this.fail(
      "missing-value",
      "Expected a quoted string, number, boolean, word, range or nested command.",
      token,
    );
  }
  private command(depth: number): VCommand {
    const opening = this.expect(
      "<",
      "V-HTML source must contain commands starting with <.",
    );
    if (depth > VHTML_LIMITS.depth)
      this.fail(
        "depth-limit",
        "V-HTML nesting is too deep.",
        opening,
        "Flatten the action or split nested definitions.",
      );
    if (++this.count > VHTML_LIMITS.commands)
      this.fail(
        "command-limit",
        "V-HTML has too many commands.",
        opening,
        "Split the script into smaller actions.",
      );
    const name = commandName(this.name(this.take()));
    const fields: Record<string, VValue[]> = Object.create(null),
      positional: VValue[] = [];
    if (!this.end())
      this.expect(
        ":",
        "Use : after the command name, or > for a command with no arguments.",
      );
    const add = (key: string, values: VValue[]) => {
      (fields[key] ??= []).push(...values);
    };
    while (!this.end()) {
      if (this.peek().kind === "eof")
        this.fail(
          "unclosed-command",
          `The <${name}> command is not closed.`,
          opening,
          "Add its final >.",
        );
      if (!this.fieldStart()) {
        positional.push(this.value(depth));
        continue;
      }
      const fieldToken = this.take(),
        key = fieldName(this.name(fieldToken));
      this.take();
      // Author-friendly legacy bounds become ordinary typed definition fields.
      if (
        key === "type" &&
        this.peek().kind === "bare" &&
        this.peek().value === "value" &&
        this.peek(1).kind === ":" &&
        this.peek(2).kind === "<"
      ) {
        this.take();
        this.take();
        const bounds = this.command(depth + 1);
        if (
          bounds.name !== "min" ||
          bounds.positional.length !== 1 ||
          typeof bounds.positional[0] !== "number" ||
          Object.keys(bounds.fields).some((f) => f !== "max") ||
          (bounds.fields.max &&
            (bounds.fields.max.length !== 1 ||
              typeof bounds.fields.max[0] !== "number"))
        )
          this.fail(
            "invalid-legacy-bounds",
            "Legacy value bounds need <min: NUMBER max: NUMBER>.",
            fieldToken,
            "Prefer type: value min: 0 max: 150.",
          );
        add("type", ["value"]);
        add("min", bounds.positional);
        if (bounds.fields.max) add("max", bounds.fields.max);
        continue;
      }
      const values: VValue[] = [];
      while (
        !this.end() &&
        this.peek().kind !== "eof" &&
        !this.fieldStart() &&
        !this.comparison()
      )
        values.push(this.value(depth));
      add(key, values.length ? values : [true]);
    }
    const closing = this.take();
    return {
      name,
      fields,
      positional,
      span: { ...opening.span, end: closing.span.end },
    };
  }
  read(): VCommand[] {
    const commands: VCommand[] = [];
    while (this.peek().kind !== "eof") commands.push(this.command(1));
    return commands;
  }
}

export function parseVHTML(source: string): VCommand[] {
  if (typeof source === "string" && looksLikeXML(source))
    return parseXML(source);
  if (typeof source !== "string")
    throw new VHTMLError([
      {
        code: "invalid-source",
        message: "V-HTML source must be text.",
        span: emptySpan,
      },
    ]);
  if (source.length > VHTML_LIMITS.sourceLength)
    throw new VHTMLError([
      {
        code: "source-limit",
        message: "V-HTML source exceeds 256 KiB of characters.",
        span: emptySpan,
        suggestion: "Split the script into smaller actions.",
      },
    ]);
  return new Parser(new Lexer(source).read()).read();
}

/** Canonical serializer: preserves all AST values/unknown fields, not whitespace/comments. */
export function printVHTML(commands: VCommand[]): string {
  if (commands.some((c) => c.syntax === "xml"))
    return commands
      .map((c) => (c.syntax === "xml" ? printXML([c]) : printVHTML([c])))
      .join("\n");
  let count = 0;
  let values = 0;
  let textLength = 0;
  const stack = new Set<object>();
  const fail = (message: string): never => {
    throw new VHTMLError([{ code: "invalid-ast", message, span: emptySpan }]);
  };
  const name = (value: unknown) => {
    if (
      typeof value !== "string" ||
      !identifier.test(value) ||
      value.length > VHTML_LIMITS.identifierLength
    )
      fail("Invalid V-HTML AST identifier.");
    return value as string;
  };
  const scalar = (value: VValue, depth: number): string => {
    if (++values > VHTML_LIMITS.tokens)
      fail("V-HTML AST contains too many values.");
    if (typeof value === "string") {
      if (value.length > VHTML_LIMITS.stringLength)
        fail("A V-HTML AST string is too long.");
      const quoted = JSON.stringify(value);
      textLength += quoted.length;
      if (textLength > VHTML_LIMITS.sourceLength)
        fail("V-HTML AST text exceeds the source limit.");
      return quoted;
    }
    if (typeof value === "number") {
      if (!Number.isFinite(value)) fail("V-HTML AST numbers must be finite.");
      return String(value);
    }
    if (typeof value === "boolean") return String(value);
    if (!value || typeof value !== "object") fail("Invalid V-HTML AST value.");
    if ("kind" in value && value.kind === "range") {
      if (
        !Number.isFinite(value.min) ||
        !Number.isFinite(value.max) ||
        typeof value.includeMax !== "boolean" ||
        value.min > value.max ||
        (value.min === value.max && !value.includeMax)
      )
        fail("Invalid V-HTML AST range.");
      return `[${value.min},${value.max}${value.includeMax ? "]" : ")"}`;
    }
    return command(value as VCommand, depth + 1);
  };
  const command = (node: VCommand, depth: number): string => {
    if (
      !node ||
      typeof node !== "object" ||
      stack.has(node) ||
      depth > VHTML_LIMITS.depth ||
      ++count > VHTML_LIMITS.commands
    )
      fail("Invalid, cyclic or oversized V-HTML AST.");
    if (
      !Array.isArray(node.positional) ||
      node.positional.length > VHTML_LIMITS.tokens ||
      !node.fields ||
      typeof node.fields !== "object" ||
      Array.isArray(node.fields)
    )
      fail("Invalid V-HTML AST command fields.");
    stack.add(node);
    const commandId = commandName(name(node.name));
    const positional = node.positional.map((value) =>
      typeof value === "string" && operators.has(value)
        ? value
        : scalar(value, depth),
    );
    const fields = Object.entries(node.fields).map(([key, values]) => {
      if (
        !Array.isArray(values) ||
        !values.length ||
        values.length > VHTML_LIMITS.tokens
      )
        fail("V-HTML AST fields need at least one value.");
      return `${fieldName(name(key))}: ${values.map((value) => scalar(value, depth)).join(" ")}`;
    });
    // Comparisons follow their reference field, rather than becoming its value.
    const comparison = node.positional.some(
      (v) => typeof v === "string" && operators.has(v),
    );
    const body = comparison
      ? [...fields, ...positional]
      : [...positional, ...fields];
    stack.delete(node);
    return body.length ? `<${commandId}: ${body.join(" ")}>` : `<${commandId}>`;
  };
  if (!Array.isArray(commands)) fail("V-HTML AST must be a command array.");
  const source = commands.map((node) => command(node, 1)).join("\n");
  if (source.length > VHTML_LIMITS.sourceLength)
    fail("Serialized V-HTML exceeds the source limit.");
  return source;
}
