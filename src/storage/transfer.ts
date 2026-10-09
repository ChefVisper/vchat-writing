import {
  upgradePromptTemplate,
  upgradeNoteCreativity,
  upgradeContinuationSettings,
  newStory,
  type Story,
  type Lorebook,
} from "../types";
import { packStory, unpackStory } from "./compact";
import { isWriterBlockConfig } from "../presets/writersBlock";
import { validLoreEntry, validLorebook } from "../lore/import";
export function exportProject(s: Story, books?: Lorebook[]) {
  s = upgradeNoteCreativity(s);
  return JSON.stringify({
    format: "margin-project",
    version: 2,
    ...packStory({
      ...s,
      ...(books
        ? {
            lorebookCopies: books.filter((b) =>
              s.activeLorebooks?.includes(b.id),
            ),
          }
        : {}),
      noteConnection: s.noteConnection
        ? {
            kind: s.noteConnection.kind,
            url: s.noteConnection.url,
            model: s.noteConnection.model,
          }
        : undefined,
      connection: {
        kind: s.connection.kind,
        url: s.connection.url,
        model: s.connection.model,
      },
    }),
  });
}
export function importProject(raw: string): Story {
  const d = JSON.parse(raw);
  if (d.format !== "margin-project" || ![1, 2].includes(d.version) || !d.story)
    throw new Error("This is not a supported Margin project.");
  const s = d.version === 2 ? unpackStory(d) : d.story;
  const base = newStory();
  if (
    (s.activeLorebooks !== undefined &&
      (!Array.isArray(s.activeLorebooks) ||
        s.activeLorebooks.length > 500 ||
        !s.activeLorebooks.every(
          (id: unknown) => typeof id === "string" && id.length <= 250,
        ) ||
        new Set(s.activeLorebooks).size !== s.activeLorebooks.length)) ||
    (s.lorebookCopies !== undefined &&
      (!Array.isArray(s.lorebookCopies) ||
        s.lorebookCopies.length > 500 ||
        !s.lorebookCopies.every(validLorebook) ||
        new Set(s.lorebookCopies.map((b: Lorebook) => b.id)).size !==
          s.lorebookCopies.length))
  )
    throw new Error("Invalid shared lorebook references or copies.");
  if (
    (s.writingPreset !== undefined &&
      !["default", "writers-block"].includes(s.writingPreset)) ||
    (s.writersBlock !== undefined && !isWriterBlockConfig(s.writersBlock)) ||
    (s.writersBlockTemplate !== undefined &&
      (typeof s.writersBlockTemplate !== "string" ||
        s.writersBlockTemplate.length > 20000))
  )
    throw new Error("Invalid writing preset or Writer's Block configuration.");
  if (
    s.settings?.creativeNotes !== undefined &&
    typeof s.settings.creativeNotes !== "boolean"
  )
    throw new Error("Invalid legacy creative notes setting.");
  if (
    s.characterSource !== undefined &&
    (typeof s.characterSource !== "string" || s.characterSource.length > 1000)
  )
    throw new Error("Invalid character source.");
  if (
    s.greetings !== undefined &&
    (!Array.isArray(s.greetings) ||
      s.greetings.length > 100 ||
      !s.greetings.every(
        (g: any) =>
          g &&
          typeof g.id === "string" &&
          typeof g.title === "string" &&
          g.title.length <= 150 &&
          typeof g.text === "string" &&
          g.text.length <= 100000,
      ) ||
      new Set(s.greetings.map((g: any) => g.id)).size !== s.greetings.length)
  )
    throw new Error("Invalid greetings.");
  if (
    (s.nextInstruction !== undefined &&
      (typeof s.nextInstruction !== "string" ||
        s.nextInstruction.length > 5000)) ||
    (s.keepInstruction !== undefined && typeof s.keepInstruction !== "boolean")
  )
    throw new Error("Invalid next instruction.");
  s.settings = { ...base.settings, ...s.settings };
  delete s.settings.inputTokens;
  if (s.promptTemplate !== undefined && typeof s.promptTemplate !== "string")
    throw new Error("Invalid prompt template.");
  for (const k of ["title", "text", "lastUpdateText"])
    if (typeof s[k] !== "string") throw new Error("Invalid project text.");
  for (const k of ["notes", "lore", "segments", "snapshots", "past", "future"])
    if (!Array.isArray(s[k])) throw new Error("Invalid project collection.");
  if (
    !s.memory ||
    !s.author ||
    typeof s.memory.content !== "string" ||
    typeof s.author.content !== "string"
  )
    throw new Error("Invalid memory.");
  if (
    !["kobold", "openai", "horde", "openrouter", "nanogpt"].includes(
      s.connection?.kind,
    ) ||
    typeof s.connection.url !== "string" ||
    typeof s.connection.model !== "string"
  )
    throw new Error("Invalid provider.");
  for (const k of Object.keys(base.settings)) {
    if (
      typeof s.settings?.[k] !== typeof (base.settings as any)[k] ||
      (typeof s.settings[k] === "number" && !Number.isFinite(s.settings[k]))
    )
      throw new Error("Invalid generation settings.");
  }
  if (
    s.settings.context <= 0 ||
    s.settings.maxTokens <= 0 ||
    s.settings.noteMaxTokens <= 0
  )
    throw new Error("Invalid token limits.");
  if (
    s.notePromptTemplate !== undefined &&
    typeof s.notePromptTemplate !== "string"
  )
    throw new Error("Invalid note prompt.");
  if (
    s.noteConnectionMode !== undefined &&
    !["same", "model", "separate"].includes(s.noteConnectionMode)
  )
    throw new Error("Invalid note connection mode.");
  if (
    s.noteConnection &&
    (!["kobold", "openai", "horde", "openrouter", "nanogpt"].includes(
      s.noteConnection.kind,
    ) ||
      typeof s.noteConnection.url !== "string" ||
      typeof s.noteConnection.model !== "string")
  )
    throw new Error("Invalid note connection.");
  if (
    ![s.settings.thinkingLevel, s.settings.noteThinkingLevel].every((value) =>
      ["minimal", "low", "medium", "high"].includes(value),
    )
  )
    throw new Error("Invalid thinking level.");
  if (
    s.settings.thinkingMaxTokens < 0 ||
    s.settings.noteThinkingMaxTokens < 0 ||
    s.settings.thinkingMaxTokens > 131072 ||
    s.settings.noteThinkingMaxTokens > 131072 ||
    !s.settings.thinkingPrefix.trim() ||
    !s.settings.thinkingSuffix.trim() ||
    s.settings.thinkingPrefix === s.settings.thinkingSuffix ||
    s.settings.thinkingPrefix.length > 128 ||
    s.settings.thinkingSuffix.length > 128
  )
    throw new Error("Invalid thinking limits or delimiters.");
  if (
    s.thoughts !== undefined &&
    (!Array.isArray(s.thoughts) ||
      !s.thoughts.every(
        (t: any) =>
          t &&
          typeof t.id === "string" &&
          Number.isFinite(t.at) &&
          typeof t.text === "string" &&
          typeof t.model === "string" &&
          ["kobold", "openai", "horde", "openrouter", "nanogpt"].includes(
            t.provider,
          ) &&
          ["writing", "notes", "rewrite", "create"].includes(t.purpose) &&
          typeof t.selected === "boolean",
      ))
  )
    throw new Error("Invalid thinking history.");
  for (const n of s.notes) {
    if (
      typeof n.id !== "string" ||
      typeof n.title !== "string" ||
      typeof n.content !== "string" ||
      typeof n.keywords !== "string" ||
      !Array.isArray(n.revisions) ||
      !["off", "auto", "review"].includes(n.mode)
    )
      throw new Error("Invalid note.");
  }
  for (const l of s.lore) {
    if (!validLoreEntry(l)) throw new Error("Invalid lore entry.");
    if (
      typeof l.content !== "string" ||
      typeof l.keywords !== "string" ||
      typeof l.secondary !== "string" ||
      typeof l.title !== "string" ||
      !Number.isFinite(l.scanDepth)
    )
      throw new Error("Invalid lore entry.");
  }
  const text = (v: unknown) => typeof v === "string";
  const finite = (v: unknown) => typeof v === "number" && Number.isFinite(v);
  const position = (v: unknown) => v === "before" || v === "after";
  const validNotes = (notes: any): boolean =>
    Array.isArray(notes) &&
    notes.every(
      (n: any) =>
        n &&
        ["id", "title", "content", "keywords"].every((k) => text(n[k])) &&
        ["enabled", "include", "aiEditable", "locked"].every(
          (k) => typeof n[k] === "boolean",
        ) &&
        (n.creative === undefined || typeof n.creative === "boolean") &&
        position(n.position) &&
        ["off", "auto", "review"].includes(n.mode) &&
        Array.isArray(n.revisions) &&
        n.revisions.every(
          (r: any) =>
            r &&
            text(r.id) &&
            text(r.content) &&
            text(r.source) &&
            finite(r.at),
        ),
    ) &&
    new Set(notes.map((n: any) => n.id)).size === notes.length;
  if (
    !validNotes(s.notes) ||
    !finite(s.loreBudget) ||
    s.loreBudget < 0 ||
    !s.past.every(text) ||
    !s.future.every(text) ||
    ![s.memory, s.author].every(
      (m) =>
        typeof m.enabled === "boolean" &&
        position(m.position) &&
        finite(m.depth) &&
        m.depth >= 0,
    ) ||
    !s.lore.every(
      (l: any) =>
        text(l.id) &&
        ["enabled", "constant", "caseSensitive"].every(
          (k) => typeof l[k] === "boolean",
        ) &&
        ["priority", "scanDepth", "budget", "probability"].every((k) =>
          finite(l[k]),
        ) &&
        l.scanDepth >= 0 &&
        l.budget >= 0 &&
        l.probability >= 0 &&
        l.probability <= 100,
    ) ||
    !s.segments.every(
      (x: any) =>
        x &&
        text(x.id) &&
        text(x.before) &&
        text(x.after) &&
        finite(x.at) &&
        (x.instruction === undefined ||
          (text(x.instruction) && x.instruction.length <= 5000)) &&
        (!x.notesBefore || validNotes(x.notesBefore)) &&
        (!x.notesAfter || validNotes(x.notesAfter)),
    ) ||
    !s.snapshots.every(
      (x: any) =>
        x &&
        text(x.id) &&
        text(x.title) &&
        text(x.text) &&
        finite(x.at) &&
        validNotes(x.notes),
    ) ||
    (s.pending !== undefined &&
      (!Array.isArray(s.pending) ||
        !s.pending.every(
          (x: any) =>
            x &&
            text(x.noteId) &&
            text(x.oldContent) &&
            text(x.newContent) &&
            s.notes.some((n: any) => n.id === x.noteId),
        )))
  )
    throw new Error(
      "Invalid project history or context data. Nothing was imported.",
    );
  return upgradeContinuationSettings(
    upgradeNoteCreativity({
      ...base,
      ...s,
      continuationCleanupVersion: s.continuationCleanupVersion,
      writingPreset: s.writingPreset ?? "default",
      noteConnection: s.noteConnection
        ? {
            kind: s.noteConnection.kind,
            url: s.noteConnection.url,
            model: s.noteConnection.model,
          }
        : undefined,
      promptTemplate: upgradePromptTemplate(s.promptTemplate),
      connection: {
        kind: s.connection.kind,
        url: s.connection.url,
        model: s.connection.model,
      },
    }),
  );
}
export function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
