import { uid } from "../types";
import { executeV3, exportV3, v3Turn, registerLegacyTurn } from "./v3";
import {
  parseVHTML,
  printVHTML,
  VHTMLError,
  type VCommand,
  type VValue,
  type VRange,
} from "./parser";
import {
  commitGame,
  createGameProject,
  finishGameAction,
  redoGame,
  undoGame,
  validateGameProject,
} from "./state";
import type {
  GameExecution,
  GameExecutionOptions,
  GameGeneration,
  GameObject,
  GameOption,
  GameProject,
  GameScope,
  GameValue,
} from "./types";
export {
  createGameProject,
  finishGameAction,
  redoGame,
  undoGame,
  validateGameProject,
};
export type * from "./types";

const kinds = [
  "mechanic",
  "variable",
  "stat",
  "encounter",
  "thing",
  "event",
  "entity",
  "relationship",
  "location",
  "item",
  "quest",
  "inventory",
  "time",
  "weather",
];
export const VHTML_KINDS = kinds;
const controls = [
  "add",
  "define",
  "configure",
  "set",
  "modify",
  "remove",
  "reset",
  "clone",
  "page",
  "text",
  "scene",
  "option",
  "display",
  "panel",
  "show",
  "hide",
  "ai",
  "ai-instruct",
  "ai-permission",
  "config",
  "if",
  "else",
  "require",
  "trigger",
  "on",
  "every",
  "chance",
  "cooldown",
  "random",
  "increase",
  "multiply",
  "notification",
  "summary",
  "memory",
];
export const VHTML_COMMANDS = [...controls];
const schema: Record<string, string[]> = {
  add: [
    "id",
    "name",
    "type",
    "min",
    "max",
    "default",
    "value",
    "choices",
    "description",
    "description-ai",
    "description-noai",
    "scope",
    "persistent",
    "ai-access",
    "base-chance",
    "cooldown",
    "conditions",
    "mode",
    "on-trigger",
    "section-apart",
    "section-stack",
  ],
  define: [],
  configure: [],
  set: ["target", "id", "value"],
  modify: ["target", "id", "increase", "decrease", "multiply"],
  reset: ["target", "id"],
  clone: ["target", "id", "new-id", "name"],
  remove: ["target", "id", "ui", "panel", "option", "instruction"],
  page: [
    "create",
    "goto",
    "id",
    "title",
    "name",
    "persistent",
    "activate",
    "summary",
  ],
  scene: ["id", "name", "title", "persistent", "activate", "summary"],
  text: ["page", "append", "replace", "value", "id"],
  summary: ["page", "content", "value", "text"],
  memory: ["id", "content", "value"],
  option: [
    "id",
    "clear",
    "name",
    "description",
    "page",
    "add-as",
    "group",
    "once",
    "result",
    "condition",
    "disabled-if",
  ],
  display: [
    "id",
    "target",
    "label",
    "style",
    "ui",
    "panel",
    "page",
    "event",
    "position",
    "visible",
    "remove-on",
    "expires-after",
  ],
  panel: ["id", "name", "ui", "page", "event", "position", "visible", "drawer"],
  show: ["ui", "panel"],
  hide: ["ui", "panel"],
  ai: ["mode", "instruction"],
  "ai-instruct": [
    "id",
    "content",
    "scope",
    "entity",
    "event",
    "page",
    "enabled",
    "priority",
  ],
  "ai-permission": ["scope", "target", "access"],
  config: [
    "approval",
    "profile",
    "max-context-tokens",
    "max-history-pages",
    "reserve-tokens",
    "summary",
    "global-drawer-open",
    "choice-new-page",
    "generation-new-page",
    "output-tokens",
    "thinking",
    "thinking-level",
    "thinking-output-tokens",
  ],
  if: ["condition", "result"],
  else: ["result"],
  require: ["target", "id", "operator", "value"],
  trigger: ["target", "id", "action"],
  on: ["id", "hook", "result", "condition"],
  every: ["id", "hook", "turns", "result", "condition"],
  chance: ["percent", "value", "result"],
  random: ["target", "id", "min", "max"],
  cooldown: ["target", "id", "minutes", "value"],
  increase: ["chance", "encounter"],
  multiply: ["chance", "encounter"],
  section: ["result"],
  notification: ["content", "text"],
};
schema.define = schema.add;
schema.configure = schema.add;
export const VHTML_FIELDS = schema;
const repeated = new Set([
  "result",
  "condition",
  "conditions",
  "disabled-if",
  "section-apart",
  "section-stack",
  "on-trigger",
  "choices",
  "cooldown",
]);
const objectCommands = new Set([
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
]);
function validateSyntax(commands: VCommand[], p: GameProject, depth = 0) {
  if (depth > 16) throw new Error("Nested actions exceed 16 levels.");
  for (const c of commands) {
    if (
      (c.name === "modify" &&
        c.fields.multiply &&
        (c.fields.increase || c.fields.decrease)) ||
      (["add", "define", "configure"].includes(c.name) &&
        c.fields["section-apart"] &&
        c.fields["section-stack"])
    ) {
      throw new VHTMLError([
        {
          code: "AMBIGUOUS",
          message:
            "Use separate commands for multiplication and addition, and choose exactly one section mode.",
          span: c.span,
        },
      ]);
    }
    const fields =
      schema[c.name] ??
      (p.objects.some(
        (o) =>
          o.id.toLocaleLowerCase() === c.name ||
          o.name.toLocaleLowerCase() === c.name,
      )
        ? ["increase", "decrease", "multiply"]
        : undefined);
    if (!fields)
      throw new VHTMLError([
        {
          code: "UNSUPPORTED",
          message: `Unsupported command <${c.name}>.`,
          span: c.span,
        },
      ]);
    for (const [key, values] of Object.entries(c.fields)) {
      if (
        !fields.includes(key) &&
        !(objectCommands.has(c.name) && kinds.includes(key))
      )
        throw new VHTMLError([
          {
            code: "PROPERTY",
            message: `Unsupported '${key}' property on <${c.name}>.`,
            span: c.span,
          },
        ]);
      if (!repeated.has(key) && values.length !== 1)
        throw new VHTMLError([
          {
            code: "PROPERTY",
            message: `'${key}' needs exactly one value.`,
            span: c.span,
          },
        ]);
      if (
        [
          "result",
          "condition",
          "conditions",
          "disabled-if",
          "section-apart",
          "section-stack",
          "on-trigger",
        ].includes(key) &&
        !values.every((v) => !!v && typeof v === "object" && "name" in v)
      )
        throw new VHTMLError([
          {
            code: "PROPERTY",
            message: `'${key}' needs nested commands.`,
            span: c.span,
          },
        ]);
      validateSyntax(
        values.filter(
          (v): v is VCommand => !!v && typeof v === "object" && "name" in v,
        ),
        p,
        depth + 1,
      );
    }
  }
}
function validateAICommands(commands: VCommand[]) {
  for (const command of commands) {
    if (["config", "ai-permission"].includes(command.name))
      throw new Error(
        "AI-authored actions cannot change engine settings or permissions, including deferred actions.",
      );
    for (const values of Object.values(command.fields))
      validateAICommands(
        values.filter(
          (v): v is VCommand => !!v && typeof v === "object" && "name" in v,
        ),
      );
  }
}
const val = (c: VCommand, field: string) => c.fields[field]?.[0];
const has = (c: VCommand, field: string) => field in c.fields;
const str = (v: unknown, fallback = "") =>
  v === undefined
    ? fallback
    : typeof v === "string"
      ? v
      : typeof v === "number" || typeof v === "boolean"
        ? String(v)
        : (() => {
            throw new Error("Expected a string value.");
          })();
const num = (v: unknown, fallback = 0) =>
  v === undefined
    ? fallback
    : typeof v === "number" && Number.isFinite(v)
      ? v
      : (() => {
          throw new Error("Expected a finite number.");
        })();
const bool = (v: unknown, fallback = true) =>
  v === undefined
    ? fallback
    : typeof v === "boolean"
      ? v
      : (() => {
          throw new Error("Expected true or false.");
        })();
const cmds = (c: VCommand, field: string) =>
  (c.fields[field] ?? []).filter(
    (v): v is VCommand => !!v && typeof v === "object" && "name" in v,
  );
const idValue = (v: unknown, fallback: string) => {
  const id = str(v, fallback);
  if (
    !id ||
    id.length > 250 ||
    ["__proto__", "prototype", "constructor"].includes(id)
  )
    throw new Error("Use a nonempty, safe ID of at most 250 characters.");
  return id;
};
const named = <T extends { id: string; name?: string }>(
  items: T[],
  reference: unknown,
): T => {
  const text = str(reference);
  const byId = items.find((a) => a.id === text);
  if (byId) return byId;
  const matches = items.filter(
    (a) => a.name?.toLocaleLowerCase() === text.toLocaleLowerCase(),
  );
  if (matches.length !== 1)
    throw new Error(
      matches.length
        ? `Ambiguous reference '${text}'; use its ID.`
        : `Unknown reference '${text}'. Declare it first.`,
    );
  return matches[0];
};
const kindField = (c: VCommand) => kinds.find((kind) => has(c, kind));
const objectRef = (p: GameProject, c: VCommand) => {
  const kind = kindField(c);
  const reference = kind
    ? val(c, kind)
    : (val(c, "target") ?? val(c, "id") ?? c.positional[0]);
  const object = named(p.objects, reference);
  if (kind && object.kind !== kind)
    throw new Error(`'${object.name}' is not a ${kind}.`);
  return object;
};
const page = (p: GameProject) => p.pages.find((a) => a.id === p.activePageId)!;
const safeEnum = <T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T => {
  const parsed = str(value, fallback);
  if (!allowed.includes(parsed as T))
    throw new Error(`Choose one of ${allowed.join(", ")}.`);
  return parsed as T;
};
const numericType = (o: GameObject) =>
  ["number", "integer", "percentage", "value"].includes(o.type);
export function checkedGameValue(
  object: GameObject,
  value: unknown,
): GameValue {
  if (numericType(object)) {
    const n = num(value);
    if (object.type === "integer" && !Number.isInteger(n))
      throw new Error(`${object.name} requires an integer.`);
    if (
      (object.min !== undefined && n < object.min) ||
      (object.max !== undefined && n > object.max)
    )
      throw new Error(
        `${object.name} must stay between ${object.min ?? "−∞"} and ${object.max ?? "∞"}.`,
      );
    return n;
  }
  if (object.type === "boolean") return bool(value);
  if (["string", "enum"].includes(object.type)) {
    if (typeof value !== "string" || value.length > 20000)
      throw new Error(`${object.name} requires a short string.`);
    if (object.type === "enum" && !object.choices?.includes(value))
      throw new Error(`Unknown ${object.name} enum value.`);
    return value;
  }
  let data = value;
  if (typeof data === "string") {
    try {
      data = JSON.parse(data);
    } catch {
      throw new Error("List/object values use a quoted JSON value.");
    }
  }
  if (
    object.type === "list"
      ? !Array.isArray(data)
      : !data || typeof data !== "object" || Array.isArray(data)
  )
    throw new Error(`Expected ${object.type} value.`);
  if (JSON.stringify(data).length > 20000)
    throw new Error("Object/list value is too large.");
  return data as GameValue;
}
const condition = (p: GameProject, command: VCommand): boolean => {
  if (command.name === "if" && cmds(command, "condition").length)
    return cmds(command, "condition").every((c) => condition(p, c));
  if (command.name !== "require")
    throw new Error("Conditions use nested <require: ...> commands.");
  const o = objectRef(p, command);
  const values = command.positional;
  const compare = str(
    values.find(
      (x) =>
        typeof x === "string" && ["==", "!=", ">=", "<=", ">", "<"].includes(x),
    ),
    str(val(command, "operator"), "=="),
  );
  const at = values.indexOf(compare);
  const expected =
    val(command, "value") ?? (at >= 0 ? values[at + 1] : values.at(-1));
  const actual = o.value;
  return compare === "=="
    ? actual === expected
    : compare === "!="
      ? actual !== expected
      : typeof actual === "number" &&
        typeof expected === "number" &&
        ({
          ">": actual > expected,
          "<": actual < expected,
          ">=": actual >= expected,
          "<=": actual <= expected,
        }[compare] ??
          false);
};
export function optionEnabled(p: GameProject, option: GameOption) {
  if (option.v3)
    return !p.actionLock && !option.resolved && option.v3.remaining > 0;
  try {
    return (
      !p.actionLock &&
      !option.resolved &&
      (!option.once || !option.used) &&
      option.conditions.every((c) => condition(p, c)) &&
      !option.disabledIf.some((c) => condition(p, c))
    );
  } catch {
    // Imported commands or removed objects can leave a stale condition.
    // Keep its choice visible but unavailable; execution uses this same guard.
    return false;
  }
}
const scopeVisible = (
  p: GameProject,
  item: { ui: GameScope; pageId?: string; eventId?: string; visible: boolean },
) =>
  item.visible &&
  (item.ui === "global" ||
    (item.ui === "page" && item.pageId === p.activePageId) ||
    (item.ui === "event" &&
      p.events.some((e) => e.id === item.eventId && e.active)));
export const visibleGameWidgets = (p: GameProject) =>
  p.widgets.filter(
    (w) =>
      scopeVisible(p, w) &&
      (w.expiresAfter === undefined || p.turn - w.createdTurn < w.expiresAfter),
  );
export const visibleGamePanels = (p: GameProject) =>
  p.panels.filter((w) => scopeVisible(p, w));

interface Context {
  destruction: { value: boolean };
  options: GameExecutionOptions;
  generation?: GameGeneration;
  warnings: string[];
  count: number;
  random?: () => number;
  depth: number;
  created: Set<string>;
}
const isAI = (ctx: Context) => ctx.options.origin === "ai";
function guardObject(o: GameObject, ctx: Context, structural = false) {
  if (
    isAI(ctx) &&
    !(ctx.created.has(o.id) && o.owner === "ai") &&
    (o.aiAccess !== "modify" ||
      (structural && o.owner === "user" && !ctx.options.approved))
  )
    throw new Error(
      `AI has no permission to change '${o.name}'. Set AI access to Modify first.`,
    );
}
function guardDestructive(ctx: Context) {
  if (!ctx.options.confirmed)
    throw new Error(
      "This action removes or replaces saved content. Confirm the destructive action first.",
    );
  ctx.destruction.value = true;
}
function navigate(p: GameProject, id: string, push = true) {
  if (!p.pages.some((a) => a.id === id))
    throw new Error(`Unknown page '${id}'.`);
  if (id !== p.activePageId) {
    if (push) p.navigation.push(p.activePageId);
    for (const w of p.widgets)
      if (
        w.ui === "page" &&
        w.pageId === p.activePageId &&
        w.removeOn === "page-exit"
      )
        w.visible = false;
    p.activePageId = id;
  }
}
function owner(ctx: Context): "user" | "ai" {
  return isAI(ctx) ? "ai" : "user";
}
function runDeferred(
  p: GameProject,
  commands: VCommand[],
  ctx: Context,
  author: "user" | "ai",
) {
  const previous = ctx.options;
  if (author === "ai" || isAI(ctx)) {
    ctx.options = {
      ...previous,
      origin: "ai",
      approved: false,
      definitionMode: false,
    };
  }
  try {
    validateSyntax(commands, p);
    if (isAI(ctx)) validateAICommands(commands);
    run(p, commands, ctx);
  } finally {
    ctx.options = previous;
  }
}
function upsert<T extends { id: string }>(items: T[], item: T, ctx: Context) {
  const index = items.findIndex((a) => a.id === item.id);
  if (index < 0) items.push(item);
  else if (ctx.options.definitionMode) items[index] = item;
  else throw new Error(`Duplicate ID '${item.id}'. Configure it instead.`);
}
function run(p: GameProject, commands: VCommand[], ctx: Context) {
  if (++ctx.depth > 16)
    throw new Error("Event/action nesting exceeds 16 levels.");
  let lastIf: boolean | undefined;
  try {
    for (const command of commands) {
      if (++ctx.count > 500)
        throw new Error("Action exceeds 500 commands; recursion was stopped.");
      try {
        if (!controls.includes(command.name)) {
          const matches = p.objects.filter(
            (o) =>
              o.name.toLocaleLowerCase() === command.name.toLocaleLowerCase() ||
              o.id.toLocaleLowerCase() === command.name.toLocaleLowerCase(),
          );
          if (
            matches.length === 1 &&
            (has(command, "increase") || has(command, "decrease"))
          ) {
            run(
              p,
              [
                {
                  ...command,
                  name: "modify",
                  fields: { ...command.fields, target: [matches[0].id] },
                },
              ],
              ctx,
            );
            continue;
          }
          throw new Error(
            `Unsupported command <${command.name}>. Arbitrary HTML, scripts and CSS are not executable.`,
          );
        }
        if (command.name === "if") {
          const tests = cmds(command, "condition");
          lastIf = (tests.length ? tests : [command]).every((c) =>
            condition(p, c),
          );
          if (lastIf) run(p, cmds(command, "result"), ctx);
          continue;
        }
        if (command.name === "else") {
          if (lastIf === undefined)
            throw new Error(
              "Else must immediately follow an if in the same action.",
            );
          if (!lastIf) run(p, cmds(command, "result"), ctx);
          lastIf = undefined;
          continue;
        }
        lastIf = undefined;
        if (command.name === "require") {
          if (!condition(p, command))
            throw new Error("Action requirement was not met.");
          continue;
        }
        if (["add", "define", "configure"].includes(command.name)) {
          const kind = kindField(command);
          if (!kind)
            throw new Error(
              "Specify an object kind such as mechanic, stat, variable or event.",
            );
          const reference = val(command, kind);
          const name = str(
            val(command, "name"),
            reference === true ? "" : str(reference),
          );
          let o: GameObject;
          let created = false;
          if (command.name === "add") {
            if (!name) throw new Error("An added object needs a name.");
            const id = idValue(val(command, "id"), uid());
            const prior = p.objects.find((x) => x.id === id);
            if (prior && !ctx.options.definitionMode)
              throw new Error(`Duplicate object ID '${id}'.`);
            if (
              !prior &&
              p.objects.some(
                (x) => x.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
              )
            )
              throw new Error(`Duplicate name '${name}'; use the existing ID.`);
            o = prior ?? {
              id,
              name,
              kind,
              type: "number",
              value: 0,
              default: 0,
              description: "",
              descriptionAI: "",
              descriptionNoAI: "",
              scope: "world",
              persistent: true,
              aiAccess: "read",
              owner: owner(ctx),
            };
            if (!prior) {
              created = true;
              p.objects.push(o);
              ctx.created.add(id);
              if (["event", "encounter"].includes(kind))
                p.events.push({ id, objectId: id, active: false });
            }
          } else {
            try {
              o = objectRef(p, command);
            } catch (error) {
              if (ctx.options.definitionMode && name) {
                run(
                  p,
                  [
                    {
                      ...command,
                      name: "add",
                      fields: {
                        name: [name],
                        [kind]: [true],
                        id: [
                          idValue(
                            val(command, "id"),
                            reference === true ? uid() : str(reference),
                          ),
                        ],
                      },
                    },
                    command,
                  ],
                  ctx,
                );
                continue;
              }
              throw error;
            }
          }
          guardObject(o, ctx, true);
          if (has(command, "ai-access")) {
            const access = safeEnum(
              val(command, "ai-access"),
              ["none", "read", "modify"] as const,
              o.aiAccess,
            );
            if (isAI(ctx) && access !== o.aiAccess)
              throw new Error("AI cannot change access permissions.");
            o.aiAccess = access;
          }
          if (has(command, "name")) o.name = str(val(command, "name"));
          if (has(command, "type"))
            o.type = safeEnum(
              val(command, "type"),
              [
                "number",
                "integer",
                "boolean",
                "string",
                "percentage",
                "value",
                "enum",
                "list",
                "object",
              ] as const,
              o.type,
            );
          if (["percentage", "value"].includes(o.type)) {
            o.min ??= 0;
            o.max ??= 100;
          }
          if (has(command, "min")) o.min = num(val(command, "min"));
          if (has(command, "max")) o.max = num(val(command, "max"));
          if (o.min !== undefined && o.max !== undefined && o.min > o.max)
            throw new Error("Minimum exceeds maximum.");
          if (has(command, "choices"))
            o.choices = (command.fields.choices ?? []).map((v) => str(v));
          const natural: GameValue =
            o.type === "boolean"
              ? false
              : o.type === "list"
                ? []
                : o.type === "object"
                  ? {}
                  : ["string", "enum"].includes(o.type)
                    ? (o.choices?.[0] ?? "")
                    : 0;
          if (has(command, "default"))
            o.default = checkedGameValue(o, val(command, "default"));
          else if (has(command, "type") && command.name !== "configure")
            o.default = checkedGameValue(o, natural);
          if (command.name === "define" || created)
            o.value = checkedGameValue(
              o,
              has(command, "value") ? val(command, "value") : o.default,
            );
          else if (has(command, "value"))
            o.value = checkedGameValue(o, val(command, "value"));
          else o.value = checkedGameValue(o, o.value);
          for (const [key, field] of [
            ["description", "description"],
            ["descriptionAI", "description-ai"],
            ["descriptionNoAI", "description-noai"],
            ["scope", "scope"],
          ] as const)
            if (has(command, field)) o[key] = str(val(command, field));
          if (has(command, "persistent"))
            o.persistent = bool(val(command, "persistent"));
          if (has(command, "base-chance")) {
            o.baseChance = num(val(command, "base-chance"));
            if (o.baseChance < 0 || o.baseChance > 100)
              throw new Error("Base chance must be 0–100 percentage points.");
          }
          if (has(command, "cooldown")) {
            o.cooldown = num(val(command, "cooldown"));
            if (o.cooldown < 0) throw new Error("Cooldown cannot be negative.");
          }
          if (has(command, "conditions")) {
            o.conditions = cmds(command, "conditions");
            o.conditionMode = safeEnum(
              val(command, "mode"),
              ["all", "any"] as const,
              "all",
            );
            for (const c of o.conditions) condition(p, c);
          }
          if (has(command, "on-trigger")) {
            o.onTrigger = cmds(command, "on-trigger");
            o.onTriggerOwner = owner(ctx);
          }
          if (has(command, "section-apart") || has(command, "section-stack")) {
            o.sectionMode = has(command, "section-apart") ? "apart" : "stack";
            const sections = cmds(command, "section-" + o.sectionMode);
            o.sections = sections.map((s) => {
              const range = s.positional.find(
                (v): v is VRange =>
                  !!v &&
                  typeof v === "object" &&
                  "kind" in v &&
                  v.kind === "range",
              );
              if (s.name !== "section" || !range)
                throw new Error("Sections need an explicit [min,max) range.");
              return {
                min: range.min,
                max: range.max,
                includeMax: range.includeMax,
                result: cmds(s, "result"),
              };
            });
            const sorted = [...o.sections].sort((a, b) => a.min - b.min);
            if (
              o.sectionMode === "apart" &&
              sorted.some(
                (s, i) =>
                  i > 0 &&
                  (s.min < sorted[i - 1].max ||
                    (s.min === sorted[i - 1].max && sorted[i - 1].includeMax)),
              )
            )
              throw new Error("section-apart ranges overlap at a boundary.");
          }
          continue;
        }
        if (["set", "modify", "reset"].includes(command.name)) {
          const o = objectRef(p, command);
          guardObject(o, ctx);
          if (command.name === "set" && !has(command, "value"))
            throw new Error("Set requires an explicit value.");
          if (
            command.name === "modify" &&
            !["increase", "decrease", "multiply"].some((field) =>
              has(command, field),
            )
          )
            throw new Error("Modify requires increase, decrease or multiply.");
          const v =
            command.name === "reset"
              ? o.default
              : command.name === "set"
                ? val(command, "value")
                : num(o.value) +
                  num(val(command, "increase")) -
                  num(val(command, "decrease"));
          if (command.name === "modify" && has(command, "multiply"))
            o.value = checkedGameValue(
              o,
              num(o.value) * num(val(command, "multiply")),
            );
          else o.value = checkedGameValue(o, v);
          continue;
        }
        if (command.name === "clone") {
          const o = objectRef(p, command);
          guardObject(o, ctx, true);
          if (isAI(ctx)) validateAICommands(o.onTrigger ?? []);
          const duplicate = {
            ...structuredClone(o),
            id: idValue(val(command, "new-id"), uid()),
            name: str(val(command, "name"), o.name + " copy"),
            owner: owner(ctx),
            ...(isAI(ctx) && o.onTrigger
              ? { onTriggerOwner: "ai" as const }
              : {}),
          };
          upsert(p.objects, duplicate, ctx);
          ctx.created.add(duplicate.id);
          if (
            ["event", "encounter"].includes(duplicate.kind) &&
            !p.events.some((event) => event.objectId === duplicate.id)
          )
            p.events.push({
              id: duplicate.id,
              objectId: duplicate.id,
              active: false,
            });
          continue;
        }
        if (command.name === "remove") {
          guardDestructive(ctx);
          const collection = has(command, "ui")
            ? p.widgets
            : has(command, "panel")
              ? p.panels
              : has(command, "option")
                ? p.options
                : has(command, "instruction")
                  ? p.instructions
                  : undefined;
          if (collection) {
            const target = named(
              collection as {
                id: string;
                name?: string;
                owner: "user" | "ai";
              }[],
              val(command, "ui") ??
                val(command, "panel") ??
                val(command, "option") ??
                val(command, "instruction"),
            );
            if (isAI(ctx) && target.owner === "user")
              throw new Error("AI cannot delete a user-authored structure.");
            collection.splice(collection.indexOf(target as never), 1);
          } else {
            const o = objectRef(p, command);
            guardObject(o, ctx, true);
            if (p.widgets.some((w) => w.binding === o.id))
              throw new Error(
                "Remove dependent widgets before removing their object.",
              );
            p.objects = p.objects.filter((a) => a.id !== o.id);
            p.events = p.events.filter((e) => e.objectId !== o.id);
          }
          continue;
        }
        if (command.name === "page" || command.name === "scene") {
          const action =
            command.name === "scene"
              ? "create"
              : has(command, "create")
                ? "create"
                : has(command, "goto")
                  ? "goto"
                  : str(command.positional[0], "append");
          if (["next", "create"].includes(action)) {
            const id = idValue(val(command, "id"), uid());
            const exists = p.pages.find((a) => a.id === id);
            if (exists && !ctx.options.definitionMode)
              throw new Error(`Duplicate page '${id}'.`);
            if (!exists)
              p.pages.push({
                id,
                title: str(
                  val(command, "title") ?? val(command, "name"),
                  `Page ${p.pages.length + 1}`,
                ),
                text: "",
                summary: str(val(command, "summary")),
                created: Date.now(),
                persistent: bool(val(command, "persistent")),
                parent: p.activePageId,
              });
            else if (has(command, "title"))
              exists.title = str(val(command, "title"));
            if (exists && has(command, "summary"))
              exists.summary = str(val(command, "summary"));
            if (
              !ctx.options.definitionMode ||
              bool(val(command, "activate"), false)
            )
              navigate(p, id);
          } else if (action === "goto") navigate(p, str(val(command, "goto")));
          else if (action === "back") {
            const id = p.navigation.pop();
            if (id) navigate(p, id, false);
          } else if (["replace", "clear"].includes(action)) {
            guardDestructive(ctx);
            page(p).text = "";
            p.options = p.options.filter((o) => o.pageId !== p.activePageId);
          } else if (action !== "append")
            throw new Error(`Unsupported page action '${action}'.`);
          continue;
        }
        if (
          command.name === "text" ||
          command.name === "memory" ||
          command.name === "summary"
        ) {
          const target = has(command, "page")
            ? named(p.pages, val(command, "page"))
            : page(p);
          if (isAI(ctx) && command.name === "text")
            throw new Error(
              "AI proposals cannot rewrite narrative; put prose in the narrative field.",
            );
          if (command.name === "summary")
            target.summary = str(
              val(command, "value") ??
                val(command, "content") ??
                val(command, "text"),
            );
          else if (command.name === "memory") {
            run(
              p,
              [
                {
                  ...command,
                  name: "ai-instruct",
                  fields: {
                    id: [str(val(command, "id"), "memory")],
                    scope: ["global"],
                    content: [
                      str(val(command, "content") ?? val(command, "value")),
                    ],
                  },
                },
              ],
              ctx,
            );
          } else if (has(command, "replace")) {
            if (!ctx.options.definitionMode) guardDestructive(ctx);
            target.text = str(
              val(command, "replace") === true
                ? val(command, "value")
                : val(command, "replace"),
            );
          } else if (has(command, "append"))
            target.text += str(val(command, "append"));
          else throw new Error("Text needs append or replace.");
          continue;
        }
        if (command.name === "option") {
          const id = idValue(val(command, "id"), uid());
          const existing = p.options.find((o) => o.id === id);
          if (isAI(ctx) && existing?.owner === "user")
            throw new Error("AI cannot replace a user-authored option.");
          if (has(command, "clear")) {
            if (
              isAI(ctx) &&
              p.options.some(
                (o) => o.pageId === p.activePageId && o.owner === "user",
              )
            )
              throw new Error("AI cannot clear user-authored options.");
            guardDestructive(ctx);
            p.options = p.options.filter((o) => o.pageId !== p.activePageId);
            continue;
          }
          const result = cmds(command, "result");
          if (!result.length)
            throw new Error("An option needs at least one result command.");
          const conditions = cmds(command, "condition"),
            disabledIf = cmds(command, "disabled-if");
          conditions.concat(disabledIf).forEach((c) => condition(p, c));
          upsert(
            p.options,
            {
              id,
              name: str(val(command, "name"), "Choice"),
              description: str(val(command, "description")),
              pageId: str(val(command, "page"), p.activePageId),
              order: num(val(command, "add-as"), p.options.length + 1),
              group: str(val(command, "group")),
              once: bool(val(command, "once")),
              used: existing?.used ?? false,
              resolved: existing?.resolved ?? false,
              result,
              conditions,
              disabledIf,
              owner: existing?.owner ?? owner(ctx),
            },
            { ...ctx, options: { ...ctx.options, definitionMode: true } },
          );
          continue;
        }
        if (["display", "panel"].includes(command.name)) {
          const id = idValue(val(command, "id"), uid()),
            ui = safeEnum(
              val(command, "ui"),
              ["global", "page", "event"] as const,
              "global",
            );
          const event =
            ui === "event"
              ? named(
                  p.events,
                  val(command, "event") === undefined
                    ? ""
                    : (p.objects.find(
                        (o) =>
                          o.id === val(command, "event") ||
                          o.name === val(command, "event"),
                      )?.id ?? val(command, "event")),
                )
              : undefined;
          const position = safeEnum(
            val(command, "position"),
            ["page-top", "page-bottom", "inline"] as const,
            "page-top",
          );
          const fields = {
            id,
            ui,
            ...(ui === "page"
              ? { pageId: str(val(command, "page"), p.activePageId) }
              : {}),
            ...(event ? { eventId: event.id } : {}),
            position,
            visible: bool(val(command, "visible")),
            owner: owner(ctx),
          };
          if (command.name === "panel") {
            const existing = p.panels.find((a) => a.id === id);
            if (isAI(ctx) && existing?.owner === "user")
              throw new Error("AI cannot replace a user panel.");
            upsert(
              p.panels,
              {
                ...fields,
                name: str(val(command, "name"), id),
                drawer: safeEnum(
                  val(command, "drawer"),
                  ["left", "right"] as const,
                  "right",
                ),
              },
              { ...ctx, options: { ...ctx.options, definitionMode: true } },
            );
          } else {
            const o = objectRef(p, command);
            const existing = p.widgets.find((w) => w.id === id);
            if (isAI(ctx) && existing?.owner === "user")
              throw new Error("AI cannot replace a user widget.");
            upsert(
              p.widgets,
              {
                ...fields,
                label: str(val(command, "label"), o.name),
                binding: o.id,
                style: safeEnum(
                  val(command, "style"),
                  [
                    "counter",
                    "progress-bar",
                    "text",
                    "badge",
                    "stat-bar",
                    "meter",
                    "entity-card",
                  ] as const,
                  "counter",
                ),
                panel: has(command, "panel")
                  ? named(p.panels, val(command, "panel")).id
                  : undefined,
                removeOn: safeEnum(
                  val(command, "remove-on"),
                  ["never", "page-exit", "event-end"] as const,
                  ui === "page"
                    ? "page-exit"
                    : ui === "event"
                      ? "event-end"
                      : "never",
                ),
                expiresAfter: has(command, "expires-after")
                  ? num(val(command, "expires-after"))
                  : undefined,
                createdTurn: existing?.createdTurn ?? p.turn,
              },
              { ...ctx, options: { ...ctx.options, definitionMode: true } },
            );
          }
          continue;
        }
        if (["show", "hide"].includes(command.name)) {
          const item = has(command, "panel")
            ? named(p.panels, val(command, "panel"))
            : named(p.widgets, val(command, "ui"));
          if (isAI(ctx) && item.owner === "user")
            throw new Error("AI cannot change a user-authored widget.");
          item.visible = command.name === "show";
          continue;
        }
        if (command.name === "ai-instruct") {
          const id = idValue(val(command, "id"), uid());
          const existing = p.instructions.find((i) => i.id === id);
          if (isAI(ctx) && existing?.owner === "user")
            throw new Error("AI cannot replace a user instruction.");
          const scope = safeEnum(
            val(command, "scope"),
            ["global", "scene", "entity", "event"] as const,
            "global",
          );
          const target =
            scope === "entity"
              ? named(p.objects, val(command, "entity")).id
              : scope === "event"
                ? named(p.objects, val(command, "event")).id
                : undefined;
          const priority =
            typeof val(command, "priority") === "number"
              ? num(val(command, "priority"))
              : ({ low: 0, normal: 10, high: 20 }[
                  str(val(command, "priority"), "normal")
                ] ?? 10);
          upsert(
            p.instructions,
            {
              id,
              content: str(val(command, "content")),
              scope,
              target,
              ...(scope === "scene"
                ? { pageId: str(val(command, "page"), p.activePageId) }
                : {}),
              enabled: bool(val(command, "enabled")),
              priority,
              owner: existing?.owner ?? owner(ctx),
            },
            { ...ctx, options: { ...ctx.options, definitionMode: true } },
          );
          continue;
        }
        if (command.name === "ai-permission") {
          if (isAI(ctx))
            throw new Error("AI cannot grant or elevate permissions.");
          const o = named(p.objects, val(command, "target"));
          o.aiAccess = safeEnum(
            val(command, "access"),
            ["none", "read", "modify"] as const,
            "read",
          );
          continue;
        }
        if (command.name === "config") {
          if (isAI(ctx))
            throw new Error(
              "Only the user may change engine/context/approval settings.",
            );
          const settings = p.settings;
          for (const [field, key] of [
            ["max-context-tokens", "maxContextTokens"],
            ["max-history-pages", "maxHistoryPages"],
            ["reserve-tokens", "reserveTokens"],
            ["output-tokens", "maxOutputTokens"],
            ["thinking-output-tokens", "thinkingMaxTokens"],
          ] as const)
            if (has(command, field)) settings[key] = num(val(command, field));
          if (has(command, "approval"))
            settings.approval = safeEnum(
              val(command, "approval"),
              ["manual", "smart", "auto"] as const,
              settings.approval,
            );
          if (has(command, "profile"))
            settings.profile = safeEnum(
              val(command, "profile"),
              ["novel", "balanced", "interactive", "designer"] as const,
              settings.profile,
            );
          if (has(command, "summary"))
            settings.summary = safeEnum(
              val(command, "summary"),
              ["manual", "disabled"] as const,
              settings.summary,
            );
          if (has(command, "global-drawer-open"))
            settings.globalDrawerOpen = bool(
              val(command, "global-drawer-open"),
            );
          if (has(command, "thinking"))
            settings.thinking = bool(val(command, "thinking"));
          if (has(command, "choice-new-page"))
            settings.choiceNewPage = bool(val(command, "choice-new-page"));
          if (has(command, "generation-new-page"))
            settings.generationNewPage = bool(
              val(command, "generation-new-page"),
            );
          if (has(command, "thinking-level"))
            settings.thinkingLevel = safeEnum(
              val(command, "thinking-level"),
              ["minimal", "low", "medium", "high"] as const,
              settings.thinkingLevel,
            );
          continue;
        }
        if (command.name === "ai") {
          const mode = safeEnum(
            val(command, "mode"),
            ["continue", "react", "describe"] as const,
            "continue",
          );
          if (!ctx.generation)
            ctx.generation = {
              id: uid(),
              mode,
              instruction: str(val(command, "instruction")),
            };
          else {
            const instruction = str(val(command, "instruction"));
            if (instruction)
              ctx.generation.instruction +=
                (ctx.generation.instruction ? "\n" : "") + instruction;
            ctx.warnings.push(
              "Multiple AI directives were merged into one request.",
            );
          }
          continue;
        }
        if (command.name === "trigger") {
          const o = objectRef(p, command);
          if (!["event", "encounter"].includes(o.kind))
            throw new Error("Trigger targets an event or encounter.");
          guardObject(o, ctx);
          const e = p.events.find((x) => x.objectId === o.id)!;
          const action = str(val(command, "action"), "start");
          if (action === "end") {
            e.active = false;
            e.ended = p.turn;
            for (const w of p.widgets)
              if (w.eventId === e.id && w.removeOn === "event-end")
                w.visible = false;
          } else if (action === "start") {
            if (e.active) continue;
            if (
              o.lastTriggered !== undefined &&
              p.elapsedMinutes - o.lastTriggered < (o.cooldown ?? 0)
            )
              throw new Error(`${o.name} is on cooldown.`);
            const tests = o.conditions?.map((c) => condition(p, c)) ?? [];
            if (
              tests.length &&
              (o.conditionMode === "any"
                ? !tests.some(Boolean)
                : !tests.every(Boolean))
            )
              throw new Error(`${o.name} conditions are not met.`);
            e.active = true;
            e.started = p.turn;
            o.lastTriggered = p.elapsedMinutes;
            runDeferred(p, o.onTrigger ?? [], ctx, o.onTriggerOwner ?? o.owner);
          } else throw new Error("Event action must be start or end.");
          continue;
        }
        if (["on", "every"].includes(command.name)) {
          const id = idValue(val(command, "id"), uid()),
            result = cmds(command, "result");
          const existing = p.rules.find((rule) => rule.id === id);
          if (isAI(ctx) && existing?.owner === "user")
            throw new Error("AI cannot replace a user-authored hook.");
          if (!result.length) throw new Error("Hooks need result commands.");
          upsert(
            p.rules,
            {
              id,
              hook: str(val(command, "hook") ?? command.positional[0], "turn"),
              every:
                command.name === "every"
                  ? num(
                      val(command, "turns") ??
                        command.positional.find((v) => typeof v === "number"),
                      1,
                    )
                  : undefined,
              result,
              conditions: cmds(command, "condition"),
              owner: existing?.owner ?? owner(ctx),
            },
            { ...ctx, options: { ...ctx.options, definitionMode: true } },
          );
          continue;
        }
        if (command.name === "chance") {
          const chance = num(
            val(command, "percent") ??
              val(command, "value") ??
              command.positional[0],
          );
          if (chance < 0 || chance > 100)
            throw new Error("Chance must be 0–100.");
          if (draw(p, ctx) * 100 < chance) run(p, cmds(command, "result"), ctx);
          continue;
        }
        if (command.name === "random") {
          const o = objectRef(p, command);
          guardObject(o, ctx);
          const min = num(val(command, "min"), o.min ?? 0),
            max = num(val(command, "max"), o.max ?? 100);
          if (max < min) throw new Error("Random bounds are reversed.");
          o.value = checkedGameValue(
            o,
            Math.floor(draw(p, ctx) * (max - min + 1)) + min,
          );
          continue;
        }
        if (command.name === "cooldown") {
          const o = objectRef(p, command);
          guardObject(o, ctx);
          o.cooldown = num(val(command, "minutes") ?? val(command, "value"));
          if (o.cooldown < 0) throw new Error("Cooldown cannot be negative.");
          continue;
        }
        if (["increase", "multiply"].includes(command.name))
          throw new Error(
            "Chance modifiers only run inside configured section checks.",
          );
        if (command.name === "notification") {
          p.log.push({
            id: uid(),
            at: Date.now(),
            message: str(
              val(command, "content") ??
                val(command, "text") ??
                command.positional[0],
            ),
          });
          p.log = p.log.slice(-200);
          continue;
        }
      } catch (error) {
        if (error instanceof VHTMLError) throw error;
        throw new VHTMLError([
          {
            code: "SEMANTIC",
            message:
              error instanceof Error ? error.message : "Invalid command.",
            span: command.span,
          },
        ]);
      }
    }
  } finally {
    ctx.depth--;
  }
}
function draw(p: GameProject, ctx: Context) {
  p.random.counter++;
  if (ctx.random) {
    const x = ctx.random();
    if (x < 0 || x >= 1 || !Number.isFinite(x))
      throw new Error("Random resolver must return [0,1).");
    return x;
  }
  let x = (p.random.seed + Math.imul(p.random.counter, 0x6d2b79f5)) | 0;
  x = Math.imul(x ^ (x >>> 15), x | 1);
  x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
  return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
}
function transaction(
  p: GameProject,
  commands: VCommand[],
  options: GameExecutionOptions,
  ctxExtra: Partial<Context> = {},
): GameExecution {
  if (commands.some((c) => c.syntax === "xml")) {
    if (commands.some((c) => c.syntax !== "xml"))
      throw new Error("Use one V-HTML syntax per action.");
    return executeV3(p, commands, options);
  }
  const next = structuredClone(p),
    ctx: Context = {
      destruction: { value: false },
      options,
      warnings: [],
      count: 0,
      depth: 0,
      created: new Set(),
      ...ctxExtra,
    };
  validateSyntax(commands, next);
  if (options.origin === "ai") validateAICommands(commands);
  run(next, commands, ctx);
  if (!validateGameProject(next))
    throw new Error(
      "Game state exceeds schema limits or has broken references. No changes applied.",
    );
  const diff = commitGame(p, next, options);
  return {
    requiresConfirmation: ctx.destruction.value,
    project: next,
    generation: ctx.generation,
    diff,
    warnings: ctx.warnings,
  };
}
export function executeVHTML(
  p: GameProject,
  source: string,
  options: GameExecutionOptions = {},
): GameExecution {
  if (options.origin === "ai")
    return proposeVHTML(p, { source, reason: "AI proposed V-HTML changes." });
  return transaction(p, parseVHTML(source), {
    ...options,
    origin: options.origin ?? "user",
  });
}
export function executeOption(p: GameProject, id: string): GameExecution {
  const option = p.options.find((o) => o.id === id);
  if (option?.v3)
    return executeV3(
      p,
      [],
      { origin: "option", label: `Choice: ${option.name}` },
      { choice: id },
    );
  if (!option || option.pageId !== p.activePageId || !optionEnabled(p, option))
    throw new Error("This option is unavailable or already in progress.");
  const next = structuredClone(p);
  next.options.find((o) => o.id === id)!.used = true;
  for (const sibling of next.options)
    if (sibling.pageId === option.pageId && sibling.group === option.group)
      sibling.resolved = true;
  const result = transaction(next, option.result, {
    origin: option.owner === "ai" ? "ai" : "option",
    label: `Choice: ${option.name}`,
    confirmed: false,
    recordHistory: false,
  });
  if (
    result.generation &&
    p.settings.choiceNewPage !== false &&
    result.project.activePageId === option.pageId
  ) {
    const transition = transaction(result.project, parseVHTML("<page: next>"), {
      origin: "option",
      recordHistory: false,
      label: "Continue selected choice",
    });
    const oldIds = new Set(p.options.map((o) => o.id));
    for (const created of transition.project.options)
      if (!oldIds.has(created.id) && created.pageId === option.pageId)
        created.pageId = transition.project.activePageId;
    result.project = transition.project;
  }
  // Include the consumed option in the same undo checkpoint as its results.
  result.project.history = p.history;
  result.project.future = p.future;
  result.diff = commitGame(p, result.project, {
    origin: "option",
    label: `Choice: ${option.name}`,
  });
  if (result.generation)
    result.project.actionLock = {
      optionId: id,
      requestId: result.generation.id,
    };
  return result;
}
export function executeGameHook(
  p: GameProject,
  hook: string,
  options: { minutes?: number; random?: () => number } = {},
): GameExecution {
  if (p.vhtml3 && hook === "turn")
    return v3Turn(p, options.minutes, options.random);
  return executeLegacyHook(p, hook, options);
}
function executeLegacyHook(
  p: GameProject,
  hook: string,
  options: { minutes?: number; random?: () => number } = {},
  advance = true,
): GameExecution {
  const next = structuredClone(p);
  if (hook === "turn" && advance) next.turn++;
  if (options.minutes !== undefined) {
    if (!Number.isFinite(options.minutes) || options.minutes < 0)
      throw new Error("Elapsed minutes cannot be negative.");
    next.elapsedMinutes += options.minutes;
  }
  const ctx: Context = {
    destruction: { value: false },
    options: { origin: "option", label: `Hook: ${hook}` },
    warnings: [],
    count: 0,
    depth: 0,
    created: new Set(),
    random: options.random,
  };
  for (const rule of next.rules)
    if (
      rule.hook === hook &&
      (!rule.every || next.turn % rule.every === 0) &&
      rule.conditions.every((c) => condition(next, c))
    )
      runDeferred(next, rule.result, ctx, rule.owner);
  for (const encounter of next.objects.filter(
    (o) => o.kind === "encounter" && !o.v3,
  )) {
    const event = next.events.find((e) => e.objectId === encounter.id)!;
    if (
      event.active ||
      (encounter.lastTriggered !== undefined &&
        next.elapsedMinutes - encounter.lastTriggered <
          (encounter.cooldown ?? 0))
    )
      continue;
    const tests = encounter.conditions?.map((c) => condition(next, c)) ?? [];
    if (
      tests.length &&
      (encounter.conditionMode === "any"
        ? !tests.some(Boolean)
        : !tests.every(Boolean))
    )
      continue;
    let chance = encounter.baseChance ?? 0;
    for (const object of next.objects)
      if (object.sections && typeof object.value === "number") {
        const sections = object.sections.filter(
          (s) =>
            (object.value as number) >= s.min &&
            (object.sectionMode === "stack" ||
              (object.value as number) < s.max ||
              (s.includeMax && object.value === s.max)),
        );
        for (const section of sections)
          for (const command of section.result) {
            if (!["increase", "multiply"].includes(command.name))
              throw new Error(
                "Sections support increase/multiply chance only.",
              );
            if (
              named(next.objects, val(command, "encounter")).id !== encounter.id
            )
              continue;
            chance =
              command.name === "increase"
                ? chance + num(val(command, "chance"))
                : chance * num(val(command, "chance"));
          }
      }
    chance = Math.max(0, Math.min(100, chance));
    next.log.push({
      id: uid(),
      at: Date.now(),
      message: `Check ${encounter.name}: ${chance}%`,
    });
    if (draw(next, ctx) * 100 < chance)
      run(
        next,
        [
          {
            name: "trigger",
            fields: { encounter: [encounter.id], action: ["start"] },
            positional: [],
            span: { start: 0, end: 0, line: 1, column: 1 },
          },
        ],
        ctx,
      );
  }
  next.log = next.log.slice(-200);
  if (!validateGameProject(next))
    throw new Error("Hook produced invalid game state.");
  const diff = commitGame(p, next, {
    origin: "option",
    label: `Hook: ${hook}`,
  });
  return {
    requiresConfirmation: ctx.destruction.value,
    project: next,
    generation: ctx.generation,
    diff,
    warnings: ctx.warnings,
  };
}

registerLegacyTurn((p, random) =>
  executeLegacyHook(p, "turn", { random }, false),
);

// Narrative remains plain data, including angle brackets. This API avoids
// sending a large page through the language parser solely to quote its text.
export function appendGameText(
  p: GameProject,
  text: string,
  options: { label?: string; origin?: "user" | "ai" } = {},
): GameExecution {
  if (typeof text !== "string" || text.length > 524288)
    throw new Error("A narrative append is limited to 512 KiB.");
  const next = structuredClone(p);
  page(next).text += text;
  if (!validateGameProject(next))
    throw new Error(
      "Narrative exceeds the saved-page limits. Previous page was kept.",
    );
  const diff = commitGame(p, next, {
    origin: options.origin ?? "ai",
    label: options.label ?? "AI narrative",
  });
  return { project: next, diff, warnings: [] };
}
export function appendGameNarrative(p: GameProject, text: string): GameProject {
  return appendGameText(p, text).project;
}
export function replaceGamePageText(
  p: GameProject,
  pageId: string,
  text: string,
  options: { confirmed?: boolean } = {},
): GameProject {
  if (!options.confirmed)
    throw new Error("Confirm replacing this page's text.");
  if (typeof text !== "string" || text.length > 2000000)
    throw new Error("Page text is limited to two million characters.");
  const next = structuredClone(p),
    target = next.pages.find((a) => a.id === pageId);
  if (!target) throw new Error("Page no longer exists.");
  target.text = text;
  if (!validateGameProject(next))
    throw new Error("Page edit exceeds project limits.");
  commitGame(p, next, { origin: "user", label: "Edit page prose" });
  return next;
}

/** Direct typing shares one compact revision until the author pauses. */
export function editGamePageText(
  p: GameProject,
  pageId: string,
  text: string,
  at = Date.now(),
): GameProject {
  const index = p.pages.findIndex((page) => page.id === pageId);
  if (index < 0 || typeof text !== "string" || text.length > 2000000)
    throw new Error("Page prose is limited to 2,000,000 characters.");
  if (p.pages[index].text === text) return p;
  const last = p.history.at(-1),
    change = last?.changes[0];
  const grouped =
    !!last &&
    !p.future.length &&
    last.origin === "user" &&
    last.label === "Edit manuscript" &&
    at - last.at >= 0 &&
    at - last.at < 1200 &&
    last.changes.length === 1 &&
    change?.path.join(".") === `pages.${index}.text`;
  let before = p;
  if (grouped && change) {
    const now = p.pages[index].text;
    const original = change.text
      ? now.slice(0, change.text.keep) +
        change.text.before +
        (change.text.tail ? now.slice(-change.text.tail) : "")
      : String(change.before ?? "");
    before = {
      ...p,
      pages: p.pages.map((page, i) =>
        i === index ? { ...page, text: original } : page,
      ),
      history: p.history.slice(0, -1),
      log:
        p.log.at(-1)?.message === "Edit manuscript"
          ? p.log.slice(0, -1)
          : p.log,
    };
  }
  const next = {
    ...p,
    pages: p.pages.map((page, i) => (i === index ? { ...page, text } : page)),
  };
  commitGame(before, next, { origin: "user", label: "Edit manuscript" });
  const revision = next.history.at(-1);
  if (revision?.label === "Edit manuscript") {
    revision.at = at;
    if (grouped && last) revision.id = last.id;
  }
  return next;
}

export function proposeVHTML(
  p: GameProject,
  input: {
    id?: string;
    source: string;
    reason: string;
    dependencies?: string[];
  },
): GameExecution {
  const id = idValue(input.id, uid());
  if (p.proposals.some((q) => q.id === id))
    throw new Error(`Duplicate proposal '${id}'.`);
  const next = structuredClone(p);
  const proposal = {
    id,
    source: input.source.slice(0, 100000),
    reason: input.reason.slice(0, 5000),
    dependencies: input.dependencies ?? [],
    status: "pending" as const,
    created: Date.now(),
    changes: [] as GameExecution["diff"],
  };
  let commands: VCommand[];
  try {
    commands = parseVHTML(input.source);
  } catch (error) {
    next.proposals = [
      ...next.proposals,
      {
        ...proposal,
        status: "failed" as const,
        error:
          error instanceof Error ? error.message : "Invalid proposal syntax.",
      },
    ].slice(-500);
    return { project: next, diff: [], warnings: [] };
  }
  let generation: GameGeneration | undefined;
  try {
    const preview = transaction(p, commands, {
      origin: "ai",
      approved: true,
      confirmed: true,
      recordHistory: false,
    });
    proposal.changes = preview.diff;
    generation = preview.generation;
  } catch (error) {
    if (!proposal.dependencies.length) {
      next.proposals = [
        ...next.proposals,
        {
          ...proposal,
          status: "failed" as const,
          error: error instanceof Error ? error.message : "Invalid proposal.",
        },
      ].slice(-500);
      return { project: next, diff: [], warnings: [] };
    }
  }
  next.proposals = [...next.proposals, proposal].slice(-500);
  if (!validateGameProject(next))
    throw new Error(
      "Proposal exceeds the project storage limits. Previous project was kept.",
    );
  const flat = commands.flatMap((c) =>
    c.syntax === "xml" && c.name === "vhtml"
      ? (c.positional as VCommand[])
      : [c],
  );
  const routine = flat.every((c) => ["set", "modify"].includes(c.name));
  const xmlStructure =
    (!!p.vhtml3 || commands.some((c) => c.syntax === "xml")) && !routine;
  if (
    !xmlStructure &&
    !generation &&
    !commands.some((c) => c.name === "ai") &&
    (p.settings.approval === "auto" ||
      (p.settings.approval === "smart" && routine))
  ) {
    try {
      return acceptGameProposal(next, id);
    } catch {
      /* Keep pending when confirmation or dependencies are required. */
    }
  }
  return { project: next, diff: [], warnings: [] };
}
export function acceptGameProposal(
  p: GameProject,
  id: string,
  options: { confirmed?: boolean } = {},
): GameExecution {
  const ids: string[] = [],
    visiting = new Set<string>();
  const visit = (key: string) => {
    const q = p.proposals.find((a) => a.id === key);
    if (!q || !["pending", "approved"].includes(q.status))
      throw new Error(`Dependency '${key}' is not available.`);
    if (q.status === "approved" || ids.includes(key)) return;
    if (visiting.has(key))
      throw new Error("Proposal dependencies contain a cycle.");
    visiting.add(key);
    q.dependencies.forEach(visit);
    visiting.delete(key);
    ids.push(key);
  };
  visit(id);
  if (!ids.length) throw new Error("Proposal was already applied.");
  if (ids.length > 50)
    throw new Error("A proposal approval bundle is limited to 50 proposals.");
  const commands = ids.flatMap((key) =>
    parseVHTML(p.proposals.find((q) => q.id === key)!.source),
  );
  const result = transaction(p, commands, {
    origin: "ai",
    approved: true,
    confirmed: options.confirmed,
    label: "Approve V-HTML proposals",
  });
  result.project.proposals = result.project.proposals.map((q) =>
    ids.includes(q.id) ? { ...q, status: "approved", changes: result.diff } : q,
  );
  if (result.project.history.length > p.history.length || result.diff.length)
    result.project.history.at(-1)!.proposalIds = ids;
  if (!validateGameProject(result.project))
    throw new Error(
      "Approved proposal audit exceeds the project storage limits. Previous project was kept.",
    );
  return result;
}
export function rejectGameProposal(p: GameProject, id: string): GameProject {
  const next = structuredClone(p);
  const proposal = next.proposals.find((q) => q.id === id);
  if (!proposal || proposal.status !== "pending")
    throw new Error("Only a pending proposal can be rejected.");
  proposal.status = "rejected";
  next.log = [
    ...next.log,
    { id: uid(), at: Date.now(), message: "Rejected proposal: " + id },
  ].slice(-200);
  return next;
}
export function editGameProposal(
  p: GameProject,
  id: string,
  source: string,
): GameProject {
  const original = p.proposals.find((q) => q.id === id);
  if (!original || !["pending", "failed"].includes(original.status))
    throw new Error("Only a pending or failed proposal can be edited.");
  const base = {
    ...p,
    proposals: p.proposals.filter((q) => q.id !== id),
    settings: { ...p.settings, approval: "manual" as const },
  };
  const edited = proposeVHTML(base, {
    id,
    source,
    reason: original.reason,
    dependencies: original.dependencies,
  }).project;
  edited.settings = p.settings;
  return edited;
}

export function generateVHTML(
  p: GameProject,
  options: { includeAllPageText?: boolean } = {},
) {
  if (p.vhtml3) return exportV3(p);
  const quote = (v: unknown) => JSON.stringify(v),
    source: string[] = [];
  source.push(
    `<config: approval: ${p.settings.approval} profile: ${p.settings.profile} max-context-tokens: ${p.settings.maxContextTokens} max-history-pages: ${p.settings.maxHistoryPages} reserve-tokens: ${p.settings.reserveTokens} summary: ${p.settings.summary} output-tokens: ${p.settings.maxOutputTokens} thinking: ${p.settings.thinking} thinking-level: ${p.settings.thinkingLevel} thinking-output-tokens: ${p.settings.thinkingMaxTokens} choice-new-page: ${p.settings.choiceNewPage !== false} generation-new-page: ${p.settings.generationNewPage !== false}>`,
  );
  for (const o of p.objects) {
    source.push(`<add: ${o.kind}: name: ${quote(o.name)} id: ${quote(o.id)}>`);
    source.push(
      `<define: ${o.kind}: ${quote(o.id)} type: ${o.type}${o.min === undefined ? "" : ` min: ${o.min}`}${o.max === undefined ? "" : ` max: ${o.max}`} default: ${quote(typeof o.default === "object" ? JSON.stringify(o.default) : o.default)} value: ${quote(typeof o.value === "object" ? JSON.stringify(o.value) : o.value)}${o.choices ? ` choices: ${o.choices.map(quote).join(" ")}` : ""} description: ${quote(o.description)} description-ai: ${quote(o.descriptionAI)} description-noai: ${quote(o.descriptionNoAI)} scope: ${quote(o.scope)} persistent: ${o.persistent} ai-access: ${o.aiAccess}${o.baseChance === undefined ? "" : ` base-chance: ${o.baseChance}`}${o.cooldown === undefined ? "" : ` cooldown: ${o.cooldown}`}>`,
    );
    if (o.sections?.length || o.conditions?.length || o.onTrigger?.length)
      source.push(
        `<configure: ${o.kind}: ${quote(o.id)}${o.sections?.length ? ` section-${o.sectionMode}: ${o.sections.map((s) => `<section: [${s.min},${s.max}${s.includeMax ? "]" : ")"} result: ${printVHTML(s.result)}>`).join(" ")}` : ""}${o.conditions?.length ? ` conditions: ${printVHTML(o.conditions)} mode: ${o.conditionMode ?? "all"}` : ""}${o.onTrigger?.length ? ` on-trigger: ${printVHTML(o.onTrigger)}` : ""}>`,
      );
  }
  for (const a of p.pages) {
    source.push(
      `<page: create: id: ${quote(a.id)} title: ${quote(a.title)} persistent: ${a.persistent}>`,
    );
    if (
      options.includeAllPageText ||
      (a.id === p.activePageId && a.text.length <= 60000)
    ) {
      source.push(`<text: page: ${quote(a.id)} replace: "">`);
      for (let i = 0; i < a.text.length; i += 12000)
        source.push(
          `<text: page: ${quote(a.id)} append: ${quote(a.text.slice(i, i + 12000))}>`,
        );
    } else if (a.text)
      source.push(
        `// Page ${quote(a.id)} prose remains in the page editor / full project JSON.`,
      );
    if (a.summary)
      source.push(`<summary: page: ${quote(a.id)} value: ${quote(a.summary)}>`);
  }
  for (const a of p.panels)
    source.push(
      `<panel: id: ${quote(a.id)} name: ${quote(a.name)} ui: ${a.ui}${a.pageId ? ` page: ${quote(a.pageId)}` : ""}${a.eventId ? ` event: ${quote(a.eventId)}` : ""} drawer: ${a.drawer} position: ${a.position} visible: ${a.visible}>`,
    );
  for (const w of p.widgets)
    source.push(
      `<display: id: ${quote(w.id)} target: ${quote(w.binding)} label: ${quote(w.label)} style: ${w.style} ui: ${w.ui}${w.panel ? ` panel: ${quote(w.panel)}` : ""}${w.pageId ? ` page: ${quote(w.pageId)}` : ""}${w.eventId ? ` event: ${quote(w.eventId)}` : ""} position: ${w.position} visible: ${w.visible} remove-on: ${w.removeOn}${w.expiresAfter === undefined ? "" : ` expires-after: ${w.expiresAfter}`}>`,
    );
  for (const o of p.options)
    source.push(
      `<option: id: ${quote(o.id)} page: ${quote(o.pageId)} name: ${quote(o.name)} add-as: ${o.order} description: ${quote(o.description)} group: ${quote(o.group)} once: ${o.once} result: ${printVHTML(o.result)}${o.conditions.length ? ` condition: ${printVHTML(o.conditions)}` : ""}${o.disabledIf.length ? ` disabled-if: ${printVHTML(o.disabledIf)}` : ""}>`,
    );
  for (const i of p.instructions)
    source.push(
      `<ai-instruct: id: ${quote(i.id)} scope: ${i.scope} content: ${quote(i.content)} enabled: ${i.enabled} priority: ${i.priority}${i.target ? ` ${i.scope}: ${quote(i.target)}` : ""}${i.pageId ? ` page: ${quote(i.pageId)}` : ""}>`,
    );
  for (const r of p.rules)
    source.push(
      `<${r.every ? "every" : "on"}: id: ${quote(r.id)} hook: ${quote(r.hook)}${r.every ? ` turns: ${r.every}` : ""} result: ${printVHTML(r.result)}${r.conditions.length ? ` condition: ${printVHTML(r.conditions)}` : ""}>`,
    );
  source.push(`<page: goto: ${quote(p.activePageId)}>`);
  return source.join("\n");
}
