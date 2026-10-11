import type { GameProject } from "./types";
import { VHTML_FIELDS, VHTML_KINDS, VHTML_COMMANDS } from "./runtime";

export interface VHTMLCompletion {
  label: string;
  insert: string;
  from: number;
  to: number;
}
const kinds = VHTML_KINDS;
const values: Record<string, string[]> = {
  type: [
    "number",
    "integer",
    "boolean",
    "string",
    "percentage",
    "value",
    "enum",
    "list",
    "object",
  ],
  ui: ["global", "page", "event"],
  position: ["page-top", "page-bottom", "inline"],
  style: ["counter", "progress-bar", "text", "badge"],
  drawer: ["left", "right"],
  "remove-on": ["never", "page-exit", "event-end"],
  "ai-access": ["none", "read", "modify"],
  access: ["none", "read", "modify"],
  scope: ["global", "scene", "entity", "event", "player", "world"],
  mode: ["continue", "react", "describe"],
  approval: ["manual", "smart", "auto"],
  profile: ["novel", "balanced", "interactive", "designer"],
  "thinking-level": ["minimal", "low", "medium", "high"],
  operator: ['"=="', '"!="', '">="', '"<="', '">"', '"<"'],
  action: ["start", "end"],
};
for (const field of [
  "once",
  "persistent",
  "visible",
  "enabled",
  "activate",
  "thinking",
  "choice-new-page",
  "generation-new-page",
  "global-drawer-open",
])
  values[field] = ["true", "false"];

/** Completion is a lexical aid only. Execution still goes through the real parser. */
export function vhtmlCompletions(
  text: string,
  cursor: number,
  game?: GameProject,
): VHTMLCompletion[] {
  cursor = Math.max(0, Math.min(cursor, text.length));
  const stack: number[] = [];
  let quoted = "",
    escaped = false,
    quoteAt = -1,
    comment = "";
  for (let i = 0; i < cursor; i++) {
    const c = text[i],
      next = text[i + 1];
    if (comment === "line") {
      if (c === "\n") comment = "";
      continue;
    }
    if (comment === "block") {
      if (c === "*" && next === "/") {
        comment = "";
        i++;
      }
      continue;
    }
    if (quoted) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === quoted) {
        quoted = "";
        quoteAt = -1;
      }
      continue;
    }
    if (c === "/" && next === "/") {
      comment = "line";
      i++;
      continue;
    }
    if (c === "/" && next === "*") {
      comment = "block";
      i++;
      continue;
    }
    if (c === '"' || c === "'") {
      quoted = c;
      quoteAt = i;
      continue;
    }
    if (c === "<") stack.push(i);
    if (c === ">" && next !== "=") stack.pop();
  }
  if (comment || !stack.length) return [];
  const open = stack.at(-1)!,
    fragment = text.slice(open + 1, cursor);
  const root = /^\s*([\w-]*)/.exec(fragment)!;
  const command = root[1].toLowerCase(),
    rootEnd = open + 1 + root[0].length;
  const build = (
    choices: string[],
    prefix: string,
    from: number,
    insert: (choice: string) => string,
  ) =>
    choices
      .filter((c) => c.toLowerCase().startsWith(prefix.toLowerCase()))
      .slice(0, 24)
      .map((label) => {
        const inserted = insert(label);
        let to = cursor;
        if (quoted) {
          let escaping = false;
          for (let i = cursor; i < text.length; i++) {
            if (escaping) escaping = false;
            else if (text[i] === "\\") escaping = true;
            else if (text[i] === quoted) {
              to = i + 1;
              break;
            }
          }
        } else {
          while (to < text.length && /[\w.-]/.test(text[to])) to++;
          if (inserted.endsWith(": ") && text[to] === ":") {
            to++;
            while (text[to] === " ") to++;
          }
        }
        return { label, insert: inserted, from, to };
      });
  if (rootEnd === cursor && !quoted)
    return build(
      VHTML_COMMANDS.filter(
        (c) => !["increase", "multiply", "else"].includes(c),
      ),
      command,
      rootEnd - command.length,
      (c) => c + ": ",
    );
  if (!VHTML_FIELDS[command] || !/^\s*:/.test(text.slice(rootEnd, cursor)))
    return [];
  const objectCommand = [
    "add",
    "define",
    "configure",
    "set",
    "modify",
    "reset",
    "clone",
    "remove",
    "display",
    "require",
    "trigger",
    "random",
    "cooldown",
  ].includes(command);
  const available = [
    ...(objectCommand ? VHTML_KINDS : []),
    ...VHTML_FIELDS[command],
    ...(command === "page" ? ["next", "append", "back"] : []),
  ];
  const suffix = text.slice(rootEnd, cursor);
  if (/^\s*:\s*$/.test(suffix))
    return build(
      ["add", "define", "configure"].includes(command)
        ? VHTML_KINDS
        : available,
      "",
      cursor,
      (c) =>
        ["next", "append", "back"].includes(c) && command === "page"
          ? c + ">"
          : c + ": ",
    );
  const tokens = [
    ...suffix.matchAll(
      /"(?:[^"\\]|\\.)*(?:"|$)|'(?:[^'\\]|\\.)*(?:'|$)|[\w.-]+|:/g,
    ),
  ];
  let field = "",
    fieldAt = -1;
  const used = new Set<string>();
  for (let i = 0; i < tokens.length - 1; i++)
    if (tokens[i + 1][0] === ":") {
      field = tokens[i][0].toLowerCase();
      fieldAt = i + 1;
      used.add(field);
    }
  const after = tokens.slice(fieldAt + 1),
    last = after.at(-1),
    lastText = last?.[0] ?? "";
  const noValue = fieldAt >= 0 && after.length === 0;
  const trailing = /\s$/.test(suffix);
  const reference =
    game && ["target", ...kinds].includes(field) && !(command === "add");
  if (reference && (noValue || (after.length === 1 && !trailing))) {
    const candidates = game.objects
      .filter((o) => field === "target" || o.kind === field)
      .map((o) => o.id);
    const from = quoted ? quoteAt : last ? rootEnd + last.index! : cursor;
    return build(
      candidates,
      lastText.replace(/^['"]/, ""),
      from,
      JSON.stringify,
    );
  }
  if (quoted) return [];
  const choices =
    field === "scope" && command === "ai-instruct"
      ? ["global", "scene", "entity", "event"]
      : values[field];
  if (choices && (noValue || (after.length === 1 && !trailing))) {
    return build(
      choices,
      lastText,
      last ? rootEnd + last.index! : cursor,
      (c) => c + " ",
    );
  }
  if (noValue && !(command === "add" && kinds.includes(field))) {
    if (!field)
      return build(available, "", cursor, (c) =>
        ["next", "append", "back"].includes(c) && command === "page"
          ? c + ">"
          : c + ": ",
      );
    return [];
  }
  const prefix = trailing ? "" : lastText;
  const from = trailing || !last ? cursor : rootEnd + last.index!;
  return build(
    available.filter(
      (f) =>
        !used.has(f) &&
        !(
          VHTML_KINDS.includes(f) &&
          [...used].some((u) => VHTML_KINDS.includes(u))
        ),
    ),
    prefix,
    from,
    (c) =>
      ["next", "append", "back"].includes(c) && command === "page"
        ? c + ">"
        : c + ": ",
  );
}
