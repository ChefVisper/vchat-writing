import { uid } from "../types";
import { commitGame, safeGameData } from "./state";
import { attrs, children, escapeXML, printXML } from "./xml";
import { VHTMLError, type VCommand } from "./parser";
import type {
  GameProject,
  GameObject,
  GameOption,
  GameExecutionOptions,
  GameExecution,
  GameValue,
} from "./types";

export const V3_SCHEMA: Record<string, string[]> = {
  vhtml: ["version"],
  add: [
    "type",
    "id",
    "name",
    "norm",
    "min",
    "max",
    "default",
    "ai-access",
    "description-ai",
    "description-noai",
    "tags",
    "active",
    "base-chance",
    "trigger",
    "enabled",
    "reset-on-success",
    "source",
    "entity",
    "run-on-init",
  ],
  configure: [
    "id",
    "name",
    "norm",
    "min",
    "max",
    "default",
    "ai-access",
    "description-ai",
    "description-noai",
    "link",
    "unlink",
    "auto-link",
    "value",
    "tags",
    "active",
    "base-chance",
    "trigger",
    "enabled",
    "reset-on-success",
    "source",
    "entity",
    "run-on-init",
  ],
  modify: ["id", "entity", "op", "value", "value-ref"],
  choice: ["id", "label", "name", "count", "pressed", "add-as", "group"],
  transform: ["id", "label", "name", "count", "pressed", "add-as", "group"],
  condition: ["id", "entity", "op", "value", "mode", "role", "rule-id"],
  then: ["every"],
  else: ["every"],
  section: ["range", "every", "rule-id"],
  "check-success": ["every", "rule-id"],
  "check-fail": ["every", "rule-id"],
  ai: ["instruction", "mode"],
  page: ["mode", "page-id", "go-to", "title"],
  ui: [
    "type",
    "id",
    "entity",
    "target",
    "widget-id",
    "label",
    "scope",
    "position",
    "panel",
    "drawer",
    "visible",
  ],
  check: ["id"],
  remove: ["id", "type"],
  random: ["min", "max", "norm", "save-to"],
  text: ["content", "mode"],
  config: [
    "approval",
    "profile",
    "output-tokens",
    "max-context-tokens",
    "thinking",
    "thinking-level",
    "thinking-output-tokens",
    "choice-new-page",
    "generation-new-page",
  ],
};
V3_SCHEMA.conf = V3_SCHEMA.configure;
const reserved = new Set(["__proto__", "prototype", "constructor"]);
let legacyTurn:
  ((p: GameProject, random?: () => number) => GameExecution) | undefined;
export function registerLegacyTurn(handler: NonNullable<typeof legacyTurn>) {
  legacyTurn = handler;
}
const validID = (id: string) =>
  /^(?:[A-Za-z_][A-Za-z0-9_-]*|[0-9]+)$/.test(id) &&
  !reserved.has(id) &&
  id.length <= 120;
export function validateV3(nodes: VCommand[], depth = 0): void {
  if (depth > 24) throw new Error("XML rule nesting limit exceeded.");
  for (const c of nodes) {
    const a = attrs(c),
      allowed = V3_SCHEMA[c.name];
    const fail = (message: string): never => {
      throw new VHTMLError([
        { code: "INVALID_ATTRIBUTE", message, span: c.span },
      ]);
    };
    if (c.syntax !== "xml" || !allowed)
      fail(`Unsupported V-HTML 3.0 command <${c.name}>.`);
    if (c.authoredBy !== undefined && !["user", "ai"].includes(c.authoredBy))
      fail("Invalid saved rule origin.");
    if (
      c.blockId !== undefined &&
      (typeof c.blockId !== "string" || c.blockId.length > 200)
    )
      fail("Invalid saved block ID.");
    if (
      c.name === "condition" &&
      a.role !== undefined &&
      !["rule", "requirement"].includes(a.role)
    )
      fail("Condition role must be rule or requirement.");
    if (
      c.name === "condition" &&
      a.role === "requirement" &&
      children(c).some((n) => ["then", "else"].includes(n.name))
    )
      fail("Requirements cannot have side effects.");
    for (const [k, v] of Object.entries(c.fields))
      if (!allowed.includes(k) || v.length !== 1 || typeof v[0] !== "string")
        fail(`Unsupported or invalid ${c.name}.${k}.`);
    if (
      a.id !== undefined &&
      (["add", "choice", "transform"].includes(c.name)
        ? !validID(a.id)
        : !a.id ||
          a.id !== a.id.trim() ||
          reserved.has(a.id) ||
          a.id.length > 500)
    )
      fail(
        "IDs must use letters, digits, underscores or hyphens, without surrounding spaces.",
      );
    if (c.name === "vhtml" && a.version !== "3.0")
      fail('Expected version="3.0".');
    if (c.name === "choice" || c.name === "transform") {
      if (a.name !== undefined && a.label !== undefined)
        fail("Use label or name, not both.");
      if (
        a.count !== undefined &&
        (!/^\d+$/.test(a.count) || +a.count < 1 || +a.count > 10000)
      )
        fail("Choice count must be a positive integer.");
      if (a.pressed && !["remove", "stay", "transform"].includes(a.pressed))
        fail("Unknown pressed behavior.");
    }
    if (a.every && !/^[1-9]\d*:(?:\d*)$/.test(a.every))
      fail('every must use "Y:X", with Y > 0 and X >= 0.');
    const childNames: Record<string, string[]> = {
      vhtml: Object.keys(V3_SCHEMA).filter(
        (k) =>
          ![
            "then",
            "else",
            "section",
            "check-success",
            "check-fail",
            "transform",
          ].includes(k),
      ),
      add: [],
      configure: ["condition", "section", "check-success", "check-fail"],
      choice: ["then", "transform"],
      transform: ["then", "transform"],
      condition: ["condition", "then", "else"],
    };
    const permitted =
      childNames[c.name] ??
      (["then", "else", "section", "check-success", "check-fail"].includes(
        c.name,
      )
        ? Object.keys(V3_SCHEMA).filter(
            (k) =>
              ![
                "vhtml",
                "transform",
                "else",
                "section",
                "check-success",
                "check-fail",
              ].includes(k),
          )
        : []);
    if (children(c).some((child) => !child || !permitted.includes(child.name)))
      fail(`Invalid child element in <${c.name}>.`);
    if (
      (c.name === "condition" &&
        children(c).filter((n) => n.name === "then").length > 1) ||
      (c.name === "condition" &&
        children(c).filter((n) => n.name === "else").length > 1)
    )
      fail("A condition can have one then and one else block.");
    validateV3(children(c), depth + 1);
  }
}
const meta = (): NonNullable<GameObject["v3"]> => ({
  active: true,
  tags: [],
  autoLink: false,
  trigger: "manual",
  enabled: true,
  resetOnSuccess: false,
  source: "",
  entity: "player",
  runOnInit: false,
  rules: [],
  sections: [],
});
export function v3Value(
  p: GameProject,
  id: string,
  entity?: string,
): GameValue {
  const o = p.objects.find((o) => o.id === id);
  if (!o) throw new Error("UNKNOWN_ID: Object reference is unavailable.");
  if (o.kind === "stat" && o.v3) {
    const value = p.vhtml3?.bindings[id]?.[entity ?? "player"];
    if (value === undefined)
      throw new Error(
        "MISSING_STAT_BINDING: Link the stat to this entity first.",
      );
    return value;
  }
  if (entity)
    throw new Error("INVALID_ATTRIBUTE: entity is only valid for stat values.");
  return o.value;
}
class Engine {
  p: GameProject;
  generation?: GameExecution["generation"];
  additional: NonNullable<GameExecution["generation"]>[] = [];
  changed: { id: string; entity?: string; value: GameValue }[] = [];
  steps = 0;
  destruction = false;
  trust: "user" | "ai";
  constructor(
    p: GameProject,
    public options: GameExecutionOptions,
    public randomOverride?: () => number,
  ) {
    this.p = structuredClone(p);
    this.trust = options.origin === "ai" ? "ai" : "user";
    this.p.vhtml3 ??= {
      version: "3.0",
      bindings: {},
      templates: {},
      usage: {},
    };
    if (!this.p.objects.some((o) => o.id === "player")) {
      const trust = this.trust;
      this.trust = "user";
      this.add({ type: "entity", id: "player", name: "Player" });
      this.trust = trust;
    }
  }
  fail(code: string, message: string): never {
    throw new Error(`${code}: ${message}`);
  }
  bool(v: string | undefined, fallback = false) {
    if (v === undefined) return fallback;
    if (!["true", "false"].includes(v))
      this.fail("INVALID_TYPE", "Expected true or false.");
    return v === "true";
  }
  number(v: string | undefined, fallback = 0) {
    if (v === undefined) return fallback;
    if (
      !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(v) ||
      !Number.isFinite(+v)
    )
      this.fail("INVALID_TYPE", "Expected a finite number.");
    return +v;
  }
  object(id?: string): GameObject {
    const o = this.p.objects.find((o) => o.id === id);
    if (!o || (this.trust === "ai" && o.aiAccess === "none"))
      this.fail("UNKNOWN_ID", "Object reference is unavailable.");
    return o;
  }
  write(o: GameObject, structural = false) {
    if (
      this.trust === "ai" &&
      (o.aiAccess === "none" ||
        (!structural && o.aiAccess !== "modify") ||
        (structural && !this.options.approved))
    )
      this.fail(
        "PERMISSION_DENIED",
        "This operation needs the appropriate object permission and approval.",
      );
  }
  checked(o: GameObject, value: unknown, clamp = true): GameValue {
    if (o.type === "enum") {
      if (typeof value !== "string" || !o.choices?.includes(value))
        this.fail("INVALID_TYPE", "Expected a registered enum value.");
      return value as string;
    }
    if (o.type === "list" || o.type === "object") {
      let data = value;
      if (typeof value === "string") {
        try {
          data = JSON.parse(value);
        } catch {
          this.fail(
            "INVALID_TYPE",
            "Expected valid JSON for this legacy value.",
          );
        }
      }
      if (
        !data ||
        typeof data !== "object" ||
        (o.type === "list" ? !Array.isArray(data) : Array.isArray(data)) ||
        !safeGameData(data)
      )
        this.fail("INVALID_TYPE", "Legacy JSON value has the wrong type.");
      return data as GameValue;
    }
    if (o.type === "string") {
      if (typeof value !== "string")
        this.fail("INVALID_TYPE", "Expected text.");
      return value as string;
    }
    if (o.type === "boolean") {
      if (typeof value === "string") return this.bool(value);
      if (typeof value !== "boolean")
        this.fail("INVALID_TYPE", "Expected a boolean.");
      return value as boolean;
    }
    const n = typeof value === "number" ? value : this.number(String(value));
    if (!Number.isFinite(n))
      this.fail("INVALID_TYPE", "Numeric result must be finite.");
    if (o.type === "integer" && !Number.isInteger(n))
      this.fail("INVALID_TYPE", "Integer values cannot contain a fraction.");
    if (
      !clamp &&
      ((o.min !== undefined && n < o.min) || (o.max !== undefined && n > o.max))
    )
      this.fail("INVALID_RANGE", "Default is outside min/max.");
    return Math.max(o.min ?? -Infinity, Math.min(o.max ?? Infinity, n));
  }
  mark(c: VCommand, previous?: VCommand): VCommand {
    return {
      ...c,
      blockId: previous?.blockId ?? c.blockId ?? uid(),
      authoredBy: c.authoredBy ?? this.trust,
      positional: children(c).map((n, i) =>
        this.mark(
          n,
          previous && children(previous)[i]?.name === n.name
            ? children(previous)[i]
            : undefined,
        ),
      ),
    };
  }
  add(a: Record<string, string>) {
    if (
      !a.id ||
      !validID(a.id) ||
      !["stat", "entity", "variable", "encounter", "mechanic"].includes(a.type)
    )
      this.fail("INVALID_ATTRIBUTE", "add requires a valid id and type.");
    if (
      this.p.objects.some((o) => o.id === a.id) ||
      this.p.vhtml3!.templates[a.id]
    )
      this.fail("DUPLICATE_ID", "This global ID is already registered.");
    if (this.trust === "ai" && a["ai-access"] && a["ai-access"] !== "read")
      this.fail("PERMISSION_DENIED", "AI cannot assign itself permissions.");
    const norm =
      a.norm === "%"
        ? "percentage"
        : (a.norm ??
          (a.type === "variable" || a.type === "entity"
            ? "string"
            : a.type === "encounter"
              ? "percentage"
              : "integer"));
    if (
      !["string", "integer", "decimal", "boolean", "percentage"].includes(
        norm,
      ) ||
      (a.type === "stat" && norm !== "integer") ||
      (a.type === "encounter" && norm !== "percentage") ||
      (a.type === "mechanic" && norm !== "integer")
    )
      this.fail("INVALID_TYPE", "Unsupported norm for this object type.");
    const o: GameObject = {
      id: a.id,
      name: a.name ?? a.id,
      kind: a.type,
      type: norm === "decimal" ? "number" : (norm as GameObject["type"]),
      value: 0,
      default: 0,
      description: "",
      descriptionAI: a["description-ai"] ?? "",
      descriptionNoAI: a["description-noai"] ?? "",
      scope: "world",
      persistent: true,
      aiAccess: "read",
      owner: this.trust,
      v3: meta(),
    };
    if (a.type === "stat" || a.type === "mechanic" || norm === "percentage") {
      o.min = 0;
      o.max = 100;
    }
    if (a.min !== undefined) o.min = this.number(a.min);
    if (a.max !== undefined) o.max = this.number(a.max);
    if (norm === "percentage") {
      o.min = Math.max(0, o.min ?? 0);
      o.max = Math.min(100, o.max ?? 100);
    }
    if (o.min !== undefined && o.max !== undefined && o.min > o.max)
      this.fail("INVALID_RANGE", "Minimum exceeds maximum.");
    o.default = this.checked(
      o,
      a.default ??
        (norm === "string"
          ? ""
          : norm === "boolean"
            ? "false"
            : a.type === "stat"
              ? "10"
              : a.type === "encounter"
                ? (a["base-chance"] ?? "0")
                : "0"),
      false,
    );
    o.value = o.default;
    if (o.kind === "encounter") o.v3!.trigger = "turn";
    if (o.kind === "mechanic") o.v3!.trigger = "on-change";
    this.p.objects.push(o);
    this.configure(o, a, []);
    if (o.kind === "entity")
      for (const stat of this.p.objects.filter(
        (s) => s.kind === "stat" && s.v3?.autoLink,
      ))
        this.link(stat, o.id);
    if (o.kind === "stat") this.p.vhtml3!.bindings[o.id] ??= {};
  }
  link(o: GameObject, entity: string, value?: string) {
    const e = this.object(entity);
    if (e.kind !== "entity")
      this.fail("INVALID_TYPE", "Stat bindings require an entity.");
    const map = (this.p.vhtml3!.bindings[o.id] ??= {});
    if (value !== undefined || map[entity] === undefined)
      map[entity] = this.checked(o, value ?? o.default) as number;
  }
  configure(o: GameObject, a: Record<string, string>, rules: VCommand[]) {
    // A legacy definition edit is not an implicit data migration.
    if (!o.v3) {
      const common = [
        "id",
        "name",
        "norm",
        "min",
        "max",
        "default",
        "ai-access",
        "description-ai",
        "description-noai",
      ];
      if (rules.length || Object.keys(a).some((k) => !common.includes(k)))
        this.fail(
          "INVALID_ATTRIBUTE",
          "Use the legacy editor for old rules, or create a new V3 definition for entity bindings.",
        );
      if (
        a.norm &&
        (a.norm === "decimal"
          ? "number"
          : a.norm === "%"
            ? "percentage"
            : a.norm) !== o.type
      )
        this.fail(
          "INVALID_TYPE",
          "Changing a legacy norm requires an explicit migration.",
        );
      if (a["ai-access"] !== undefined) {
        if (
          !["none", "read", "modify"].includes(a["ai-access"]) ||
          (this.trust === "ai" && a["ai-access"] !== o.aiAccess)
        )
          this.fail(
            "PERMISSION_DENIED",
            "AI cannot change access permissions.",
          );
        o.aiAccess = a["ai-access"] as GameObject["aiAccess"];
      }
      if (a.name !== undefined) o.name = a.name;
      if (a["description-ai"] !== undefined)
        o.descriptionAI = a["description-ai"];
      if (a["description-noai"] !== undefined)
        o.descriptionNoAI = a["description-noai"];
      if (a.min !== undefined) o.min = this.number(a.min);
      if (a.max !== undefined) o.max = this.number(a.max);
      if (o.min !== undefined && o.max !== undefined && o.min > o.max)
        this.fail("INVALID_RANGE", "Minimum exceeds maximum.");
      if (a.default !== undefined)
        o.default = this.checked(o, a.default, false);
      if (a.min !== undefined || a.max !== undefined) {
        o.default = this.checked(o, o.default);
        o.value = this.checked(o, o.value);
      }
      return;
    }
    if (
      ["string", "boolean"].includes(o.type) &&
      (a.min !== undefined || a.max !== undefined)
    )
      this.fail("INVALID_ATTRIBUTE", "Only numeric values support min/max.");
    if (
      o.kind === "encounter" &&
      ["default", "min", "max"].some((k) => a[k] !== undefined)
    )
      this.fail(
        "INVALID_ATTRIBUTE",
        "Encounters use base-chance and a fixed 0..100 range.",
      );
    if (
      o.type === "integer" &&
      [a.min, a.max].some(
        (v) => v !== undefined && !Number.isInteger(this.number(v)),
      )
    )
      this.fail("INVALID_RANGE", "Integer bounds must be integers.");
    const specific: Record<string, string[]> = {
      entity: ["tags", "active"],
      stat: ["link", "unlink", "auto-link", "value"],
      encounter: ["base-chance", "trigger", "enabled", "reset-on-success"],
      mechanic: ["source", "entity", "trigger", "run-on-init"],
    };
    const special = [
      "tags",
      "active",
      "link",
      "unlink",
      "auto-link",
      "value",
      "base-chance",
      "trigger",
      "enabled",
      "reset-on-success",
      "source",
      "entity",
      "run-on-init",
    ];
    for (const k of special)
      if (a[k] !== undefined && !(specific[o.kind] ?? []).includes(k))
        this.fail(
          "INVALID_ATTRIBUTE",
          `${k} is not supported for this object type.`,
        );
    if (
      o.kind === "entity" &&
      ["norm", "min", "max", "default"].some((k) => a[k] !== undefined)
    )
      this.fail(
        "INVALID_ATTRIBUTE",
        "Entities use tags and stat bindings, not numeric definitions.",
      );
    if (rules.length && !["mechanic", "encounter"].includes(o.kind))
      this.fail(
        "INVALID_ATTRIBUTE",
        "Configure rules on a mechanic or encounter.",
      );
    if (
      (o.kind === "mechanic" &&
        rules.some((r) => !["condition", "section"].includes(r.name))) ||
      (o.kind === "encounter" &&
        rules.some(
          (r) => !["condition", "check-success", "check-fail"].includes(r.name),
        ))
    )
      this.fail("INVALID_ATTRIBUTE", "Invalid rule for this object type.");
    o.v3 ??= meta();
    if (a["ai-access"]) {
      if (this.trust === "ai" && a["ai-access"] !== o.aiAccess)
        this.fail("PERMISSION_DENIED", "AI cannot change access permissions.");
      if (!["none", "read", "modify"].includes(a["ai-access"]))
        this.fail("INVALID_ATTRIBUTE", "Unknown ai-access.");
      o.aiAccess = a["ai-access"] as GameObject["aiAccess"];
    }
    if (
      a.norm &&
      (a.norm === "decimal"
        ? "number"
        : a.norm === "%"
          ? "percentage"
          : a.norm) !== o.type
    )
      this.fail(
        "INVALID_TYPE",
        "Changing norm requires an explicit migration.",
      );
    if (a.name !== undefined) o.name = a.name;
    if (a["description-ai"] !== undefined)
      o.descriptionAI = a["description-ai"];
    if (a["description-noai"] !== undefined)
      o.descriptionNoAI = a["description-noai"];
    if (a.min !== undefined) o.min = this.number(a.min);
    if (a.max !== undefined) o.max = this.number(a.max);
    if (o.type === "percentage") {
      o.min = Math.max(0, o.min ?? 0);
      o.max = Math.min(100, o.max ?? 100);
    }
    if (o.min !== undefined && o.max !== undefined && o.min > o.max)
      this.fail("INVALID_RANGE", "Minimum exceeds maximum.");
    if (a.default !== undefined) o.default = this.checked(o, a.default, false);
    else o.default = this.checked(o, o.default);
    o.value = this.checked(o, o.value);
    if (o.kind === "stat") {
      const bindings = (this.p.vhtml3!.bindings[o.id] ??= {});
      for (const id of Object.keys(bindings))
        bindings[id] = this.checked(o, bindings[id]) as number;
      if (a.link && a.unlink)
        this.fail("INVALID_ATTRIBUTE", "link and unlink cannot be combined.");
      if (a["auto-link"] !== undefined)
        o.v3.autoLink = this.bool(a["auto-link"]);
      if (a.link === "all" || a["auto-link"] === "true")
        for (const e of this.p.objects.filter((e) => e.kind === "entity"))
          this.link(o, e.id, a.value);
      else if (a.link) this.link(o, a.link, a.value);
      if (a.unlink) {
        this.object(a.unlink);
        delete bindings[a.unlink];
        this.p.widgets = this.p.widgets.filter(
          (w) => !(w.binding === o.id && w.entity === a.unlink),
        );
      }
      o.value = o.default;
    } else if (a.link || a.unlink || a["auto-link"] !== undefined)
      this.fail(
        "INVALID_ATTRIBUTE",
        "Only stats support link/unlink/auto-link.",
      );
    if (a.value !== undefined && !a.link && a["auto-link"] !== "true")
      this.fail(
        "INVALID_ATTRIBUTE",
        "Use modify for current values, or value together with link.",
      );
    if (a.tags !== undefined) {
      if (o.kind !== "entity")
        this.fail("INVALID_ATTRIBUTE", "tags requires an entity.");
      o.v3.tags = [
        ...new Set(
          a.tags
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean),
        ),
      ];
    }
    if (a.active !== undefined) {
      if (o.kind !== "entity")
        this.fail("INVALID_ATTRIBUTE", "active requires an entity.");
      o.v3.active = this.bool(a.active);
    }
    if (o.kind === "encounter") {
      o.v3.trigger = a.trigger ?? o.v3.trigger;
      if (!["turn", "manual"].includes(o.v3.trigger))
        this.fail(
          "INVALID_ATTRIBUTE",
          "Encounter trigger must be turn or manual.",
        );
      if (a["base-chance"] !== undefined) {
        const chance = this.number(a["base-chance"]);
        if (chance < 0 || chance > 100)
          this.fail("INVALID_RANGE", "base-chance must be 0..100.");
        o.baseChance = chance;
        o.value = chance;
        o.default = chance;
      }
      o.baseChance ??= 0;
      if (a.enabled !== undefined) o.v3.enabled = this.bool(a.enabled);
      if (a["reset-on-success"] !== undefined)
        o.v3.resetOnSuccess = this.bool(a["reset-on-success"]);
    }
    if (o.kind === "mechanic") {
      const sourceChanged =
        (a.source !== undefined && a.source !== o.v3.source) ||
        (a.entity !== undefined && a.entity !== o.v3.entity);
      o.v3.source = a.source ?? o.v3.source;
      o.v3.entity = a.entity ?? o.v3.entity;
      o.v3.trigger = a.trigger ?? o.v3.trigger;
      if (!["on-change", "on-turn", "manual"].includes(o.v3.trigger))
        this.fail("INVALID_ATTRIBUTE", "Unsupported mechanic trigger.");
      if (a["run-on-init"] !== undefined)
        o.v3.runOnInit = this.bool(a["run-on-init"]);
      if (sourceChanged) o.v3.sections = [];
    } else if (a.source || a.entity || a["run-on-init"] !== undefined)
      this.fail(
        "INVALID_ATTRIBUTE",
        "source/entity/run-on-init require a mechanic.",
      );
    for (const rule of rules) {
      const marked = this.mark(rule),
        key = attrs(rule)["rule-id"];
      const index = key
        ? o.v3.rules.findIndex((r) => attrs(r)["rule-id"] === key)
        : -1;
      if (index < 0) o.v3.rules.push(marked);
      else o.v3.rules[index] = this.mark(rule, o.v3.rules[index]);
    }
    if (
      o.kind === "mechanic" &&
      (rules.length > 0 ||
        a.source !== undefined ||
        a.entity !== undefined ||
        a["run-on-init"] === "true")
    ) {
      const current = this.sections(o);
      o.v3.sections = o.v3.runOnInit ? [] : current;
      if (o.v3.runOnInit) this.mechanic(o);
    }
    for (const rule of o.v3.rules) this.validateRule(rule);
  }
  validateRule(c: VCommand) {
    const a = attrs(c);
    if (c.name === "condition") this.test(c);
    if (c.name === "section") this.range(a.range);
    if (a.every && +a.every.split(":")[0] > 10000)
      this.fail("INVALID_ATTRIBUTE", "every limit is too large.");
    for (const child of children(c))
      if (
        [
          "condition",
          "then",
          "else",
          "section",
          "check-success",
          "check-fail",
        ].includes(child.name)
      )
        this.validateRule(child);
  }
  range(s: string) {
    const m = /^([\[(])\s*([+-]?[\d.]+)\s*,\s*([+-]?[\d.]+)\s*([\])])$/.exec(
      s ?? "",
    );
    if (
      !m ||
      !Number.isFinite(+m[2]) ||
      !Number.isFinite(+m[3]) ||
      +m[2] > +m[3] ||
      (+m[2] === +m[3] && (m[1] !== "[" || m[4] !== "]"))
    )
      this.fail("INVALID_RANGE", "Invalid section interval.");
    return { min: +m[2], max: +m[3], left: m[1] === "[", right: m[4] === "]" };
  }
  test(c: VCommand): boolean {
    const trust = this.trust;
    if (c.authoredBy) this.trust = c.authoredBy;
    try {
      return this.testValue(c);
    } finally {
      this.trust = trust;
    }
  }
  testValue(c: VCommand): boolean {
    const a = attrs(c),
      nested = children(c).filter((c) => c.name === "condition");
    if (a.mode) {
      if (!["all", "any"].includes(a.mode) || !nested.length || a.id)
        this.fail(
          "INVALID_ATTRIBUTE",
          "Condition groups need children and mode all/any.",
        );
      return a.mode === "all"
        ? nested.every((c) => this.test(c))
        : nested.some((c) => this.test(c));
    }
    if (!a.id || nested.length)
      this.fail("INVALID_ATTRIBUTE", "A simple condition requires an id.");
    const o = this.object(a.id),
      actual = v3Value(
        this.p,
        a.id,
        o.kind === "stat" && o.v3 ? (a.entity ?? "player") : a.entity,
      ),
      expected = this.checked(
        { ...o, min: undefined, max: undefined },
        a.value,
        false,
      ),
      op = a.op ?? "eq";
    if (
      !["eq", "neq", "gt", "gte", "lt", "lte"].includes(op) ||
      (!["eq", "neq"].includes(op) &&
        (typeof actual !== "number" || typeof expected !== "number"))
    )
      this.fail("INVALID_TYPE", "This comparator requires numeric operands.");
    switch (op) {
      case "eq":
        return actual === expected;
      case "neq":
        return actual !== expected;
      case "gt":
        return (actual as number) > (expected as number);
      case "gte":
        return (actual as number) >= (expected as number);
      case "lt":
        return (actual as number) < (expected as number);
      default:
        return (actual as number) <= (expected as number);
    }
  }
  block(c: VCommand, owner: string) {
    if (owner !== "action") {
      const p = this.p;
      const snapshot = {
        ...structuredClone({
          ...p,
          pages: [],
          history: [],
          future: [],
          log: [],
          proposals: [],
        }),
        pages: p.pages.map((page) => ({ ...page })),
        history: p.history,
        future: p.future,
        log: p.log,
        proposals: p.proposals,
      };
      const generation = this.generation ? { ...this.generation } : undefined,
        additional = this.additional.map((a) => ({ ...a })),
        changed = [...this.changed],
        trust = this.trust;
      try {
        this.runBlock(c, owner);
      } catch (error) {
        if (
          error instanceof Error &&
          error.message.includes("EVENT_LOOP_LIMIT")
        )
          throw error;
        this.p = snapshot;
        this.generation = generation;
        this.additional = additional;
        this.changed = changed;
        this.trust = trust;
        this.log(
          `Rule block rolled back: ${error instanceof Error ? error.message : "Invalid rule action."}`,
        );
      }
      return;
    }
    this.runBlock(c, owner);
  }
  runBlock(c: VCommand, owner: string) {
    const a = attrs(c),
      key = `${owner}_${c.blockId ?? `${c.span.start}_${c.span.end}`}`;
    if (a.every) {
      const [limit, window] = a.every.split(":").map(Number),
        usage = this.p.vhtml3!.usage[key] ?? [];
      if (
        usage.filter((t) => !window || t > this.p.turn - window).length >= limit
      )
        return;
      this.run(children(c));
      this.p.vhtml3!.usage[key] = [
        ...usage.filter((t) => !window || t > this.p.turn - window),
        this.p.turn,
      ].slice(-limit);
    } else this.run(children(c));
  }
  condition(c: VCommand, owner: string) {
    const yes = this.test(c);
    const branch = children(c).find((c) => c.name === (yes ? "then" : "else"));
    if (branch) this.block(branch, owner);
  }
  source(o: GameObject): number {
    const s = o.v3!.source ? this.object(o.v3!.source) : o;
    const v = v3Value(
      this.p,
      s.id,
      s.kind === "stat" && s.v3 ? o.v3!.entity : undefined,
    );
    if (typeof v !== "number" || s.kind === "entity")
      this.fail("INVALID_TYPE", "Mechanic source must be numeric.");
    return v as number;
  }
  sections(o: GameObject, value = this.source(o)) {
    return o.v3!.rules.flatMap((c, i) => {
      if (c.name !== "section") return [];
      const r = this.range(attrs(c).range);
      return (r.left ? value >= r.min : value > r.min) &&
        (r.right ? value <= r.max : value < r.max)
        ? [i]
        : [];
    });
  }
  mechanic(o: GameObject, force = false, value?: number) {
    if (
      o.v3!.source &&
      this.object(o.v3!.source).kind === "stat" &&
      this.object(o.v3!.entity).v3?.active === false
    )
      return;
    const active = this.sections(o, value),
      old = o.v3!.sections;
    o.v3!.sections = active;
    for (const index of active)
      if (force || o.v3!.trigger === "on-turn" || !old.includes(index))
        this.block(o.v3!.rules[index], o.id);
    for (const c of o.v3!.rules.filter((c) => c.name === "condition"))
      this.condition(c, o.id);
  }
  drain() {
    while (this.changed.length) {
      const event = this.changed.shift()!,
        id = event.id;
      if (++this.steps > 1000)
        this.fail("EVENT_LOOP_LIMIT", "The rule cascade exceeded 1000 events.");
      for (const o of this.p.objects.filter(
        (o) =>
          o.kind === "mechanic" &&
          o.v3?.trigger === "on-change" &&
          (o.v3.source || o.id) === id &&
          (!event.entity || o.v3.entity === event.entity),
      ))
        this.mechanic(
          this.object(o.id),
          false,
          typeof event.value === "number" ? event.value : undefined,
        );
    }
  }
  roll() {
    const x =
      (this.p.random.seed + Math.imul(++this.p.random.counter, 0x6d2b79f5)) | 0;
    if (this.randomOverride) {
      const n = this.randomOverride();
      if (!Number.isFinite(n) || n < 0 || n >= 1)
        this.fail(
          "INVALID_TYPE",
          "Random source must return a number in [0,1).",
        );
      return n * 100;
    }
    let t = Math.imul(x ^ (x >>> 15), x | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 100;
  }
  encounter(o: GameObject, manual = false) {
    if (!o.v3!.enabled) {
      if (manual) this.fail("INVALID_ATTRIBUTE", "This encounter is disabled.");
      return;
    }
    const rules = o.v3!.rules,
      requirements = rules.filter(
        (c) => c.name === "condition" && attrs(c).role === "requirement",
      );
    if (!requirements.every((c) => this.test(c))) {
      this.log(`Encounter ${o.id}: requirement not met; no roll.`);
      return;
    }
    for (const c of rules.filter(
      (c) => c.name === "condition" && attrs(c).role !== "requirement",
    ))
      this.condition(c, o.id);
    const roll = this.roll(),
      chance = Number(this.object(o.id).value),
      success = roll < chance;
    this.log(
      `Encounter ${o.id}: roll ${roll.toFixed(3)} / ${chance}; ${success ? "success" : "fail"}.`,
    );
    if (success && o.v3!.resetOnSuccess) {
      this.object(o.id).value = o.baseChance ?? 0;
      this.changed.push({ id: o.id, value: this.object(o.id).value });
    }
    for (const c of rules.filter(
      (c) => c.name === (success ? "check-success" : "check-fail"),
    ))
      this.block(c, o.id);
    this.drain();
  }
  log(message: string) {
    this.p.log = [...this.p.log, { id: uid(), at: Date.now(), message }].slice(
      -200,
    );
  }
  enqueue(
    request: NonNullable<GameExecution["generation"]> & { pageId: string },
  ) {
    const last = this.additional.at(-1) ?? this.generation;
    if (last && last.pageId === request.pageId) {
      last.instruction = [last.instruction, request.instruction]
        .filter(Boolean)
        .join("\n");
      return;
    }
    if (this.additional.length >= 7)
      this.fail(
        "INVALID_ATTRIBUTE",
        "An action is limited to eight AI target requests.",
      );
    if (!this.generation) this.generation = request;
    else this.additional.push(request);
  }
  turn() {
    this.p.turn++;
    this.drain();
    if (
      legacyTurn &&
      (this.p.rules.length ||
        this.p.objects.some((o) => o.kind === "encounter" && !o.v3))
    ) {
      const before = this.p,
        legacy = legacyTurn(this.p, this.randomOverride);
      this.p = legacy.project;
      for (const o of this.p.objects)
        if (
          typeof o.value === "number" &&
          o.value !== before.objects.find((old) => old.id === o.id)?.value
        )
          this.changed.push({ id: o.id, value: o.value });
      if (legacy.generation)
        this.enqueue({
          ...legacy.generation,
          pageId: legacy.generation.pageId ?? this.p.activePageId,
        });
      this.destruction ||= !!legacy.requiresConfirmation;
      this.drain();
    }
    for (const o of this.p.objects.filter(
      (o) => o.kind === "mechanic" && o.v3?.trigger === "on-turn",
    )) {
      this.mechanic(this.object(o.id), true);
      this.drain();
    }
    for (const o of this.p.objects.filter(
      (o) => o.kind === "encounter" && o.v3?.trigger === "turn",
    ))
      this.encounter(this.object(o.id));
    this.drain();
  }
  modify(a: Record<string, string>) {
    const o = this.object(a.id);
    this.write(o);
    if (
      (a.value !== undefined && a["value-ref"] !== undefined) ||
      (a.value === undefined && a["value-ref"] === undefined)
    )
      this.fail("INVALID_ATTRIBUTE", "Use exactly one of value or value-ref.");
    let operand: unknown = a.value;
    if (a["value-ref"]) {
      const ref = a["value-ref"].split(".");
      const target = this.object(ref.length === 1 ? ref[0] : ref[1]);
      operand = v3Value(
        this.p,
        target.id,
        ref.length === 2 && ref[0] !== "var" ? ref[0] : undefined,
      );
    }
    const explicit = a.op,
      op =
        explicit ??
        (typeof operand === "string" &&
        !["string", "boolean", "enum", "list", "object"].includes(o.type) &&
        /^[+-]/.test(operand)
          ? operand[0] === "+"
            ? "add"
            : "sub"
          : "set");
    if (!explicit && op !== "set") operand = (operand as string).slice(1);
    if (!["set", "add", "sub", "mul", "div"].includes(op))
      this.fail("INVALID_ATTRIBUTE", "Unknown modify operator.");
    const stat = o.kind === "stat" && !!o.v3;
    if (a.entity && !stat)
      this.fail("INVALID_ATTRIBUTE", "entity requires a V3 stat.");
    const before = stat
      ? a.entity
        ? v3Value(this.p, o.id, a.entity)
        : o.default
      : o.value;
    let value: unknown = operand;
    if (op !== "set") {
      if (typeof before !== "number")
        this.fail("INVALID_TYPE", "Arithmetic requires numbers.");
      const n =
        typeof operand === "number" ? operand : this.number(String(operand));
      if (op === "div" && n === 0)
        this.fail("DIVISION_BY_ZERO", "Cannot divide by zero.");
      value =
        op === "add"
          ? (before as number) + n
          : op === "sub"
            ? (before as number) - n
            : op === "mul"
              ? (before as number) * n
              : (before as number) / n;
    }
    const result = this.checked(o, value);
    if (stat) {
      if (a.entity) this.p.vhtml3!.bindings[o.id][a.entity] = result as number;
      else {
        o.default = result;
        o.value = result;
      }
    } else o.value = result;
    if (before !== result && (!stat || a.entity))
      this.changed.push({ id: o.id, entity: a.entity, value: result });
  }
  choice(c: VCommand) {
    const a = attrs(c),
      registry = this.p.vhtml3!.templates;
    if (!a.id) this.fail("INVALID_ATTRIBUTE", "choice requires id.");
    const previous = registry[a.id];
    if (this.p.objects.some((o) => o.id === a.id))
      this.fail("DUPLICATE_ID", "Choice ID collides with an object.");
    if (!previous) {
      if (!(a.label || a.name))
        this.fail("INVALID_ATTRIBUTE", "New choices need a label.");
      registry[a.id] = this.mark(c);
    }
    const base = registry[a.id],
      merged = { ...attrs(base), ...a },
      result = children(c).length ? children(c) : children(base);
    const order = this.number(merged["add-as"]);
    if (!Number.isInteger(order) || order < 0)
      this.fail("INVALID_ATTRIBUTE", "add-as must be a nonnegative integer.");
    if (!order) return;
    const pressed = merged.pressed ?? "remove",
      transform = result.find((n) => n.name === "transform");
    if (pressed === "transform" && !transform)
      this.fail(
        "INVALID_ATTRIBUTE",
        "pressed=transform needs a transform block.",
      );
    const id = `${a.id}.${this.p.activePageId}`;
    const option: GameOption = {
      id,
      name: merged.label ?? merged.name ?? a.id,
      description: "",
      pageId: this.p.activePageId,
      order,
      group: merged.group ?? "",
      once: false,
      used: false,
      resolved: false,
      owner: base.authoredBy ?? this.trust,
      result: result.filter((n) => n.name === "then").map((n) => this.mark(n)),
      conditions: [],
      disabledIf: [],
      v3: {
        templateId: a.id,
        remaining: Number(merged.count ?? 1),
        pressed: pressed as "remove" | "stay" | "transform",
        ...(transform ? { transform: this.mark(transform) } : {}),
      },
    };
    this.p.options = [...this.p.options.filter((o) => o.id !== id), option];
  }
  ui(a: Record<string, string>) {
    const type = a.type ?? "counter",
      scope = (a.scope ?? "global") as "global" | "page";
    if (!["global", "page"].includes(scope))
      this.fail("INVALID_ATTRIBUTE", "UI scope must be global or page.");
    if (
      a.position &&
      !["sidebar", "page-top", "page-bottom", "inline"].includes(a.position)
    )
      this.fail("INVALID_ATTRIBUTE", "Unsupported UI position.");
    if (a.drawer && !["left", "right"].includes(a.drawer))
      this.fail("INVALID_ATTRIBUTE", "Unsupported drawer side.");
    if (type === "panel") {
      const id = a.id;
      if (!id) this.fail("INVALID_ATTRIBUTE", "Panel requires id.");
      this.p.panels = [
        ...this.p.panels.filter((p) => p.id !== id),
        {
          id,
          name: a.label ?? id,
          ui: scope,
          ...(scope === "page" ? { pageId: this.p.activePageId } : {}),
          drawer: a.drawer === "left" ? "left" : "right",
          position: a.position === "page-bottom" ? "page-bottom" : "page-top",
          visible: this.bool(a.visible, true),
          owner: this.trust,
        },
      ];
      return;
    }
    const o = this.object(a.target ?? a.id);
    if (
      ["stat-bar", "progress-bar", "meter"].includes(type) &&
      typeof v3Value(
        this.p,
        o.id,
        o.kind === "stat" && o.v3 ? (a.entity ?? "player") : undefined,
      ) !== "number"
    )
      this.fail("INVALID_TYPE", "Bars and meters require numeric values.");
    if (
      ![
        "counter",
        "text",
        "badge",
        "stat-bar",
        "progress-bar",
        "meter",
        "entity-card",
      ].includes(type)
    )
      this.fail("INVALID_ATTRIBUTE", "Unsupported widget type.");
    if (
      type === "entity-card"
        ? o.kind !== "entity"
        : o.kind === "stat" &&
          !!o.v3 &&
          !this.p.vhtml3!.bindings[o.id]?.[a.entity ?? "player"] &&
          this.p.vhtml3!.bindings[o.id]?.[a.entity ?? "player"] !== 0
    ) {
      if (type === "entity-card")
        this.fail("INVALID_TYPE", "entity-card requires an entity.");
      v3Value(this.p, o.id, a.entity);
    }
    if (
      a.panel &&
      !this.p.panels.some(
        (p) =>
          p.id === a.panel &&
          p.ui === scope &&
          (scope !== "page" || p.pageId === this.p.activePageId),
      )
    )
      this.fail("UNKNOWN_ID", "Panel must exist in the same UI scope.");
    const id = a["widget-id"] ?? `${type}-${o.id}-${a.entity ?? "global"}`;
    this.p.widgets = [
      ...this.p.widgets.filter((w) => w.id !== id),
      {
        id,
        binding: o.id,
        entity: o.kind === "stat" && o.v3 ? (a.entity ?? "player") : undefined,
        label: a.label ?? o.name,
        style: type as "counter",
        ui: scope,
        ...(scope === "page" ? { pageId: this.p.activePageId } : {}),
        panel: a.panel,
        position: ["page-bottom", "inline"].includes(a.position)
          ? (a.position as "inline")
          : "page-top",
        visible: this.bool(a.visible, true),
        removeOn: "never",
        createdTurn: this.p.turn,
        owner: this.trust,
      },
    ];
  }
  run(commands: VCommand[]) {
    for (const c of commands) {
      if (++this.steps > 1000)
        this.fail(
          "EVENT_LOOP_LIMIT",
          "Action exceeded the command/event budget.",
        );
      const savedTrust = this.trust;
      if (c.authoredBy) this.trust = c.authoredBy;
      const a = attrs(c);
      try {
        switch (c.name) {
          case "vhtml":
            this.run(children(c));
            break;
          case "add":
            this.add(a);
            break;
          case "configure": {
            const o = this.object(a.id);
            this.write(o, true);
            this.configure(o, a, children(c));
            break;
          }
          case "modify":
            this.modify(a);
            break;
          case "choice":
            this.choice(c);
            break;
          case "then":
          case "else":
            this.block(c, "action");
            break;
          case "condition":
            this.validateRule(c);
            break;
          case "page": {
            if (a["go-to"] && a.mode === "next")
              this.fail(
                "INVALID_ATTRIBUTE",
                "go-to cannot be combined with next.",
              );
            const previous = this.p.activePageId;
            if (a["go-to"]) {
              if (!this.p.pages.some((p) => p.id === a["go-to"]))
                this.fail("PAGE_NOT_FOUND", "Unknown page.");
              this.p.activePageId = a["go-to"];
            } else if (a.mode === "next") {
              const id = a["page-id"] ?? uid();
              if (this.p.pages.some((p) => p.id === id))
                this.fail("DUPLICATE_ID", "Page already exists; use go-to.");
              this.p.pages.push({
                id,
                title: a.title ?? `Page ${this.p.pages.length + 1}`,
                text: "",
                summary: "",
                persistent: true,
                created: Date.now(),
                parent: previous,
              });
              this.p.activePageId = id;
            } else if (a.mode && a.mode !== "append")
              this.fail(
                "INVALID_ATTRIBUTE",
                "Page mode must be append or next.",
              );
            if (previous !== this.p.activePageId)
              this.p.navigation.push(previous);
            break;
          }
          case "ai": {
            if (a.mode && !["continue", "react", "describe"].includes(a.mode))
              this.fail("INVALID_ATTRIBUTE", "Unsupported AI mode.");
            this.enqueue({
              id: uid(),
              instruction: a.instruction ?? "",
              mode: (a.mode ?? "continue") as "continue",
              pageId: this.p.activePageId,
            });
            break;
          }
          case "ui":
            this.ui(a);
            break;
          case "check": {
            const o = this.object(a.id);
            this.write(o);
            if (o.kind !== "encounter" || !o.v3 || o.v3.trigger !== "manual")
              this.fail("INVALID_TYPE", "check requires a manual encounter.");
            this.encounter(o, true);
            break;
          }
          case "random": {
            const o = this.object(a["save-to"]);
            this.write(o);
            if (
              o.kind !== "variable" ||
              !["integer", "number"].includes(o.type)
            )
              this.fail("INVALID_TYPE", "random requires a numeric variable.");
            const min = this.number(a.min),
              max = this.number(a.max);
            if (
              min > max ||
              (a.norm && !["integer", "decimal"].includes(a.norm))
            )
              this.fail("INVALID_RANGE", "Invalid random range/norm.");
            const integer =
              (a.norm ?? (o.type === "integer" ? "integer" : "decimal")) ===
              "integer";
            if (integer && (!Number.isInteger(min) || !Number.isInteger(max)))
              this.fail("INVALID_TYPE", "Integer random needs integer bounds.");
            o.value = this.checked(
              o,
              integer
                ? min + Math.floor((this.roll() / 100) * (max - min + 1))
                : min + (this.roll() / 100) * (max - min),
            );
            this.changed.push({ id: o.id, value: o.value });
            break;
          }
          case "remove": {
            if (this.trust === "ai")
              this.fail(
                "PERMISSION_DENIED",
                "Object removal must be authored by the user.",
              );
            this.destruction = !this.options.confirmed;
            if (a.type && !["ui", "choice", "object"].includes(a.type))
              this.fail(
                "INVALID_ATTRIBUTE",
                "remove type must be ui, choice or object.",
              );
            if (a.type === "choice") {
              if (!this.p.vhtml3!.templates[a.id])
                this.fail("UNKNOWN_ID", "Choice reference is unavailable.");
              this.p.options = this.p.options.filter(
                (o) =>
                  !(
                    o.v3?.templateId === a.id &&
                    o.pageId === this.p.activePageId
                  ),
              );
              break;
            }
            if (a.type === "ui") {
              if (!this.p.widgets.some((w) => w.id === a.id))
                this.fail("UNKNOWN_ID", "Widget reference is unavailable.");
              this.p.widgets = this.p.widgets.filter((w) => w.id !== a.id);
              break;
            }
            const o = this.object(a.id);
            if (o.id === "player")
              this.fail("PERMISSION_DENIED", "Player cannot be removed.");
            if (
              this.p.objects.some(
                (x) =>
                  x.v3?.source === o.id ||
                  (x.v3?.entity === o.id && x.v3.source),
              )
            )
              this.fail(
                "INVALID_ATTRIBUTE",
                "Remove dependent mechanics first.",
              );
            const refers = (c: VCommand): boolean => {
              const a = attrs(c);
              return (
                (c.name !== "remove" &&
                  (a.id === o.id ||
                    a.entity === o.id ||
                    a.source === o.id ||
                    a["value-ref"] === o.id ||
                    a["value-ref"]?.startsWith(o.id + ".") ||
                    a["value-ref"]?.endsWith("." + o.id))) ||
                children(c).some(refers)
              );
            };
            if (
              this.p.objects.some(
                (x) => x.id !== o.id && x.v3?.rules.some(refers),
              ) ||
              Object.values(this.p.vhtml3!.templates).some(refers)
            )
              this.fail(
                "INVALID_ATTRIBUTE",
                "Update dependent rules/choices first, or deactivate the entity instead of deleting it.",
              );
            this.p.objects = this.p.objects.filter((x) => x.id !== o.id);
            this.p.widgets = this.p.widgets.filter(
              (w) => w.binding !== o.id && w.entity !== o.id,
            );
            delete this.p.vhtml3!.bindings[o.id];
            for (const map of Object.values(this.p.vhtml3!.bindings))
              delete map[o.id];
            break;
          }
          case "text":
            if (this.trust === "ai")
              this.fail("PERMISSION_DENIED", "AI prose belongs in narrative.");
            else {
              const page = this.p.pages.find(
                (p) => p.id === this.p.activePageId,
              )!;
              if (a.mode === "replace") {
                this.destruction = !this.options.confirmed;
                page.text = a.content ?? "";
              } else if (!a.mode || a.mode === "append")
                page.text += a.content ?? "";
              else
                this.fail(
                  "INVALID_ATTRIBUTE",
                  "Text mode must be append or replace.",
                );
            }
            break;
          case "config": {
            if (this.trust === "ai")
              this.fail("PERMISSION_DENIED", "AI cannot change settings.");
            const keys: Record<string, string> = {
              approval: "approval",
              profile: "profile",
              "output-tokens": "maxOutputTokens",
              "max-context-tokens": "maxContextTokens",
              thinking: "thinking",
              "thinking-level": "thinkingLevel",
              "thinking-output-tokens": "thinkingMaxTokens",
              "choice-new-page": "choiceNewPage",
              "generation-new-page": "generationNewPage",
            };
            for (const [key, value] of Object.entries(a)) {
              const field = keys[key],
                before = this.p.settings[field as keyof typeof this.p.settings];
              Object.assign(this.p.settings, {
                [field]:
                  typeof before === "boolean" || key.endsWith("-new-page")
                    ? this.bool(value)
                    : typeof before === "number"
                      ? this.number(value)
                      : value,
              });
            }
            break;
          }
          default:
            this.fail("UNKNOWN_COMMAND", `Unsupported executable <${c.name}>.`);
        }
      } catch (error) {
        if (error instanceof VHTMLError) throw error;
        const message =
          error instanceof Error ? error.message : "Invalid V-HTML action.";
        throw new VHTMLError([
          {
            code:
              /^[A-Z_]+:/.exec(message)?.[0].slice(0, -1) ?? "RUNTIME_ERROR",
            message,
            span: c.span,
          },
        ]);
      } finally {
        this.trust = savedTrust;
      }
    }
  }
}
export function executeV3(
  p: GameProject,
  commands: VCommand[],
  options: GameExecutionOptions = {},
  action?: {
    choice?: string;
    turn?: boolean;
    minutes?: number;
    random?: () => number;
  },
): GameExecution {
  validateV3(commands);
  const e = new Engine(p, options, action?.random);
  if (action?.minutes !== undefined) {
    if (
      !Number.isInteger(action.minutes) ||
      action.minutes < 0 ||
      action.minutes > 10080
    )
      throw new Error("Invalid elapsed minutes.");
    e.p.elapsedMinutes += action.minutes;
  }
  if (action?.choice) {
    const selected = e.p.options.find((o) => o.id === action.choice);
    if (
      !selected?.v3 ||
      selected.pageId !== p.activePageId ||
      selected.v3.remaining <= 0 ||
      selected.resolved ||
      p.actionLock
    )
      throw new Error("CHOICE_UNAVAILABLE: Choice is inactive.");
    e.run(selected.result);
    const o = e.p.options.find((o) => o.id === action.choice);
    if (o?.v3) {
      o.v3.remaining--;
      o.used = o.v3.remaining === 0;
      // An explicit group closes alternatives. Ungrouped repeatable controls stay independent.
      if (o.group)
        for (const sibling of e.p.options.filter(
          (s) => s.pageId === o.pageId && s.group === o.group && s.id !== o.id,
        ))
          sibling.resolved = true;
      if (!o.v3.remaining && o.v3.pressed === "transform") {
        o.resolved = true;
        const t = o.v3.transform!;
        if (
          e.p.vhtml3!.templates[attrs(t).id] ||
          e.p.objects.some((x) => x.id === attrs(t).id)
        )
          throw new Error(
            "DUPLICATE_ID: Transform needs a new global choice ID.",
          );
        e.choice({
          ...t,
          name: "choice",
          fields: {
            ...t.fields,
            "add-as": t.fields["add-as"] ?? [String(o.order)],
          },
        });
      } else if (!o.v3.remaining && o.v3.pressed === "remove")
        o.resolved = true;
    }
    e.turn();
  } else {
    e.run(commands);
    if (action?.turn) e.turn();
    else e.drain();
  }
  const diff = commitGame(p, e.p, options);
  if (action?.choice && e.generation)
    e.p.actionLock = { optionId: action.choice, requestId: e.generation.id };
  return {
    project: e.p,
    generation: e.generation,
    generations: e.generation ? [e.generation, ...e.additional] : [],
    diff,
    warnings: [],
    requiresConfirmation: e.destruction,
  };
}
export function v3Turn(p: GameProject, minutes = 0, random?: () => number) {
  return executeV3(
    p,
    [],
    { label: "Player turn" },
    { turn: true, minutes, random },
  );
}
export function triggerV3Mechanic(p: GameProject, id: string): GameExecution {
  const e = new Engine(p, {}),
    object = e.object(id);
  if (object.kind !== "mechanic" || object.v3?.trigger !== "manual")
    throw new Error("A manual mechanic is required.");
  e.mechanic(object, true);
  e.drain();
  return {
    project: e.p,
    diff: commitGame(p, e.p, { label: "Run manual mechanic" }),
    generation: e.generation,
    generations: e.generation ? [e.generation, ...e.additional] : [],
    requiresConfirmation: e.destruction,
    warnings: [],
  };
}
export function validV3State(p: GameProject): boolean {
  const data = p.vhtml3;
  if (!data)
    return !p.objects.some((o) => o.v3) && !p.options.some((o) => o.v3);
  if (
    !safeGameData(data) ||
    JSON.stringify(data).length > 2000000 ||
    data.version !== "3.0" ||
    !data.bindings ||
    !data.templates ||
    !data.usage
  )
    return false;
  if (!p.objects.some((o) => o.id === "player" && o.kind === "entity"))
    return false;
  for (const [id, map] of Object.entries(data.bindings)) {
    const stat = p.objects.find(
      (o) => o.id === id && o.kind === "stat" && o.v3,
    );
    if (!stat || !map || typeof map !== "object" || Array.isArray(map))
      return false;
    for (const [entity, value] of Object.entries(map))
      if (
        !p.objects.some((o) => o.id === entity && o.kind === "entity") ||
        !Number.isInteger(value) ||
        value < (stat.min ?? -Infinity) ||
        value > (stat.max ?? Infinity)
      )
        return false;
  }
  for (const [id, node] of Object.entries(data.templates)) {
    if (
      !validID(id) ||
      attrs(node).id !== id ||
      node.name !== "choice" ||
      p.objects.some((o) => o.id === id)
    )
      return false;
    validateV3([node]);
  }
  if (
    !Object.values(data.usage).every(
      (a) =>
        Array.isArray(a) &&
        a.length <= 10000 &&
        a.every((n) => Number.isSafeInteger(n) && n >= 0 && n <= p.turn),
    )
  )
    return false;
  for (const o of p.objects.filter((o) => o.v3)) {
    const m = o.v3!;
    if (
      !safeGameData(m) ||
      ![m.active, m.autoLink, m.enabled, m.resetOnSuccess, m.runOnInit].every(
        (v) => typeof v === "boolean",
      ) ||
      !Array.isArray(m.tags) ||
      !m.tags.every((t) => typeof t === "string") ||
      !Array.isArray(m.sections) ||
      !m.sections.every((n) => Number.isSafeInteger(n) && n >= 0) ||
      typeof m.source !== "string" ||
      typeof m.entity !== "string" ||
      typeof m.trigger !== "string"
    )
      return false;
    validateV3(m.rules);
    if (
      m.rules.length > 500 ||
      !m.sections.every(
        (i) => i < m.rules.length && m.rules[i].name === "section",
      )
    )
      return false;
    if (o.kind === "stat" && !data.bindings[o.id]) return false;
    if (
      m.source &&
      !p.objects.some(
        (s) =>
          s.id === m.source &&
          ["stat", "variable", "mechanic"].includes(s.kind),
      )
    )
      return false;
  }
  for (const o of p.options.filter((o) => o.v3)) {
    validateV3(o.result);
    if (o.v3!.transform) validateV3([o.v3!.transform]);
    if (
      !data.templates[o.v3!.templateId] ||
      !Number.isInteger(o.v3!.remaining) ||
      o.v3!.remaining < 0 ||
      !["remove", "stay", "transform"].includes(o.v3!.pressed)
    )
      return false;
    if (o.v3!.pressed === "transform" && !o.v3!.transform) return false;
  }
  for (const w of p.widgets) {
    const o = p.objects.find((o) => o.id === w.binding);
    if (w.style === "entity-card" && o?.kind !== "entity") return false;
    if (
      w.entity &&
      (o?.kind !== "stat" || data.bindings[o.id]?.[w.entity] === undefined)
    )
      return false;
  }
  return true;
}
export function exportV3(p: GameProject): string {
  const nodes: string[] = ['<vhtml version="3.0">'];
  const objects = p.objects.filter((o) => o.v3);
  if (p.objects.some((o) => !o.v3))
    nodes.push(
      "<!-- Legacy definitions remain in the full JSON checkpoint. This XML export contains V3 definitions only. -->",
    );
  for (const o of objects) {
    if (o.id !== "player")
      nodes.push(
        `<add type="${o.kind}" id="${o.id}" name="${escapeXML(o.name)}"${o.kind === "encounter" ? ` base-chance="${o.baseChance ?? 0}"` : o.kind !== "entity" ? ` norm="${o.type === "number" ? "decimal" : o.type}"${o.min === undefined ? "" : ` min="${o.min}"`}${o.max === undefined ? "" : ` max="${o.max}"`} default="${escapeXML(o.default)}"` : ""} />`,
      );
  }
  for (const o of [...objects].sort(
    (a, b) =>
      (a.kind === "encounter" ? 3 : a.kind === "mechanic" ? 2 : 0) -
      (b.kind === "encounter" ? 3 : b.kind === "mechanic" ? 2 : 0),
  )) {
    const m = o.v3!;
    if (o.kind === "mechanic")
      nodes.push(
        `<modify id="${o.id}" op="set" value="${escapeXML(o.value)}" />`,
      );
    nodes.push(
      `<configure id="${o.id}" name="${escapeXML(o.name)}" ai-access="${o.aiAccess}" description-ai="${escapeXML(o.descriptionAI)}" description-noai="${escapeXML(o.descriptionNoAI)}"${o.kind === "entity" ? ` active="${m.active}" tags="${escapeXML(m.tags.join(","))}"` : ""}${o.kind === "mechanic" ? ` source="${escapeXML(m.source)}" entity="${m.entity}" trigger="${m.trigger}" run-on-init="false"` : ""}${o.kind === "encounter" ? ` base-chance="${o.baseChance ?? 0}" trigger="${m.trigger}" enabled="${m.enabled}" reset-on-success="${m.resetOnSuccess}"` : ""}>${printXML(m.rules)}</configure>`,
    );
    if (o.kind === "stat") {
      if (m.autoLink) nodes.push(`<configure id="${o.id}" auto-link="true" />`);
      for (const [id, value] of Object.entries(p.vhtml3?.bindings[o.id] ?? {}))
        nodes.push(`<configure id="${o.id}" link="${id}" value="${value}" />`);
      if (m.autoLink)
        for (const e of objects.filter(
          (e) =>
            e.kind === "entity" &&
            p.vhtml3?.bindings[o.id]?.[e.id] === undefined,
        ))
          nodes.push(`<configure id="${o.id}" unlink="${e.id}" />`);
    } else if (o.kind !== "entity" && o.kind !== "mechanic")
      nodes.push(
        `<modify id="${o.id}" op="set" value="${escapeXML(o.value)}" />`,
      );
  }
  for (const c of Object.values(p.vhtml3?.templates ?? {}))
    nodes.push(printXML([c]));
  for (const panel of p.panels)
    nodes.push(
      `<ui type="panel" id="${escapeXML(panel.id)}" label="${escapeXML(panel.name)}" scope="${panel.ui === "page" ? "page" : "global"}" drawer="${panel.drawer}" />`,
    );
  for (const w of p.widgets.filter(
    (w) => p.objects.find((o) => o.id === w.binding)?.v3,
  ))
    nodes.push(
      `<ui type="${w.style}" id="${w.binding}" widget-id="${escapeXML(w.id)}"${w.entity ? ` entity="${w.entity}"` : ""} label="${escapeXML(w.label)}" scope="${w.ui === "page" ? "page" : "global"}"${w.panel ? ` panel="${escapeXML(w.panel)}"` : ""} position="${w.position}" visible="${w.visible}" />`,
    );
  nodes.push("</vhtml>");
  return nodes.join("\n");
}
