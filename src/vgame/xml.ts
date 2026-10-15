import { VHTMLError, VHTML_LIMITS, type VCommand } from "./parser";

export const escapeXML = (s: unknown) =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
export const looksLikeXML = (source: string) => {
  const s = source.replace(/^(?:\s|\/\/[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)+/, "");
  if (/^<!|^<\?/.test(s)) return true;
  const tag = /^<([A-Za-z_][\w-]*)([\s\S]*)/.exec(s);
  if (!tag || /^\s*:/.test(tag[2])) return false;
  return (
    tag[1] === "vhtml" ||
    /^\s*\/>/.test(tag[2]) ||
    /^\s+[\w-]+\s*=/.test(tag[2]) ||
    s.includes(`</${tag[1]}>`)
  );
};
export const attrs = (c: VCommand): Record<string, string> =>
  Object.fromEntries(
    Object.entries(c.fields).map(([k, v]) => [k, String(v[0])]),
  );
export const children = (c: VCommand) => c.positional as VCommand[];
export function parseXML(source: string): VCommand[] {
  let i = 0,
    count = 0;
  const span = (start: number, end = i) => {
    const before = source.slice(0, start).split(/\r\n|\r|\n/);
    return {
      start,
      end,
      line: before.length,
      column: before.at(-1)!.length + 1,
    };
  };
  const fail = (message: string, start = i): never => {
    throw new VHTMLError([
      {
        code: "XML_SYNTAX_ERROR",
        message,
        span: span(start),
        suggestion: 'Use <command key="value" /> or a matching closing tag.',
      },
    ]);
  };
  if (source.length > VHTML_LIMITS.sourceLength)
    fail("XML source is too long.", 0);
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(source))
    fail("Invalid XML control character.", 0);
  const ws = () => {
    while (/\s/.test(source[i] ?? "") && i < source.length) i++;
  };
  const name = () => {
    const match = /^[A-Za-z_][A-Za-z0-9_-]*/.exec(source.slice(i));
    if (!match || match[0].length > 120) fail("Expected an XML name.");
    i += match![0].length;
    return match![0];
  };
  const decode = (s: string, offset: number) =>
    s.replace(
      /&(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);|&/g,
      (entity, at) => {
        if (entity === "&") fail("Escape & as &amp;.", offset + at);
        const known: Record<string, string> = {
          "&amp;": "&",
          "&lt;": "<",
          "&gt;": ">",
          "&quot;": '"',
          "&apos;": "'",
        };
        if (known[entity]) return known[entity];
        const n = entity.startsWith("&#x")
          ? parseInt(entity.slice(3, -1), 16)
          : Number(entity.slice(2, -1));
        if (
          !Number.isInteger(n) ||
          (n < 32 && ![9, 10, 13].includes(n)) ||
          n > 0x10ffff ||
          (n >= 0xd800 && n <= 0xdfff)
        )
          fail("Invalid XML character.", offset + at);
        return String.fromCodePoint(n);
      },
    );
  const nodes = (closing?: string, depth = 0): VCommand[] => {
    if (depth > VHTML_LIMITS.depth) fail("XML nesting limit exceeded.");
    const result: VCommand[] = [];
    while (i < source.length) {
      ws();
      if (i === source.length) break;
      if (source.startsWith("<!--", i)) {
        const end = source.indexOf("-->", i + 4);
        if (
          end < 0 ||
          source.slice(i + 4, end).includes("--") ||
          source.slice(i + 4, end).endsWith("-")
        )
          fail("Invalid XML comment.");
        i = end + 3;
        continue;
      }
      if (source.startsWith("</", i)) {
        i += 2;
        const tag = name();
        ws();
        if (source[i++] !== ">" || tag !== closing)
          fail("Mismatched closing tag.");
        return result;
      }
      if (source[i++] !== "<" || /[!?]/.test(source[i] ?? ""))
        fail(
          "Only V-HTML elements are allowed; DTD and external entities are disabled.",
        );
      const start = i - 1,
        tag = name(),
        fields: VCommand["fields"] = Object.create(null);
      if (++count > VHTML_LIMITS.commands) fail("Too many XML commands.");
      while (true) {
        const hadSpace = /\s/.test(source[i] ?? "");
        ws();
        if (source[i] === ">" || source.startsWith("/>", i)) break;
        if (!hadSpace) fail("Separate attributes with whitespace.");
        const key = name();
        if (
          ["__proto__", "prototype", "constructor"].includes(key) ||
          Object.hasOwn(fields, key)
        )
          fail("Duplicate or unsafe XML attribute.");
        ws();
        if (source[i++] !== "=") fail("Expected = after the attribute name.");
        ws();
        if (source[i++] !== '"')
          fail("XML attribute values require double quotes.");
        const valueStart = i,
          end = source.indexOf('"', i);
        if (end < 0) fail("Unclosed XML attribute.");
        const raw = source.slice(i, end);
        if (raw.includes("<") || raw.length > VHTML_LIMITS.stringLength)
          fail("Invalid or oversized attribute value.", valueStart);
        fields[key] = [decode(raw, valueStart)];
        i = end + 1;
      }
      let nested: VCommand[] = [];
      if (source.startsWith("/>", i)) i += 2;
      else {
        i++;
        nested = nodes(tag, depth + 1);
      }
      result.push({
        syntax: "xml",
        name: tag === "conf" ? "configure" : tag,
        fields,
        positional: nested,
        span: span(start),
      });
    }
    if (closing) fail(`Missing closing tag </${closing}>.`);
    return result;
  };
  return nodes();
}
export function printXML(commands: VCommand[], depth = 0): string {
  if (depth > VHTML_LIMITS.depth)
    throw new Error("XML nesting limit exceeded.");
  return commands
    .map((c) => {
      const attributes = Object.entries(attrs(c))
        .map(([k, v]) => ` ${k}="${escapeXML(v)}"`)
        .join("");
      const nested = children(c);
      return nested.length
        ? `<${c.name}${attributes}>\n${printXML(nested, depth + 1)}\n</${c.name}>`
        : `<${c.name}${attributes} />`;
    })
    .join("\n");
}
