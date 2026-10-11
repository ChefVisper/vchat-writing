import { uid } from "../types";
import type { GameChange, GameExecutionOptions, GameProject } from "./types";

export function createGameProject(text = ""): GameProject {
  if (typeof text !== "string" || text.length > 2000000)
    throw new Error(
      "Initial game prose must be text of at most 2,000,000 characters.",
    );
  const id = uid(),
    pageId = uid();
  return {
    version: 1,
    id,
    pages: [
      {
        id: pageId,
        title: "Page 1",
        text,
        summary: "",
        persistent: true,
        created: Date.now(),
      },
    ],
    activePageId: pageId,
    navigation: [],
    objects: [],
    widgets: [],
    panels: [],
    options: [],
    instructions: [],
    events: [],
    rules: [],
    proposals: [],
    settings: {
      maxOutputTokens: 2048,
      thinking: false,
      thinkingLevel: "low",
      thinkingMaxTokens: 2048,
      approval: "manual",
      profile: "balanced",
      maxContextTokens: 8192,
      maxHistoryPages: 10,
      reserveTokens: 1024,
      summary: "manual",
      globalDrawerOpen: false,
    },
    history: [],
    future: [],
    log: [],
    random: { seed: 1, counter: 0 },
    turn: 0,
    elapsedMinutes: 0,
  };
}
const forbidden = new Set(["__proto__", "prototype", "constructor"]);
const historyRoots = new Set([
  "pages",
  "activePageId",
  "navigation",
  "objects",
  "widgets",
  "panels",
  "options",
  "instructions",
  "events",
  "rules",
  "settings",
  "random",
  "turn",
  "elapsedMinutes",
]);
export function safeGameData(value: unknown, depth = 0): boolean {
  if (depth > 32) return false;
  if (value === undefined || value === null || typeof value === "boolean")
    return true;
  if (typeof value === "string") return value.length <= 2000000;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value))
    return (
      value.length <= 10000 && value.every((x) => safeGameData(x, depth + 1))
    );
  return (
    !!value &&
    typeof value === "object" &&
    Object.keys(value).length <= 10000 &&
    Object.entries(value).every(
      ([k, v]) => !forbidden.has(k) && safeGameData(v, depth + 1),
    )
  );
}
const copy = <T>(v: T): T => (v === undefined ? v : structuredClone(v));
export function gameDiff(
  before: unknown,
  after: unknown,
  path: (string | number)[] = [],
): GameChange[] {
  if (Object.is(before, after)) return [];
  if (
    typeof before === "string" &&
    typeof after === "string" &&
    before.length + after.length > 200
  ) {
    let keep = 0,
      tail = 0;
    while (
      keep < before.length &&
      keep < after.length &&
      before[keep] === after[keep]
    )
      keep++;
    while (
      tail < before.length - keep &&
      tail < after.length - keep &&
      before[before.length - tail - 1] === after[after.length - tail - 1]
    )
      tail++;
    return [
      {
        path,
        text: {
          keep,
          tail,
          before: before.slice(keep, before.length - tail),
          after: after.slice(keep, after.length - tail),
        },
      },
    ];
  }
  if (
    before &&
    after &&
    typeof before === "object" &&
    typeof after === "object" &&
    Array.isArray(before) === Array.isArray(after)
  ) {
    if (Array.isArray(before) && Array.isArray(after)) {
      const result: GameChange[] = [];
      for (let i = 0; i < Math.min(before.length, after.length); i++)
        result.push(...gameDiff(before[i], after[i], [...path, i]));
      for (let i = before.length - 1; i >= after.length; i--)
        result.push({ path: [...path, i], before: copy(before[i]) });
      for (let i = before.length; i < after.length; i++)
        result.push({ path: [...path, i], after: copy(after[i]) });
      return result;
    }
    const a = before as Record<string, unknown>,
      b = after as Record<string, unknown>;
    return [...new Set([...Object.keys(a), ...Object.keys(b)])]
      .filter((k) => !forbidden.has(k))
      .flatMap((k) => gameDiff(a[k], b[k], [...path, k]));
  }
  return [
    {
      path,
      ...(before === undefined ? {} : { before: copy(before) }),
      ...(after === undefined ? {} : { after: copy(after) }),
    },
  ];
}
const core = (project: GameProject) => {
  const {
    history: _history,
    future: _future,
    log: _log,
    proposals: _proposals,
    actionLock: _lock,
    ...data
  } = project;
  return data;
};
export function commitGame(
  before: GameProject,
  after: GameProject,
  options: GameExecutionOptions = {},
) {
  const diff = gameDiff(core(before), core(after));
  if (diff.length && options.recordHistory !== false) {
    after.history = [
      ...before.history,
      {
        id: uid(),
        at: Date.now(),
        label: options.label || "V-HTML action",
        origin: options.origin || "user",
        changes: diff,
      },
    ].slice(-100);
    after.future = [];
    after.log = [
      ...after.log,
      {
        id: uid(),
        at: Date.now(),
        message: options.label || "V-HTML action applied",
      },
    ].slice(-200);
  }
  if (!validateGameProject(after))
    throw new Error(
      "Game history or project exceeds the supported storage limits.",
    );
  return diff;
}
function applyChanges(
  project: GameProject,
  changes: GameChange[],
  reverse: boolean,
) {
  const next = structuredClone(project);
  for (const change of reverse ? [...changes].reverse() : changes) {
    if (
      !change.path.length ||
      change.path.some((p) => typeof p === "string" && forbidden.has(p))
    )
      throw new Error("Invalid game history path.");
    let parent: any = next;
    for (const part of change.path.slice(0, -1)) {
      if (!parent || typeof parent !== "object")
        throw new Error("Game history no longer matches state.");
      parent = parent[part];
    }
    const key = change.path.at(-1)!;
    if (change.text) {
      const value = parent[key];
      if (typeof value !== "string")
        throw new Error("Invalid game text history.");
      parent[key] =
        value.slice(0, change.text.keep) +
        change.text[reverse ? "before" : "after"] +
        (change.text.tail ? value.slice(-change.text.tail) : "");
    } else {
      const value = change[reverse ? "before" : "after"];
      if (value === undefined) {
        if (Array.isArray(parent)) parent.splice(key as number, 1);
        else delete parent[key];
      } else if (Array.isArray(parent) && !(key in parent))
        parent.splice(key as number, 0, copy(value));
      else parent[key] = copy(value);
    }
  }
  delete next.actionLock;
  if (!validateGameProject(next))
    throw new Error(
      "Game history would restore an invalid project. Nothing was changed.",
    );
  return next;
}
export function undoGame(project: GameProject) {
  if (project.actionLock)
    throw new Error("Finish or stop the current game action before Undo.");
  const revision = project.history.at(-1);
  if (!revision) return project;
  const next = applyChanges(project, revision.changes, true);
  next.history = project.history.slice(0, -1);
  next.proposals = next.proposals.map((q) =>
    revision.proposalIds?.includes(q.id) ? { ...q, status: "pending" } : q,
  );
  next.future = [revision, ...project.future].slice(0, 100);
  next.log = [
    ...project.log,
    { id: uid(), at: Date.now(), message: "Undo: " + revision.label },
  ].slice(-200);
  return next;
}
export function redoGame(project: GameProject) {
  if (project.actionLock)
    throw new Error("Finish or stop the current game action before Redo.");
  const revision = project.future[0];
  if (!revision) return project;
  const next = applyChanges(project, revision.changes, false);
  next.future = project.future.slice(1);
  next.proposals = next.proposals.map((q) =>
    revision.proposalIds?.includes(q.id) ? { ...q, status: "approved" } : q,
  );
  next.history = [...project.history, revision].slice(-100);
  next.log = [
    ...project.log,
    { id: uid(), at: Date.now(), message: "Redo: " + revision.label },
  ].slice(-200);
  return next;
}
export function finishGameAction(project: GameProject) {
  const next = { ...project };
  delete next.actionLock;
  return next;
}

export function validateGameProject(value: unknown): value is GameProject {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const p = value as GameProject;
  const string = (v: unknown, max = 1000) =>
    typeof v === "string" && v.length <= max;
  const id = (v: unknown) => string(v, 250) && !!v;
  const finite = (v: unknown) => typeof v === "number" && Number.isFinite(v);
  const list = (v: unknown, max: number) => Array.isArray(v) && v.length <= max;
  const unique = (v: { id: string }[]) =>
    v.every((x) => x && id(x.id)) &&
    new Set(v.map((x) => x.id)).size === v.length;
  const owner = (v: unknown) => v === "user" || v === "ai";
  const validChange = (c: GameChange) =>
    c &&
    Array.isArray(c.path) &&
    c.path.length > 0 &&
    c.path.length <= 30 &&
    historyRoots.has(String(c.path[0])) &&
    c.path.every((v) =>
      typeof v === "string"
        ? v.length <= 250 && !forbidden.has(v)
        : Number.isSafeInteger(v) && v >= 0 && v <= 10000,
    ) &&
    [c.before, c.after].every(
      (v) =>
        safeGameData(v) &&
        (v === undefined || JSON.stringify(v).length <= 2100000),
    ) &&
    (c.text === undefined ||
      (Number.isSafeInteger(c.text.keep) &&
        c.text.keep >= 0 &&
        c.text.keep <= 2000000 &&
        Number.isSafeInteger(c.text.tail) &&
        c.text.tail >= 0 &&
        c.text.tail <= 2000000 &&
        string(c.text.before, 2000000) &&
        string(c.text.after, 2000000)));
  const scoped = (v: { ui: string; pageId?: string; eventId?: string }) =>
    v.ui === "page"
      ? p.pages.some((a) => a.id === v.pageId)
      : v.ui === "event"
        ? p.events.some((e) => e.id === v.eventId)
        : true;
  const commands = (v: unknown) => {
    let count = 0;
    const walk = (a: unknown, depth: number): boolean => {
      if (depth > 16 || !a || typeof a !== "object" || Array.isArray(a))
        return false;
      const c = a as any;
      if (
        !string(c.name, 50) ||
        !c.fields ||
        typeof c.fields !== "object" ||
        Array.isArray(c.fields) ||
        !Array.isArray(c.positional) ||
        ++count > 500
      )
        return false;
      const val = (x: any): boolean =>
        (typeof x === "string" && x.length <= 100000) ||
        typeof x === "boolean" ||
        finite(x) ||
        (x &&
          x.kind === "range" &&
          finite(x.min) &&
          finite(x.max) &&
          x.min < x.max &&
          typeof x.includeMax === "boolean") ||
        walk(x, depth + 1);
      return (
        Object.entries(c.fields).every(
          ([key, values]) =>
            !forbidden.has(key) &&
            Array.isArray(values) &&
            values.length <= 500 &&
            values.every(val),
        ) && c.positional.every(val)
      );
    };
    return Array.isArray(v) && v.length <= 500 && v.every((c) => walk(c, 0));
  };
  try {
    if (
      p.version !== 1 ||
      !id(p.id) ||
      !list(p.pages, 2000) ||
      !p.pages.length ||
      !unique(p.pages) ||
      !p.pages.every(
        (x) =>
          string(x.title, 500) &&
          string(x.text, 2000000) &&
          string(x.summary, 20000) &&
          typeof x.persistent === "boolean" &&
          finite(x.created),
      ) ||
      !p.pages.some((x) => x.id === p.activePageId) ||
      !Array.isArray(p.navigation) ||
      p.navigation.length > 2000 ||
      !p.navigation.every((x) => p.pages.some((a) => a.id === x))
    )
      return false;
    for (const [name, max] of [
      ["objects", 2000],
      ["widgets", 2000],
      ["panels", 1000],
      ["options", 2000],
      ["instructions", 1000],
      ["events", 2000],
      ["rules", 500],
      ["proposals", 500],
    ] as const)
      if (!list(p[name], max) || !unique(p[name])) return false;
    if (
      !p.objects.every(
        (o) =>
          string(o.name, 500) &&
          string(o.kind, 50) &&
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
          ].includes(o.type) &&
          owner(o.owner) &&
          ["none", "read", "modify"].includes(o.aiAccess) &&
          string(o.description, 10000) &&
          string(o.descriptionAI, 10000) &&
          string(o.descriptionNoAI, 10000) &&
          string(o.scope, 50) &&
          typeof o.persistent === "boolean" &&
          safeGameData(o.value) &&
          safeGameData(o.default) &&
          (o.min === undefined || finite(o.min)) &&
          (o.max === undefined || finite(o.max)) &&
          (o.min === undefined || o.max === undefined || o.min <= o.max) &&
          (o.choices === undefined ||
            (list(o.choices, 100) &&
              o.choices.every((x) => string(x, 1000)) &&
              new Set(o.choices).size === o.choices.length)) &&
          [o.value, o.default].every((v) =>
            ["number", "integer", "percentage", "value"].includes(o.type)
              ? finite(v) &&
                (o.type !== "integer" || Number.isInteger(v)) &&
                (o.min === undefined || (v as number) >= o.min) &&
                (o.max === undefined || (v as number) <= o.max) &&
                (o.type !== "percentage" ||
                  ((v as number) >= 0 && (v as number) <= 100))
              : o.type === "boolean"
                ? typeof v === "boolean"
                : o.type === "string"
                  ? string(v, 20000)
                  : o.type === "enum"
                    ? string(v, 1000) && !!o.choices?.includes(v as string)
                    : o.type === "list"
                      ? Array.isArray(v) && JSON.stringify(v).length <= 20000
                      : !!v &&
                        typeof v === "object" &&
                        !Array.isArray(v) &&
                        JSON.stringify(v).length <= 20000,
          ) &&
          (o.baseChance === undefined ||
            (finite(o.baseChance) &&
              o.baseChance >= 0 &&
              o.baseChance <= 100)) &&
          (o.cooldown === undefined ||
            (finite(o.cooldown) && o.cooldown >= 0)) &&
          (o.lastTriggered === undefined ||
            (finite(o.lastTriggered) && o.lastTriggered >= 0)) &&
          (o.sections === undefined ||
            (list(o.sections, 100) &&
              o.sections.every(
                (s) =>
                  finite(s.min) &&
                  finite(s.max) &&
                  s.min < s.max &&
                  typeof s.includeMax === "boolean" &&
                  commands(s.result),
              ))) &&
          (o.conditions === undefined || commands(o.conditions)) &&
          (o.onTrigger === undefined || commands(o.onTrigger)) &&
          (o.onTriggerOwner === undefined || owner(o.onTriggerOwner)),
      )
    )
      return false;
    if (
      !p.widgets.every(
        (w) =>
          p.objects.some((o) => o.id === w.binding) &&
          ["global", "page", "event"].includes(w.ui) &&
          ["counter", "progress-bar", "text", "badge"].includes(w.style) &&
          ["page-top", "page-bottom", "inline"].includes(w.position) &&
          ["never", "page-exit", "event-end"].includes(w.removeOn) &&
          typeof w.visible === "boolean" &&
          owner(w.owner) &&
          string(w.label, 500) &&
          finite(w.createdTurn) &&
          w.createdTurn >= 0 &&
          scoped(w) &&
          (w.panel === undefined || p.panels.some((a) => a.id === w.panel)) &&
          (w.expiresAfter === undefined ||
            (Number.isSafeInteger(w.expiresAfter) && w.expiresAfter > 0)),
      )
    )
      return false;
    if (
      !p.panels.every(
        (a) =>
          string(a.name, 500) &&
          ["global", "page", "event"].includes(a.ui) &&
          ["left", "right"].includes(a.drawer) &&
          ["page-top", "page-bottom", "inline"].includes(a.position) &&
          typeof a.visible === "boolean" &&
          owner(a.owner) &&
          scoped(a),
      )
    )
      return false;
    if (
      !p.options.every(
        (o) =>
          string(o.name, 500) &&
          string(o.description, 5000) &&
          string(o.group, 250) &&
          p.pages.some((a) => a.id === o.pageId) &&
          finite(o.order) &&
          typeof o.once === "boolean" &&
          typeof o.used === "boolean" &&
          owner(o.owner) &&
          commands(o.result) &&
          commands(o.conditions) &&
          commands(o.disabledIf),
      )
    )
      return false;
    if (
      !p.instructions.every(
        (i) =>
          string(i.content, 20000) &&
          ["global", "scene", "entity", "event"].includes(i.scope) &&
          typeof i.enabled === "boolean" &&
          finite(i.priority) &&
          owner(i.owner) &&
          (i.scope !== "scene" || p.pages.some((a) => a.id === i.pageId)) &&
          (!["entity", "event"].includes(i.scope) ||
            p.objects.some((o) => o.id === i.target)),
      ) ||
      !p.events.every(
        (e) =>
          p.objects.some(
            (o) =>
              o.id === e.objectId && ["event", "encounter"].includes(o.kind),
          ) && typeof e.active === "boolean",
      ) ||
      !p.rules.every(
        (r) =>
          string(r.hook, 100) &&
          commands(r.result) &&
          commands(r.conditions) &&
          owner(r.owner) &&
          (r.every === undefined ||
            (Number.isSafeInteger(r.every) && r.every > 0)),
      )
    )
      return false;
    const s = p.settings;
    if (
      !s ||
      !Number.isInteger(s.maxOutputTokens) ||
      s.maxOutputTokens < 64 ||
      s.maxOutputTokens > 131072 ||
      typeof s.thinking !== "boolean" ||
      !["minimal", "low", "medium", "high"].includes(s.thinkingLevel) ||
      !Number.isInteger(s.thinkingMaxTokens) ||
      s.thinkingMaxTokens < 0 ||
      s.thinkingMaxTokens > 131072 ||
      !["manual", "smart", "auto"].includes(s.approval) ||
      !["novel", "balanced", "interactive", "designer"].includes(s.profile) ||
      !Number.isInteger(s.maxContextTokens) ||
      s.maxContextTokens < 512 ||
      s.maxContextTokens > 131072 ||
      !Number.isInteger(s.maxHistoryPages) ||
      s.maxHistoryPages < 0 ||
      s.maxHistoryPages > 2000 ||
      !Number.isInteger(s.reserveTokens) ||
      s.reserveTokens < 0 ||
      s.reserveTokens >= s.maxContextTokens ||
      !["manual", "disabled"].includes(s.summary) ||
      typeof s.globalDrawerOpen !== "boolean"
    )
      return false;
    if (
      !p.random ||
      !Number.isSafeInteger(p.random.seed) ||
      !Number.isSafeInteger(p.random.counter) ||
      p.random.counter < 0 ||
      !Number.isSafeInteger(p.turn) ||
      p.turn < 0 ||
      !finite(p.elapsedMinutes) ||
      p.elapsedMinutes < 0
    )
      return false;
    if (
      !list(p.history, 100) ||
      !list(p.future, 100) ||
      !list(p.log, 200) ||
      !p.history
        .concat(p.future)
        .every(
          (h) =>
            id(h.id) &&
            finite(h.at) &&
            string(h.label, 1000) &&
            ["user", "ai", "option"].includes(h.origin) &&
            list(h.changes, 10000) &&
            h.changes.every(validChange) &&
            (h.proposalIds === undefined ||
              (list(h.proposalIds, 50) && h.proposalIds.every(id))),
        )
    )
      return false;
    if (
      !p.proposals.every(
        (q) =>
          string(q.source, 100000) &&
          string(q.reason, 5000) &&
          Array.isArray(q.dependencies) &&
          q.dependencies.length <= 50 &&
          q.dependencies.every((d) => id(d)) &&
          ["pending", "approved", "rejected", "failed"].includes(q.status) &&
          finite(q.created) &&
          (q.error === undefined || string(q.error, 10000)) &&
          list(q.changes, 10000) &&
          q.changes.every(validChange),
      ) ||
      !p.log.every((l) => id(l.id) && finite(l.at) && string(l.message, 5000))
    )
      return false;
    if (
      p.actionLock &&
      (!id(p.actionLock.optionId) || !id(p.actionLock.requestId))
    )
      return false;
    return JSON.stringify(p).length <= 40 * 1024 * 1024;
  } catch {
    return false;
  }
}
