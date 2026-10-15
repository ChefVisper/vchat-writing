import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { Compartment, EditorState } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  keymap,
  MatchDecorator,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import { standardKeymap } from "@codemirror/commands";
import {
  Columns2,
  Play,
  Settings2,
  Square,
  Undo2,
  Redo2,
  X,
} from "lucide-react";
import { uid, type Story } from "../types";
import { providers } from "../providers";
import { credentialId } from "../storage/credentials";
import { download } from "../storage/transfer";
import { Field } from "./Fields";
import { ManuscriptEditor, type ManuscriptHandle } from "./ManuscriptEditor";
import { ThinkingPanel } from "./ThinkingPanel";
import { VHTMLComposer, VHTMLSuggestions } from "./VHTMLComposer";
import { vhtmlCompletions, type VHTMLCompletion } from "../vgame/completion";
import guide from "../../docs/vhtml-guide-tr.txt?raw";
import type {
  GameChange,
  GameGeneration,
  GameProject,
  GameWidget,
} from "../vgame/types";
import { useStore } from "../store";
import { gameDiff, commitGame } from "../vgame/state";
import {
  parseVHTML,
  printVHTML,
  VHTMLError,
  VHTML_LIMITS,
  type VDiagnostic,
} from "../vgame/parser";
import {
  createGameProject,
  executeVHTML,
  executeOption,
  finishGameAction,
  undoGame,
  redoGame,
  generateVHTML,
  visibleGameWidgets,
  visibleGamePanels,
  optionEnabled,
  acceptGameProposal,
  rejectGameProposal,
  editGameProposal,
  validateGameProject,
  replaceGamePageText,
  editGamePageText,
  appendGameText,
  executeGameHook,
} from "../vgame/runtime";
import { buildGamePrompt, generateGame, gameProviderLimit } from "../vgame/ai";
import "./vgame.css";

const quote = (value: unknown) => JSON.stringify(value);
const displayValue = (value: unknown) =>
  typeof value === "string" ? value : JSON.stringify(value);
const tabs = [
  "Story",
  "Pages",
  "World",
  "UI",
  "V-HTML",
  "Inbox",
  "Instructions",
  "Context",
  "History",
  "Thinking",
] as const;
type Tab = (typeof tabs)[number];
type Execute = (
  source: string,
  label?: string,
  definitionMode?: boolean,
) => boolean;

function Toggle({
  label,
  value,
  onChange,
  disabled = false,
}: {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="toggle">
      <span>{label}</span>
      <input
        type="checkbox"
        checked={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
    </label>
  );
}

function useCanonicalDraft<T extends object>(value: T, identity: string) {
  const version = JSON.stringify(value);
  const [draft, setDraft] = useState(value);
  const base = useRef({ identity, version, draftVersion: version });
  const dirty = JSON.stringify(draft) !== base.current.draftVersion;
  const stale =
    base.current.identity === identity &&
    base.current.version !== version &&
    dirty;
  useEffect(() => {
    if (base.current.identity !== identity || !dirty) {
      setDraft(value);
      base.current = { identity, version, draftVersion: version };
    }
  }, [identity, version]);
  const reload = () => {
    setDraft(value);
    base.current = { identity, version, draftVersion: version };
  };
  const saved = () => {
    base.current.draftVersion = JSON.stringify(draft);
  };
  return { draft, setDraft, stale, reload, saved };
}

function DraftWarning({
  stale,
  reload,
  busy,
}: {
  stale: boolean;
  reload: () => void;
  busy: boolean;
}) {
  return stale ? (
    <p className="error">
      This definition changed while you were editing.{" "}
      <button disabled={busy} onClick={reload}>
        Reload current definition
      </button>
    </p>
  ) : null;
}

function useDialogFocus(
  ref: RefObject<HTMLElement | null>,
  enabled: boolean,
  close: () => void,
) {
  const latestClose = useRef(close);
  latestClose.current = close;
  useEffect(() => {
    const panel = ref.current;
    if (!enabled || !panel) return;
    const previous = document.activeElement as HTMLElement | null;
    const controls = () =>
      [
        ...panel.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"], [contenteditable="true"]',
        ),
      ].filter((element) => element.offsetParent !== null);
    (controls()[0] ?? panel).focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        latestClose.current();
      }
      if (event.key !== "Tab") return;
      const available = controls();
      const first = available[0],
        last = available.at(-1);
      if (!first) {
        event.preventDefault();
        panel.focus();
      } else if (
        event.shiftKey &&
        (document.activeElement === first ||
          !panel.contains(document.activeElement))
      ) {
        event.preventDefault();
        last?.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last ||
          !panel.contains(document.activeElement))
      ) {
        event.preventDefault();
        first.focus();
      }
    };
    panel.addEventListener("keydown", handleKey);
    return () => {
      panel.removeEventListener("keydown", handleKey);
      if (previous?.isConnected) previous.focus();
    };
  }, [enabled]);
}

function PanelEditor({
  game,
  execute,
  busy,
}: {
  game: GameProject;
  execute: Execute;
  busy: boolean;
}) {
  const [selected, setSelected] = useState("");
  const panel = game.panels.find((item) => item.id === selected);
  const state = useCanonicalDraft(
    {
      id: panel?.id ?? "",
      name: panel?.name ?? "",
      ui: panel?.ui ?? "global",
      eventId: panel?.eventId ?? "",
      drawer: panel?.drawer ?? "right",
      position: panel?.position ?? "page-top",
      visible: panel?.visible ?? true,
    },
    `${game.id}:${selected}`,
  );
  const form = state.draft;
  return (
    <details className="vgame-card">
      <summary>UI panels</summary>
      <DraftWarning stale={state.stale} reload={state.reload} busy={busy} />
      <Field label="UI panel">
        <select
          disabled={busy}
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
        >
          <option value="">New panel</option>
          {game.panels.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name} · {item.ui}
            </option>
          ))}
        </select>
      </Field>
      <div className="vgame-form-grid">
        <Field label="Panel ID">
          <input
            disabled={busy || !!panel}
            value={form.id}
            onChange={(e) => state.setDraft({ ...form, id: e.target.value })}
          />
        </Field>
        <Field label="Panel name">
          <input
            disabled={busy}
            value={form.name}
            onChange={(e) => state.setDraft({ ...form, name: e.target.value })}
          />
        </Field>
        <Field label="Panel scope">
          <select
            disabled={busy}
            value={form.ui}
            onChange={(e) =>
              state.setDraft({ ...form, ui: e.target.value as typeof form.ui })
            }
          >
            {["global", "page", "event"].map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </Field>
        <Field label="Panel drawer">
          <select
            disabled={busy}
            value={form.drawer}
            onChange={(e) =>
              state.setDraft({
                ...form,
                drawer: e.target.value as typeof form.drawer,
              })
            }
          >
            <option>right</option>
            <option>left</option>
          </select>
        </Field>
        <Field label="Panel position">
          <select
            disabled={busy}
            value={form.position}
            onChange={(e) =>
              state.setDraft({
                ...form,
                position: e.target.value as typeof form.position,
              })
            }
          >
            {["page-top", "page-bottom", "inline"].map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </Field>
        <Field label="Panel event">
          <select
            disabled={busy || form.ui !== "event"}
            value={form.eventId}
            onChange={(e) =>
              state.setDraft({ ...form, eventId: e.target.value })
            }
          >
            <option value="">Choose event</option>
            {game.objects
              .filter((item) => ["event", "encounter"].includes(item.kind))
              .map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
          </select>
        </Field>
      </div>
      <Toggle
        label="Panel visible"
        disabled={busy}
        value={form.visible}
        onChange={(visible) => state.setDraft({ ...form, visible })}
      />
      <div className="row">
        <button
          disabled={busy || state.stale || !form.name.trim()}
          onClick={() => {
            const id = selected || form.id.trim() || uid();
            if (
              execute(
                `<panel: id: ${quote(id)} name: ${quote(form.name)} ui: ${form.ui} drawer: ${form.drawer} position: ${form.position} visible: ${form.visible} ${form.ui === "page" ? `page: ${quote(game.activePageId)}` : ""} ${form.ui === "event" ? `event: ${quote(form.eventId)}` : ""}>`,
                "Save UI panel",
                true,
              )
            ) {
              state.saved();
              setSelected(id);
            }
          }}
        >
          Save panel
        </button>
        {panel && (
          <button
            disabled={busy}
            onClick={() =>
              execute(`<remove: panel: ${quote(panel.id)}>`, "Remove UI panel")
            }
          >
            Remove panel
          </button>
        )}
      </div>
      <p className="help">
        Panels group declared views. A panel does not create or change values.
      </p>
    </details>
  );
}

function changeText(changes: GameChange[]) {
  return (
    changes
      .map((change) => {
        const path = change.path.join(".");
        if (change.text)
          return `${path}:\n− ${change.text.before.slice(0, 600)}\n+ ${change.text.after.slice(0, 600)}`;
        const summarize = (value: unknown) =>
          value === undefined
            ? "(removed)"
            : (displayValue(value) ?? "null").slice(0, 700);
        return `${path}\n− ${summarize(change.before)}\n+ ${summarize(change.after)}`;
      })
      .join("\n\n") || "No state changes."
  );
}

function VHTMLInput({
  value,
  onChange,
  disabled,
  diagnostic,
  game,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  diagnostic?: VDiagnostic;
  game: GameProject;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const current = useRef({ value, onChange });
  current.current = { value, onChange };
  const syncing = useRef(false);
  const readOnly = useRef(new Compartment());
  const errorMarker = useRef(new Compartment());
  const [completions, setCompletions] = useState<VHTMLCompletion[]>([]);
  const [selected, setSelected] = useState(0);
  const suggestions = useRef({ completions, selected });
  suggestions.current = { completions, selected };
  const gameRef = useRef(game);
  gameRef.current = game;
  const accept = (item: VHTMLCompletion) => {
    const editor = view.current;
    if (!editor || editor.state.readOnly) return;
    editor.dispatch({
      changes: { from: item.from, to: item.to, insert: item.insert },
      selection: { anchor: item.from + item.insert.length },
    });
    editor.focus();
  };
  useEffect(() => {
    if (!host.current) return;
    const matcher = new MatchDecorator({
      regexp:
        /<[\w-]+:?|"(?:[^"\\]|\\.)*"|\b(?:true|false|global|page|event|number|percentage)\b/g,
      decoration: (match) =>
        Decoration.mark({
          class:
            match[0][0] === "<"
              ? "vgame-syntax-command"
              : match[0][0] === '"'
                ? "vgame-syntax-string"
                : "vgame-syntax-keyword",
        }),
    });
    const coloring = ViewPlugin.fromClass(
      class {
        decorations: DecorationSet;
        constructor(editor: EditorView) {
          this.decorations = matcher.createDeco(editor);
        }
        update(update: ViewUpdate) {
          this.decorations = matcher.updateDeco(update, this.decorations);
        }
      },
      { decorations: (plugin) => plugin.decorations },
    );
    const editor = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: current.current.value,
        extensions: [
          EditorView.lineWrapping,
          coloring,
          keymap.of([
            {
              key: "Mod-Space",
              run: (editor) => {
                setCompletions(
                  vhtmlCompletions(
                    editor.state.doc.toString(),
                    editor.state.selection.main.head,
                    gameRef.current,
                  ),
                );
                return suggestions.current.completions.length > 0;
              },
            },
            {
              key: "Escape",
              run: () => {
                setCompletions([]);
                return true;
              },
            },
            {
              key: "Tab",
              run: () => {
                const item =
                  suggestions.current.completions[suggestions.current.selected];
                if (!item) return false;
                accept(item);
                return true;
              },
            },
            ...(["ArrowDown", "ArrowUp"] as const).map((key) => ({
              key,
              run: () => {
                const menu = suggestions.current;
                if (!menu.completions.length) return false;
                setSelected(
                  (menu.selected +
                    (key === "ArrowDown" ? 1 : menu.completions.length - 1)) %
                    menu.completions.length,
                );
                return true;
              },
            })),
            ...standardKeymap,
          ]),
          readOnly.current.of(EditorState.readOnly.of(disabled)),
          errorMarker.current.of([]),
          EditorView.contentAttributes.of({
            "aria-label": "V-HTML source",
            "aria-multiline": "true",
            spellcheck: "false",
          }),
          EditorView.domEventHandlers({
            blur: () => {
              setCompletions([]);
              return false;
            },
          }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged && !syncing.current)
              current.current.onChange(update.state.doc.toString());
            if (
              (update.docChanged || update.selectionSet) &&
              !syncing.current
            ) {
              setCompletions(
                vhtmlCompletions(
                  update.state.doc.toString(),
                  update.state.selection.main.head,
                  gameRef.current,
                ),
              );
              setSelected(0);
            }
          }),
        ],
      }),
    });
    view.current = editor;
    return () => {
      editor.destroy();
      view.current = null;
    };
  }, []);
  useEffect(() => {
    const editor = view.current;
    if (!editor || editor.state.doc.toString() === value) return;
    syncing.current = true;
    editor.dispatch({
      changes: { from: 0, to: editor.state.doc.length, insert: value },
    });
    syncing.current = false;
    setCompletions([]);
  }, [value]);
  useEffect(() => {
    view.current?.dispatch({
      effects: readOnly.current.reconfigure(EditorState.readOnly.of(disabled)),
    });
  }, [disabled]);
  useEffect(() => {
    const editor = view.current;
    if (!editor) return;
    const from = Math.min(editor.state.doc.length, diagnostic?.span.start ?? 0);
    const to = Math.min(
      editor.state.doc.length,
      Math.max(from + 1, diagnostic?.span.end ?? from),
    );
    const marks =
      diagnostic && to > from
        ? Decoration.set([
            Decoration.mark({
              class: "vgame-syntax-error",
              attributes: { title: diagnostic.message },
            }).range(from, to),
          ])
        : Decoration.none;
    editor.dispatch({
      effects: errorMarker.current.reconfigure(
        EditorView.decorations.of(marks),
      ),
    });
  }, [diagnostic, value]);
  return (
    <>
      <div className="vgame-syntax" ref={host} />
      <VHTMLSuggestions
        items={disabled ? [] : completions}
        selected={selected}
        onChoose={accept}
        name="V-HTML command completions"
        getAnchor={() => {
          const editor = view.current;
          if (!editor?.hasFocus) return null;
          const rect = editor.coordsAtPos(editor.state.selection.main.head);
          return rect
            ? { left: rect.left, top: rect.top, bottom: rect.bottom }
            : null;
        }}
        getOwner={() => host.current}
        onSelect={setSelected}
        onDismiss={() => setCompletions([])}
      />
      <p className="help">
        Type &lt; for suggestions, then Tab or tap to insert. Parser errors show
        their line and column.
      </p>
    </>
  );
}

function Widget({ widget, game }: { widget: GameWidget; game: GameProject }) {
  const object = game.objects.find((item) => item.id === widget.binding);
  if (!object) return null;
  const progress = typeof object.value === "number" ? object.value : undefined;
  const min = object.min ?? 0,
    max = object.max ?? 100;
  return (
    <div
      className={`vgame-widget vgame-widget-${widget.style}`}
      data-widget-id={widget.id}
    >
      <div className="vgame-widget-name">{widget.label || object.name}</div>
      <div className="vgame-widget-value">{displayValue(object.value)}</div>
      {widget.style === "progress-bar" && progress !== undefined && (
        <progress
          aria-label={widget.label || object.name}
          value={progress - min}
          max={Math.max(1, max - min)}
        />
      )}
    </div>
  );
}

function WorldEditor({
  game,
  execute,
  busy,
}: {
  game: GameProject;
  execute: Execute;
  busy: boolean;
}) {
  const [selected, setSelected] = useState("");
  const blank = {
    id: "",
    name: "",
    kind: "stat",
    type: "number",
    value: "0",
    default: "0",
    min: "",
    max: "",
    choices: "",
    description: "",
    descriptionAI: "",
    descriptionNoAI: "",
    scope: "player",
    aiAccess: "read",
    persistent: true,
  };
  const object = game.objects.find((item) => item.id === selected);
  const formState = useCanonicalDraft(
    object
      ? {
          ...blank,
          ...object,
          value: displayValue(object.value) ?? "",
          default: displayValue(object.default) ?? "",
          min: object.min === undefined ? "" : String(object.min),
          max: object.max === undefined ? "" : String(object.max),
          choices: object.choices?.join(", ") ?? "",
        }
      : blank,
    `${game.id}:${selected}`,
  );
  const { draft: form, setDraft: setForm } = formState;
  const field = (name: keyof typeof form, value: string | boolean) =>
    setForm({ ...form, [name]: value });
  const literal = (raw: string) =>
    ["number", "integer", "percentage", "value"].includes(form.type)
      ? raw
      : form.type === "boolean"
        ? raw === "true"
          ? "true"
          : "false"
        : quote(raw);
  return (
    <>
      <DraftWarning
        stale={formState.stale}
        reload={formState.reload}
        busy={busy}
      />
      <Field label="World object">
        <select
          value={selected}
          disabled={busy}
          onChange={(event) => setSelected(event.target.value)}
        >
          <option value="">New object</option>
          {game.objects.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name} · {item.kind}
            </option>
          ))}
        </select>
      </Field>
      <div className="vgame-form-grid">
        <Field label="Object ID">
          <input
            disabled={busy || !!object}
            value={form.id}
            onChange={(e) => field("id", e.target.value)}
          />
        </Field>
        <Field label="Object name">
          <input
            disabled={busy}
            value={form.name}
            onChange={(e) => field("name", e.target.value)}
          />
        </Field>
        <Field label="Object kind">
          <select
            disabled={busy || !!object}
            value={form.kind}
            onChange={(e) => field("kind", e.target.value)}
          >
            {[
              "stat",
              "variable",
              "mechanic",
              "event",
              "encounter",
              "thing",
              "entity",
              "location",
              "item",
              "quest",
              "relationship",
            ].map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </Field>
        <Field label="Value type">
          <select
            disabled={busy}
            value={form.type}
            onChange={(e) => field("type", e.target.value)}
          >
            {[
              "number",
              "integer",
              "percentage",
              "value",
              "boolean",
              "string",
              "enum",
              "list",
              "object",
            ].map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </Field>
        <Field label="Default value">
          <input
            disabled={busy}
            value={form.default}
            onChange={(e) => field("default", e.target.value)}
          />
        </Field>
        <Field label="Current value">
          <input
            disabled={busy}
            value={form.value}
            onChange={(e) => field("value", e.target.value)}
          />
        </Field>
        <Field label="Minimum">
          <input
            type="number"
            disabled={busy}
            value={form.min}
            onChange={(e) => field("min", e.target.value)}
          />
        </Field>
        <Field label="Maximum">
          <input
            type="number"
            disabled={busy}
            value={form.max}
            onChange={(e) => field("max", e.target.value)}
          />
        </Field>
        <Field label="Data scope">
          <input
            disabled={busy}
            value={form.scope}
            onChange={(e) => field("scope", e.target.value)}
          />
        </Field>
        <Field label="AI access">
          <select
            disabled={busy}
            value={form.aiAccess}
            onChange={(e) => field("aiAccess", e.target.value)}
          >
            <option value="none">None</option>
            <option value="read">Read</option>
            <option value="modify">Modify</option>
          </select>
        </Field>
      </div>
      {form.type === "enum" && (
        <Field label="Enum choices (comma-separated)">
          <input
            disabled={busy}
            value={form.choices}
            onChange={(e) => field("choices", e.target.value)}
          />
        </Field>
      )}
      <Field label="Description">
        <textarea
          disabled={busy}
          value={form.description}
          onChange={(e) => field("description", e.target.value)}
        />
      </Field>
      <Field label="AI-only description">
        <textarea
          disabled={busy}
          value={form.descriptionAI}
          onChange={(e) => field("descriptionAI", e.target.value)}
        />
      </Field>
      <Field label="Player-only description">
        <textarea
          disabled={busy}
          value={form.descriptionNoAI}
          onChange={(e) => field("descriptionNoAI", e.target.value)}
        />
      </Field>
      <Toggle
        label="Persistent object"
        disabled={busy}
        value={form.persistent}
        onChange={(value) => field("persistent", value)}
      />
      <div className="row">
        <button
          disabled={busy || formState.stale || !form.name.trim()}
          onClick={() => {
            const id = object?.id || form.id.trim() || uid();
            if (
              execute(
                `<define: ${form.kind}: ${quote(id)} id: ${quote(id)} name: ${quote(form.name)} type: ${form.type} default: ${literal(form.default)} ${form.min ? `min: ${form.min}` : ""} ${form.max ? `max: ${form.max}` : ""} ${
                  form.type === "enum"
                    ? `choices: ${form.choices
                        .split(",")
                        .map((item) => quote(item.trim()))
                        .join(" ")}`
                    : ""
                } scope: ${quote(form.scope)} persistent: ${form.persistent} ai-access: ${form.aiAccess} description: ${quote(form.description)} description-ai: ${quote(form.descriptionAI)} description-noai: ${quote(form.descriptionNoAI)}>\n<set: ${form.kind}: ${quote(id)} value: ${literal(form.value)}>`,
                "Save world object",
                true,
              )
            ) {
              formState.saved();
              setSelected(id);
            }
          }}
        >
          Save object
        </button>
        {object && (
          <button
            disabled={busy}
            onClick={() =>
              execute(
                `<remove: ${object.kind}: ${quote(object.id)}>`,
                "Remove world object",
              )
            }
          >
            Remove object
          </button>
        )}
      </div>
      {object && (
        <p className="vgame-meta">
          Created by {object.owner}. Stable ID: {object.id}
        </p>
      )}
      {object?.kind === "event" && (
        <div className="row">
          <button
            disabled={busy}
            onClick={() =>
              execute(
                `<trigger: event: ${quote(object.id)} action: start>`,
                "Start event",
              )
            }
          >
            Start event
          </button>
          <button
            disabled={busy}
            onClick={() =>
              execute(
                `<trigger: event: ${quote(object.id)} action: end>`,
                "End event",
              )
            }
          >
            End event
          </button>
        </div>
      )}
      <details className="vgame-card">
        <summary>Objects ({game.objects.length})</summary>
        {game.objects.map((item) => (
          <button
            className="text-button"
            key={item.id}
            onClick={() => setSelected(item.id)}
          >
            {item.name}: {displayValue(item.value)}
          </button>
        ))}
      </details>
      <p className="help">
        Values, views and lifetimes are separate. No widget is created
        automatically. List/object values use JSON text; advanced conditions and
        encounter rules are edited in V-HTML.
      </p>
    </>
  );
}

function UIEditor({
  game,
  execute,
  busy,
}: {
  game: GameProject;
  execute: Execute;
  busy: boolean;
}) {
  const [scope, setScope] = useState<"global" | "context">("global");
  const [selected, setSelected] = useState("");
  const blank = {
    id: "",
    label: "",
    binding: "",
    style: "counter",
    ui: "global",
    eventId: "",
    panel: "",
    position: "page-top",
    removeOn: "never",
    expiresAfter: "",
    visible: true,
  };
  const widget = game.widgets.find((item) => item.id === selected);
  const formState = useCanonicalDraft(
    widget
      ? {
          ...blank,
          ...widget,
          eventId: widget.eventId ?? "",
          panel: widget.panel ?? "",
          expiresAfter:
            widget.expiresAfter === undefined
              ? ""
              : String(widget.expiresAfter),
        }
      : {
          ...blank,
          ui: scope === "global" ? "global" : "page",
          removeOn: scope === "global" ? "never" : "page-exit",
        },
    `${game.id}:${selected}:${scope}`,
  );
  const { draft: form, setDraft: setForm } = formState;
  const field = (name: keyof typeof form, value: string | boolean) =>
    setForm({ ...form, [name]: value });
  const bound = game.objects.find((item) => item.id === form.binding);
  return (
    <>
      <DraftWarning
        stale={formState.stale}
        reload={formState.reload}
        busy={busy}
      />
      <div className="row">
        <button
          className={scope === "global" ? "primary" : ""}
          onClick={() => {
            setScope("global");
            setSelected("");
          }}
        >
          Global UI
        </button>
        <button
          className={scope === "context" ? "primary" : ""}
          onClick={() => {
            setScope("context");
            setSelected("");
          }}
        >
          Page / Event UI
        </button>
      </div>
      <Field label="UI widget">
        <select
          disabled={busy}
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
        >
          <option value="">New widget</option>
          {game.widgets
            .filter((item) =>
              scope === "global" ? item.ui === "global" : item.ui !== "global",
            )
            .map((item) => (
              <option key={item.id} value={item.id}>
                {item.label || item.id} · {item.ui}
              </option>
            ))}
        </select>
      </Field>
      <div className="vgame-form-grid">
        <Field label="Widget ID">
          <input
            disabled={busy || !!widget}
            value={form.id}
            onChange={(e) => field("id", e.target.value)}
          />
        </Field>
        <Field label="Widget label">
          <input
            disabled={busy}
            value={form.label}
            onChange={(e) => field("label", e.target.value)}
          />
        </Field>
        <Field label="Bound object">
          <select
            disabled={busy}
            value={form.binding}
            onChange={(e) => field("binding", e.target.value)}
          >
            <option value="">Choose value</option>
            {game.objects.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Widget style">
          <select
            disabled={busy}
            value={form.style}
            onChange={(e) => field("style", e.target.value)}
          >
            {["counter", "progress-bar", "text", "badge"].map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </Field>
        <Field label="UI scope">
          <select
            disabled={busy}
            value={form.ui}
            onChange={(e) => field("ui", e.target.value)}
          >
            {["global", "page", "event"].map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </Field>
        <Field label="Widget position">
          <select
            disabled={busy}
            value={form.position}
            onChange={(e) => field("position", e.target.value)}
          >
            {["page-top", "page-bottom", "inline"].map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </Field>
        <Field label="Widget panel">
          <select
            disabled={busy}
            value={form.panel}
            onChange={(e) => field("panel", e.target.value)}
          >
            <option value="">No panel</option>
            {game.panels
              .filter((item) => item.ui === form.ui)
              .map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
          </select>
        </Field>
        <Field label="Remove view on">
          <select
            disabled={busy}
            value={form.removeOn}
            onChange={(e) => field("removeOn", e.target.value)}
          >
            {["never", "page-exit", "event-end"].map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </Field>
        <Field label="Linked event">
          <select
            disabled={busy || form.ui !== "event"}
            value={form.eventId}
            onChange={(e) => field("eventId", e.target.value)}
          >
            <option value="">Choose event</option>
            {game.objects
              .filter(
                (item) => item.kind === "event" || item.kind === "encounter",
              )
              .map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
          </select>
        </Field>
        <Field label="Expires after turns">
          <input
            type="number"
            min="1"
            disabled={busy}
            value={form.expiresAfter}
            onChange={(e) => field("expiresAfter", e.target.value)}
          />
        </Field>
      </div>
      <Toggle
        label="Widget visible"
        disabled={busy}
        value={form.visible}
        onChange={(value) => field("visible", value)}
      />
      <div className="row">
        <button
          disabled={busy || formState.stale || !bound}
          onClick={() => {
            if (!bound) return;
            const id = widget?.id || form.id.trim() || uid();
            if (
              execute(
                `<display: id: ${quote(id)} label: ${quote(form.label)} ${bound.kind}: ${quote(bound.id)} style: ${form.style} ui: ${form.ui} position: ${form.position} ${form.ui === "page" ? `page: ${quote(game.activePageId)}` : ""} ${form.ui === "event" ? `event: ${quote(form.eventId)}` : ""} ${form.panel ? `panel: ${quote(form.panel)}` : ""} remove-on: ${form.removeOn} ${form.expiresAfter ? `expires-after: ${form.expiresAfter}` : ""}>\n<${form.visible ? "show" : "hide"}: ui: ${quote(id)}>`,
                "Save UI widget",
                true,
              )
            ) {
              formState.saved();
              setSelected(id);
            }
          }}
        >
          Save widget
        </button>
        {widget && (
          <button
            disabled={busy}
            onClick={() =>
              execute(`<remove: ui: ${quote(widget.id)}>`, "Remove widget")
            }
          >
            Remove widget
          </button>
        )}
      </div>
      <p className="help">
        Page views belong to the current page. Event views last while their
        linked event is active. Removing a view keeps its bound value.
      </p>
      {widget && (
        <div className="vgame-card">
          <Widget widget={widget} game={game} />
          <p className="vgame-meta">
            {widget.ui} · {widget.pageId || widget.eventId || "all pages"} ·{" "}
            {widget.removeOn} · {widget.owner}
          </p>
        </div>
      )}
      <PanelEditor game={game} execute={execute} busy={busy} />
    </>
  );
}

function InstructionEditor({
  game,
  execute,
  busy,
}: {
  game: GameProject;
  execute: Execute;
  busy: boolean;
}) {
  const [selected, setSelected] = useState("");
  const empty = {
    id: "",
    content: "",
    scope: "global",
    target: "",
    priority: "50",
    enabled: true,
  };
  const instruction = game.instructions.find((item) => item.id === selected);
  const formState = useCanonicalDraft(
    instruction
      ? {
          ...instruction,
          target: instruction.target ?? "",
          priority: String(instruction.priority),
        }
      : empty,
    `${game.id}:${selected}`,
  );
  const { draft: form, setDraft: setForm } = formState;
  return (
    <>
      <DraftWarning
        stale={formState.stale}
        reload={formState.reload}
        busy={busy}
      />
      <Field label="AI instruction">
        <select
          value={selected}
          disabled={busy}
          onChange={(e) => setSelected(e.target.value)}
        >
          <option value="">New instruction</option>
          {game.instructions.map((item) => (
            <option key={item.id} value={item.id}>
              {item.id} · {item.scope}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Instruction ID">
        <input
          disabled={busy || !!selected}
          value={form.id}
          onChange={(e) => setForm({ ...form, id: e.target.value })}
        />
      </Field>
      <div className="vgame-form-grid">
        <Field label="Instruction scope">
          <select
            disabled={busy}
            value={form.scope}
            onChange={(e) => setForm({ ...form, scope: e.target.value })}
          >
            {["global", "scene", "entity", "event"].map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </Field>
        <Field label="Instruction priority">
          <input
            type="number"
            min="0"
            max="100"
            disabled={busy}
            value={form.priority}
            onChange={(e) => setForm({ ...form, priority: e.target.value })}
          />
        </Field>
      </div>
      <Field label="Instruction target">
        <select
          disabled={busy || !["entity", "event"].includes(form.scope)}
          value={form.target}
          onChange={(e) => setForm({ ...form, target: e.target.value })}
        >
          <option value="">Choose target</option>
          {game.objects
            .filter((item) =>
              form.scope === "event"
                ? ["event", "encounter"].includes(item.kind)
                : item.kind === "entity",
            )
            .map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
        </select>
      </Field>
      <Field label="Instruction content">
        <textarea
          disabled={busy}
          maxLength={10000}
          value={form.content}
          onChange={(e) => setForm({ ...form, content: e.target.value })}
        />
      </Field>
      <Toggle
        label="Instruction enabled"
        disabled={busy}
        value={form.enabled}
        onChange={(enabled) => setForm({ ...form, enabled })}
      />
      <div className="row">
        <button
          disabled={busy || formState.stale || !form.content.trim()}
          onClick={() => {
            const id = selected || form.id.trim() || uid();
            if (
              execute(
                `<ai-instruct: id: ${quote(id)} scope: ${form.scope} ${["event", "entity"].includes(form.scope) ? `${form.scope}: ${quote(form.target)}` : ""} ${form.scope === "scene" ? `page: ${quote(game.activePageId)}` : ""} priority: ${form.priority} enabled: ${form.enabled} content: ${quote(form.content)}>`,
                "Save AI instruction",
                true,
              )
            ) {
              formState.saved();
              setSelected(id);
            }
          }}
        >
          Save instruction
        </button>
        {selected && (
          <button
            disabled={busy}
            onClick={() =>
              execute(
                `<remove: instruction: ${quote(selected)}>`,
                "Remove instruction",
              )
            }
          >
            Remove instruction
          </button>
        )}
      </div>
      <p className="help">
        Priority orders author instructions at the same level. It cannot
        override the engine's runtime rules. Scene instructions belong to the
        current page; entity and event directions apply only when relevant.
      </p>
    </>
  );
}

function OptionEditor({
  game,
  execute,
  busy,
}: {
  game: GameProject;
  execute: Execute;
  busy: boolean;
}) {
  const [selected, setSelected] = useState("");
  const empty = {
    id: "",
    name: "",
    description: "",
    order: "1",
    group: "",
    once: true,
    source: "<page: append>\n<ai>",
  };
  const option = game.options.find((item) => item.id === selected);
  const formState = useCanonicalDraft(
    option
      ? {
          ...option,
          order: String(option.order),
          source: printVHTML(option.result),
        }
      : empty,
    `${game.id}:${game.activePageId}:${selected}`,
  );
  const { draft: form, setDraft: setForm } = formState;
  return (
    <details className="vgame-card" open>
      <summary>Page choices</summary>
      <DraftWarning
        stale={formState.stale}
        reload={formState.reload}
        busy={busy}
      />
      <Field label="Page choice">
        <select
          disabled={busy}
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
        >
          <option value="">New choice</option>
          {game.options
            .filter((item) => item.pageId === game.activePageId)
            .map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
        </select>
      </Field>
      <Field label="Choice ID">
        <input
          disabled={busy || !!selected}
          value={form.id}
          onChange={(e) => setForm({ ...form, id: e.target.value })}
        />
      </Field>
      <Field label="Choice text">
        <input
          disabled={busy}
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
      </Field>
      <Field label="Choice description">
        <input
          disabled={busy}
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
        />
      </Field>
      <div className="vgame-form-grid">
        <Field label="Choice order">
          <input
            disabled={busy}
            type="number"
            value={form.order}
            onChange={(e) => setForm({ ...form, order: e.target.value })}
          />
        </Field>
        <Field label="Choice group">
          <input
            disabled={busy}
            value={form.group}
            onChange={(e) => setForm({ ...form, group: e.target.value })}
          />
        </Field>
      </div>
      <Toggle
        label="Use choice once"
        disabled={busy}
        value={form.once}
        onChange={(once) => setForm({ ...form, once })}
      />
      <Field label="Choice action V-HTML">
        <textarea
          disabled={busy}
          value={form.source}
          onChange={(e) => setForm({ ...form, source: e.target.value })}
        />
      </Field>
      <div className="row">
        <button
          disabled={busy || formState.stale || !form.name.trim()}
          onClick={() => {
            const id = selected || form.id.trim() || uid();
            if (
              execute(
                `<option: id: ${quote(id)} name: ${quote(form.name)} description: ${quote(form.description)} add-as: ${form.order} group: ${quote(form.group)} once: ${form.once} page: ${quote(game.activePageId)} result: ${form.source}>`,
                "Save page choice",
                true,
              )
            ) {
              formState.saved();
              setSelected(id);
            }
          }}
        >
          Save choice
        </button>
        {selected && (
          <button
            disabled={busy}
            onClick={() =>
              execute(`<remove: option: ${quote(selected)}>`, "Remove choice")
            }
          >
            Remove choice
          </button>
        )}
      </div>
      <p className="help">
        Page commands change the destination. Only an explicit &lt;ai&gt; calls
        the model; several AI commands in one action become one request.
        Conditions are available in the source editor.
      </p>
    </details>
  );
}

function ProposalCard({
  game,
  id,
  approve,
  reject,
  edit,
  busy,
}: {
  game: GameProject;
  id: string;
  approve: (id: string) => void;
  reject: (id: string) => void;
  edit: (id: string, source: string) => void;
  busy: boolean;
}) {
  const proposal = game.proposals.find((item) => item.id === id)!;
  const [source, setSource] = useState(proposal.source);
  const editable = ["pending", "failed"].includes(proposal.status);
  const blocked = proposal.dependencies.filter(
    (dependency) =>
      !["pending", "approved"].includes(
        game.proposals.find((item) => item.id === dependency)?.status ??
          "missing",
      ),
  );
  return (
    <details className="vgame-card" open={editable}>
      <summary>
        {proposal.reason || proposal.id} · {proposal.status}
      </summary>
      <p className="vgame-meta">
        Proposal {proposal.id} · {new Date(proposal.created).toLocaleString()}
      </p>
      {proposal.dependencies.length > 0 && (
        <p className="help">
          Dependencies: {proposal.dependencies.join(", ")}
          {blocked.length
            ? ` · waiting for ${blocked.join(", ")}`
            : " · pending dependencies will be approved together"}
        </p>
      )}
      <pre className="vgame-diff">{changeText(proposal.changes)}</pre>
      {proposal.error && (
        <p className="error" role="alert">
          {proposal.error}
        </p>
      )}
      <Field label={`Proposal source ${proposal.id}`}>
        <textarea
          disabled={busy || !editable}
          value={source}
          onChange={(e) => setSource(e.target.value)}
        />
      </Field>
      {editable && (
        <div className="row">
          {proposal.status === "pending" && (
            <>
              <button
                disabled={
                  busy || !!blocked.length || source !== proposal.source
                }
                onClick={() => approve(proposal.id)}
              >
                {proposal.dependencies.length
                  ? "Approve proposal bundle"
                  : "Approve proposal"}
              </button>
              <button disabled={busy} onClick={() => reject(proposal.id)}>
                Reject proposal
              </button>
            </>
          )}
          <button
            disabled={busy || source === proposal.source}
            onClick={() => edit(proposal.id, source)}
          >
            Save proposal edit
          </button>
        </div>
      )}
      <p className="help">
        Approval validates the commands against the current game again. A
        pending proposal is not a world fact.
      </p>
    </details>
  );
}

function isDestructive(changes: GameChange[]) {
  return changes.some(
    (change) =>
      ![
        "navigation",
        "activePageId",
        "turn",
        "elapsedMinutes",
        "random",
        "history",
        "future",
        "log",
        "proposals",
        "actionLock",
      ].includes(String(change.path[0])) &&
      ((change.before !== undefined &&
        change.after === undefined &&
        !change.text) ||
        (Array.isArray(change.before) &&
          Array.isArray(change.after) &&
          change.after.length < change.before.length) ||
        (change.text &&
          change.text.before.length > 0 &&
          !change.text.after.startsWith(change.text.before)) ||
        (typeof change.before === "string" &&
          typeof change.after === "string" &&
          change.path.includes("text") &&
          !change.after.startsWith(change.before))),
  );
}

export function GameWorkspace({
  story,
  patch,
  keys,
  onBranch,
  onOpenConnection,
  onBusy,
  openPanel,
  onPanelOpened,
}: {
  story: Story;
  patch: (value: Partial<Story>) => void;
  keys: Record<string, string>;
  onBranch?: (game: GameProject) => void;
  onOpenConnection?: () => void;
  onBusy?: (busy: boolean) => void;
  openPanel?: "history";
  onPanelOpened?: () => void;
}) {
  const initial = useMemo(
    () => story.vgame ?? createGameProject(story.text),
    [story.id],
  );
  const game = story.vgame ?? initial;
  const latest = useRef({ story, game });
  latest.current = { story, game };
  const [tab, setTab] = useState<Tab>("Story");
  const [input, setInput] = useState("");
  const [commandInput, setCommandInput] = useState("");
  const [editReset, setEditReset] = useState(0);
  const [source, setSource] = useState("");
  const [sourceDiagnostic, setSourceDiagnostic] = useState<VDiagnostic>();
  const [definitionMode, setDefinitionMode] = useState(false);
  const [preview, setPreview] = useState<{
    basis: GameProject;
    game: GameProject;
    diff: GameChange[];
    source: string;
  } | null>(null);
  const [pageDraft, setPageDraft] = useState("");
  const [summaryDraft, setSummaryDraft] = useState("");
  const draftBasis = useRef({ pageId: "", text: "", summary: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [thoughts, setThoughts] = useState("");
  const [confirmation, setConfirmation] = useState<{
    label: string;
    diff: GameChange[];
    run: () => void;
  } | null>(null);
  const [historyLimit, setHistoryLimit] = useState(20);
  const [proposalLimit, setProposalLimit] = useState(30);
  const [advanceMinutes, setAdvanceMinutes] = useState(1);
  const [providerContext, setProviderContext] = useState<{
    signature: string;
    limit?: number;
    pending: boolean;
  }>();
  const [mobilePanel, setMobilePanel] = useState(
    () => window.matchMedia("(max-width: 700px)").matches,
  );
  const [drawerDismissed, setDrawerDismissed] = useState(false);
  const lorebooks = useStore((state) => state.lorebooks);
  const controller = useRef<AbortController | null>(null);
  const busyRef = useRef(false);
  const alive = useRef(true);
  const nativeAbort = useRef<Promise<unknown>>(Promise.resolve());
  const editor = useRef<ManuscriptHandle>(null);
  const side = useRef<HTMLElement>(null);
  const confirmDialog = useRef<HTMLElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const sourceFile = useRef<HTMLInputElement>(null);
  const page = game.pages.find((item) => item.id === game.activePageId)!;
  const [wordCount, setWordCount] = useState(0);
  useEffect(() => {
    const timer = setTimeout(
      () =>
        setWordCount(
          page.text.trim() ? page.text.trim().split(/\s+/).length : 0,
        ),
      250,
    );
    return () => clearTimeout(timer);
  }, [page.text]);
  const visible = visibleGameWidgets(game);
  const providerSignature = `${story.connection.kind}:${story.connection.url}:${story.connection.model}:${keys[credentialId(story.connection)] ?? ""}`;
  const drawer =
    game.settings.globalDrawerOpen && !drawerDismissed && tab === "Story";
  const showSide = tab !== "Story" || drawer;
  useEffect(() => {
    const media = window.matchMedia("(max-width: 700px)");
    const update = () => setMobilePanel(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    if (!story.vgame) patch({ vgame: initial });
  }, [story.id]);
  useEffect(() => {
    if (tab !== "V-HTML" || busy) return;
    const timer = window.setTimeout(() => {
      try {
        parseVHTML(source);
        setSourceDiagnostic(undefined);
      } catch (caught) {
        if (caught instanceof VHTMLError)
          setSourceDiagnostic(caught.diagnostics[0]);
      }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [source, tab, busy]);
  useEffect(() => {
    if (tab !== "Context") return;
    const abort = new AbortController();
    setProviderContext({ signature: providerSignature, pending: true });
    void gameProviderLimit(
      story,
      keys[credentialId(story.connection)] ?? "",
      abort.signal,
    )
      .then((limit) => {
        if (!abort.signal.aborted)
          setProviderContext({
            signature: providerSignature,
            limit,
            pending: false,
          });
      })
      .catch(() => {
        if (!abort.signal.aborted)
          setProviderContext({ signature: providerSignature, pending: false });
      });
    return () => abort.abort();
  }, [tab, providerSignature]);
  useEffect(() => {
    setInput("");
    setSource("");
    setPreview(null);
    setConfirmation(null);
    setError("");
    setNotice("");
    setThoughts("");
    setTab("Story");
    setHistoryLimit(20);
    setProposalLimit(30);
  }, [story.id]);
  useEffect(() => {
    if (openPanel === "history") {
      setTab("History");
      onPanelOpened?.();
    }
  }, [openPanel]);
  useEffect(() => {
    const old = draftBasis.current;
    if (old.pageId !== page.id) {
      setPageDraft(page.text);
      setSummaryDraft(page.summary);
      draftBasis.current = {
        pageId: page.id,
        text: page.text,
        summary: page.summary,
      };
    } else {
      if (pageDraft === old.text) {
        setPageDraft(page.text);
        draftBasis.current.text = page.text;
      }
      if (summaryDraft === old.summary) {
        setSummaryDraft(page.summary);
        draftBasis.current.summary = page.summary;
      }
    }
  }, [page.id, page.text, page.summary, game.id]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      controller.current?.abort();
      const s = latest.current.story;
      void providers[s.connection.kind]
        .abort?.(s.connection, keys[credentialId(s.connection)] || "")
        .catch(() => {});
      onBusy?.(false);
    };
  }, []);
  const save = (next: GameProject) => {
    latest.current = { ...latest.current, game: next };
    patch({ vgame: next });
  };
  const fail = (caught: unknown) => {
    if (caught instanceof VHTMLError)
      setSourceDiagnostic(caught.diagnostics[0]);
    setError(
      caught instanceof Error
        ? caught.message
        : "The game action failed. No partial changes were applied.",
    );
  };
  const requestGeneration = async (
    project: GameProject,
    action?: Partial<GameGeneration>,
  ) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    onBusy?.(true);
    setError("");
    setNotice("");
    setThoughts("");
    const basis = project,
      startStory = latest.current.story;
    const c = new AbortController();
    controller.current = c;
    nativeAbort.current = Promise.resolve();
    let reasoning = "";
    try {
      const nextPage =
        !action?.id &&
        project.settings.generationNewPage !== false &&
        !!project.pages.find((p) => p.id === project.activePageId)?.text.trim();
      const generationProject = nextPage
        ? executeVHTML(project, "<page: next>", { recordHistory: false })
            .project
        : project;
      const result = await generateGame(
        generationProject,
        startStory,
        keys,
        action,
        c.signal,
        {
          library: useStore.getState().lorebooks,
          onReasoning: (chunk) => {
            reasoning += chunk;
            if (alive.current) setThoughts(reasoning);
          },
        },
      );
      if (c.signal.aborted) return;
      if (
        !alive.current ||
        latest.current.story.id !== startStory.id ||
        latest.current.game !== basis
      )
        throw new Error(
          "The game changed while the model was working. The response was not applied.",
        );
      if (nextPage) {
        result.project = {
          ...result.project,
          history: basis.history,
          future: basis.future,
          log: basis.log,
        };
        commitGame(basis, result.project, {
          origin: "ai",
          label: "AI passage on new page",
        });
        const revision = result.project.history.at(-1);
        if (revision)
          revision.proposalIds = result.project.proposals
            .filter(
              (q) =>
                q.status === "approved" &&
                !basis.proposals.some(
                  (old) => old.id === q.id && old.status === "approved",
                ),
            )
            .map((q) => q.id);
      }
      save(finishGameAction(result.project));
      setInput("");
      setNotice(
        result.project.proposals.filter((item) => item.status === "pending")
          .length
          ? "Prose added. Proposed changes are in Inbox."
          : "Prose added.",
      );
      requestAnimationFrame(() => editor.current?.scrollToEnd());
    } catch (caught) {
      if (!c.signal.aborted && alive.current) fail(caught);
    } finally {
      await nativeAbort.current;
      if (alive.current && latest.current.story.id === startStory.id) {
        const currentGame = latest.current.game;
        if (currentGame.actionLock) save(finishGameAction(currentGame));
        if (reasoning.trim())
          patch({
            thoughts: [
              ...(latest.current.story.thoughts ?? []),
              {
                id: uid(),
                at: Date.now(),
                model: startStory.connection.model,
                provider: startStory.connection.kind,
                purpose: "game" as const,
                text: reasoning,
                selected: false,
              },
            ].slice(-100),
          });
      }
      if (alive.current) {
        setBusy(false);
        onBusy?.(false);
      }
      busyRef.current = false;
      controller.current = null;
    }
  };
  const stop = () => {
    controller.current?.abort();
    const s = latest.current.story;
    nativeAbort.current =
      providers[s.connection.kind]
        .abort?.(s.connection, keys[credentialId(s.connection)] || "")
        .catch(() => {}) ?? Promise.resolve();
  };
  const commit = (next: GameProject, generation?: GameGeneration) => {
    save(next);
    setPreview(null);
    setError("");
    if (generation) void requestGeneration(next, generation);
  };
  const execute: Execute = (
    script,
    label = "Apply V-HTML",
    definitions = false,
  ) => {
    if (busyRef.current) return false;
    try {
      const base = latest.current.game;
      const result = executeVHTML(base, script, {
        origin: "user",
        confirmed: true,
        definitionMode: definitions,
        label,
      });
      const apply = () => {
        if (latest.current.game !== base) {
          setError("The game changed. Preview this action again.");
          return;
        }
        commit(result.project, result.generation);
        setNotice(result.warnings.join(" ") || label);
      };
      if (result.requiresConfirmation || isDestructive(result.diff)) {
        setConfirmation({ label, diff: result.diff, run: apply });
        return false;
      }
      apply();
      return true;
    } catch (caught) {
      fail(caught);
      return false;
    }
  };
  const updateSetting = (key: string, value: unknown) =>
    execute(
      `<config: ${key}: ${typeof value === "string" ? quote(value) : String(value)}>`,
      "Update game settings",
    );
  const sendInput = (value: string, clear: (value: string) => void) => {
    if (busyRef.current || !value.trim()) return;
    if (value.trimStart().startsWith("<")) {
      if (execute(value, "Send V-HTML")) clear("");
      return;
    }
    try {
      commit(
        appendGameText(latest.current.game, value, {
          origin: "user",
          label: "Send author text",
        }).project,
      );
      clear("");
      requestAnimationFrame(() => editor.current?.scrollToEnd());
    } catch (caught) {
      fail(caught);
    }
  };
  const closeTools = () => {
    setTab("Story");
    if (drawer) {
      if (busyRef.current) setDrawerDismissed(true);
      else updateSetting("global-drawer-open", false);
    }
  };
  useDialogFocus(side, mobilePanel && showSide && !confirmation, closeTools);
  useDialogFocus(confirmDialog, !!confirmation, () => setConfirmation(null));
  const advanceGame = (minutes = 0) => {
    if (busyRef.current) return;
    try {
      const base = latest.current.game;
      const result = executeGameHook(base, "turn", minutes ? { minutes } : {});
      const apply = () => {
        if (latest.current.game !== base) {
          setError("The game changed. Advance it again.");
          return;
        }
        commit(result.project, result.generation);
        setNotice(
          minutes ? `Advanced ${minutes} minutes.` : "Advanced one turn.",
        );
      };
      if (result.requiresConfirmation || isDestructive(result.diff))
        setConfirmation({
          label: "Advance game",
          diff: result.diff,
          run: apply,
        });
      else apply();
    } catch (caught) {
      fail(caught);
    }
  };
  const savePageProse = () => {
    if (busyRef.current) return;
    if (
      draftBasis.current.pageId !== page.id ||
      draftBasis.current.text !== page.text
    ) {
      setError(
        "This page changed after you started editing. Reload its current prose before saving.",
      );
      return;
    }
    try {
      const base = latest.current.game;
      const next = replaceGamePageText(base, page.id, pageDraft, {
        confirmed: true,
      });
      const apply = () => {
        if (latest.current.game !== base) {
          setError("The page changed. Review your edits again.");
          return;
        }
        draftBasis.current.text = pageDraft;
        save(next);
        setNotice("Page prose saved.");
      };
      setConfirmation({
        label: "Replace page prose",
        diff: next.history.at(-1)?.changes ?? [],
        run: apply,
      });
    } catch (caught) {
      fail(caught);
    }
  };
  const clickOption = (id: string) => {
    if (busyRef.current) return;
    try {
      const result = executeOption(latest.current.game, id);
      commit(result.project, result.generation);
    } catch (caught) {
      fail(caught);
    }
  };
  const approve = (id: string) => {
    if (busyRef.current) return;
    try {
      const base = latest.current.game;
      const result = acceptGameProposal(base, id, { confirmed: true });
      const next = result.project;
      const diff = result.diff;
      const apply = () => {
        if (latest.current.game !== base) {
          setError("The game changed. Review this proposal again.");
          return;
        }
        commit(next, result.generation);
        setNotice("Proposal approved and applied.");
      };
      if (result.requiresConfirmation || isDestructive(diff))
        setConfirmation({
          label: "Approve destructive proposal",
          diff,
          run: apply,
        });
      else apply();
    } catch (caught) {
      fail(caught);
    }
  };
  const restoreRevision = (id: string, branch = false) => {
    try {
      let restored = latest.current.game;
      while (restored.history.length && restored.history.at(-1)?.id !== id)
        restored = undoGame(restored);
      if (restored.history.at(-1)?.id === id) restored = undoGame(restored);
      if (branch)
        onBranch?.({ ...restored, future: [], actionLock: undefined });
      else {
        save(restored);
        setNotice("Restored the checkpoint before this revision.");
      }
    } catch (caught) {
      fail(caught);
    }
  };
  const travelHistory = (direction: "undo" | "redo") => {
    if (busyRef.current) return;
    try {
      save(
        direction === "undo"
          ? undoGame(latest.current.game)
          : redoGame(latest.current.game),
      );
    } catch (caught) {
      fail(caught);
    }
  };
  const assembled = useMemo(() => {
    if (busy || tab !== "Context") return null;
    try {
      return {
        value: buildGamePrompt(
          game,
          story,
          { instruction: input, mode: "continue" },
          providerContext?.signature === providerSignature
            ? providerContext.limit
            : undefined,
          lorebooks,
        ),
        error: "",
      };
    } catch (caught) {
      return {
        value: null,
        error:
          caught instanceof Error
            ? caught.message
            : "Context could not be assembled.",
      };
    }
  }, [
    game,
    story.connection,
    story.settings,
    story.memory,
    story.author,
    story.notes,
    story.activeLorebooks,
    input,
    busy,
    tab,
    lorebooks,
    providerContext,
    providerSignature,
  ]);
  const snippets = {
    Stat: '<add: stat: name: "Money" id: "money">\n<define: stat: "money" type: number default: 0 ai-access: modify>',
    Option:
      '<option: id: "ask" name: "Ask a question" once: true result: <page: append> <ai: instruction: "Respond to the question.">>',
    "Global widget":
      '<display: id: "money-ui" stat: "money" style: counter ui: global label: "Money">',
    "Event widget":
      '<display: id: "suspicion-ui" mechanic: "suspicion" style: progress-bar ui: event event: "pursuit" remove-on: event-end position: page-top>',
    Instruction:
      '<ai-instruct: id: "style" scope: global content: "Continue the scene without recaps.">',
  };
  return (
    <div className="vgame-workspace">
      <nav
        className="vgame-nav"
        aria-label="Vgame tools"
        inert={(mobilePanel && showSide) || !!confirmation}
      >
        <div className="vgame-tabs">
          {tabs.map((item) => (
            <button
              key={item}
              className={tab === item ? "active" : ""}
              onClick={() => setTab(item)}
            >
              {item}
              {item === "Inbox" &&
              game.proposals.some((proposal) => proposal.status === "pending")
                ? ` (${game.proposals.filter((proposal) => proposal.status === "pending").length})`
                : ""}
            </button>
          ))}
        </div>
        <div className="vgame-nav-actions">
          <button
            aria-label="Global game drawer"
            onClick={() => {
              if (busyRef.current) setDrawerDismissed((value) => !value);
              else {
                updateSetting("global-drawer-open", !drawer);
                setDrawerDismissed(false);
              }
              setTab("Story");
            }}
          >
            <Columns2 size={15} />
            <span className="vgame-label">Global</span>
          </button>
          <button
            aria-label="Game model settings"
            disabled={busy}
            onClick={onOpenConnection}
          >
            <Settings2 size={15} />
          </button>
        </div>
      </nav>
      {error && (
        <div className="vgame-alert error" role="alert">
          {error}
          <button className="text-button" onClick={() => setError("")}>
            Dismiss
          </button>
        </div>
      )}
      {notice && (
        <div className="vgame-alert" role="status">
          {notice}
          <button className="text-button" onClick={() => setNotice("")}>
            Dismiss
          </button>
        </div>
      )}
      <div
        className={`vgame-body${drawer && visibleGamePanels(game).find((panel) => panel.ui === "global")?.drawer === "left" ? " vgame-drawer-left" : ""}`}
      >
        <main
          className="vgame-page"
          inert={(mobilePanel && showSide) || !!confirmation}
        >
          <div className="vgame-page-head">
            <button
              disabled={busy || game.navigation.length < 1}
              onClick={() => execute("<page: back>", "View previous page")}
            >
              Back
            </button>
            <select
              aria-label="Current game page"
              disabled={busy}
              value={game.activePageId}
              onChange={(e) =>
                execute(`<page: goto: ${quote(e.target.value)}>`, "View page")
              }
            >
              {game.pages.map((item, index) => (
                <option key={item.id} value={item.id}>
                  {index + 1}. {item.title || "Untitled page"}
                </option>
              ))}
            </select>
            <span className="vgame-page-count">{game.pages.length} pages</span>
          </div>
          <div className="vgame-page-widgets">
            {visible
              .filter(
                (widget) =>
                  widget.ui !== "global" && widget.position === "page-top",
              )
              .map((widget) => (
                <Widget key={widget.id} widget={widget} game={game} />
              ))}
          </div>
          <div className="vgame-prose">
            <ManuscriptEditor
              key={`${page.id}:${editReset}`}
              ref={editor}
              text={page.text}
              readOnly={busy}
              font={15}
              latest={null}
              onChange={(text) => {
                try {
                  save(
                    editGamePageText(
                      latest.current.game,
                      latest.current.game.activePageId,
                      text,
                    ),
                  );
                } catch (caught) {
                  fail(caught);
                  setEditReset((value) => value + 1);
                }
              }}
              undo={() => {
                travelHistory("undo");
              }}
              redo={() => {
                travelHistory("redo");
              }}
            />
          </div>
          <div className="vgame-page-widgets">
            {visible
              .filter(
                (widget) =>
                  widget.ui !== "global" && widget.position === "inline",
              )
              .map((widget) => (
                <Widget key={widget.id} widget={widget} game={game} />
              ))}
          </div>
          <div className="vgame-choices" aria-label="Page choices">
            {game.options
              .filter(
                (option) =>
                  option.pageId === game.activePageId &&
                  !option.resolved &&
                  !(option.once && option.used),
              )
              .sort((a, b) => a.order - b.order)
              .map((option) => (
                <button
                  className="vgame-choice"
                  key={option.id}
                  disabled={busy || !optionEnabled(game, option)}
                  title={option.description}
                  onClick={() => clickOption(option.id)}
                >
                  {option.name}
                </button>
              ))}
          </div>
          <div className="vgame-page-widgets">
            {visible
              .filter(
                (widget) =>
                  widget.ui !== "global" && widget.position === "page-bottom",
              )
              .map((widget) => (
                <Widget key={widget.id} widget={widget} game={game} />
              ))}
          </div>
          <div className="vgame-compose">
            <VHTMLComposer
              game={game}
              label="Freeform game input"
              placeholder="Send text, or start with < for V-HTML…"
              disabled={busy}
              value={input}
              onChange={setInput}
              onSubmit={() => sendInput(input, setInput)}
            />
            <div className="vgame-compose-actions">
              <button
                disabled={busy || !input.trim()}
                onClick={() => sendInput(input, setInput)}
              >
                Send
              </button>
              <button
                disabled={busy}
                onClick={() => execute("<page: next>", "Create blank page")}
              >
                New page
              </button>
              {busy ? (
                <button onClick={stop}>
                  <Square size={14} />
                  Stop AI
                </button>
              ) : (
                <button
                  className="primary"
                  onClick={() =>
                    void requestGeneration(game, {
                      instruction: input,
                      mode: "continue",
                    })
                  }
                >
                  <Play size={14} />
                  Generate
                </button>
              )}
            </div>
          </div>
          <div className="vgame-bottom">
            <button
              aria-label="Undo game action"
              disabled={busy || !game.history.length}
              onClick={() => travelHistory("undo")}
            >
              <Undo2 size={14} />
            </button>
            <button
              aria-label="Redo game action"
              disabled={busy || !game.future.length}
              onClick={() => travelHistory("redo")}
            >
              <Redo2 size={14} />
            </button>
            <span className="vgame-status">
              {busy
                ? "Generating…"
                : `${wordCount.toLocaleString()} words · ${game.settings.approval}`}
            </span>
            <span className="vgame-status vgame-busy">
              {story.connection.model || story.connection.kind}
            </span>
          </div>
        </main>
        {showSide && (
          <>
            <button
              className="vgame-backdrop"
              aria-label="Close game panel"
              onClick={closeTools}
            />
            <aside
              className="vgame-side"
              ref={side}
              role={mobilePanel ? "dialog" : undefined}
              aria-modal={mobilePanel || undefined}
              aria-label={drawer ? "Global UI" : `${tab} tools`}
              tabIndex={-1}
              inert={!!confirmation}
            >
              <div className="vgame-side-head">
                <strong>{drawer ? "Global UI" : tab}</strong>
                {busy && <button onClick={stop}>Stop AI</button>}
                <button aria-label="Close game tools" onClick={closeTools}>
                  <X size={15} />
                </button>
              </div>
              <div className="vgame-side-body">
                {drawer && (
                  <>
                    <p className="help">
                      Persistent views for this game. Page and event views stay
                      on their own page.
                    </p>
                    {visibleGamePanels(game)
                      .filter((panel) => panel.ui === "global")
                      .map((panel) => (
                        <section className="vgame-card" key={panel.id}>
                          <h3>{panel.name}</h3>
                          <div className="vgame-widget-list">
                            {visible
                              .filter(
                                (widget) =>
                                  widget.ui === "global" &&
                                  [panel.id, panel.name].includes(
                                    widget.panel ?? "",
                                  ),
                              )
                              .map((widget) => (
                                <Widget
                                  key={widget.id}
                                  widget={widget}
                                  game={game}
                                />
                              ))}
                          </div>
                        </section>
                      ))}
                    <div className="vgame-widget-list">
                      {visible
                        .filter(
                          (widget) =>
                            widget.ui === "global" &&
                            !visibleGamePanels(game).some(
                              (panel) =>
                                panel.ui === "global" &&
                                [panel.id, panel.name].includes(
                                  widget.panel ?? "",
                                ),
                            ),
                        )
                        .map((widget) => (
                          <Widget key={widget.id} widget={widget} game={game} />
                        ))}
                    </div>
                    {!visible.some((widget) => widget.ui === "global") && (
                      <p className="vgame-empty">
                        No global widgets. Add a view in UI or V-HTML; creating
                        a value alone does not create a widget.
                      </p>
                    )}
                  </>
                )}
                {tab === "World" && (
                  <>
                    <WorldEditor game={game} execute={execute} busy={busy} />
                    <details className="vgame-card">
                      <summary>Time & encounters</summary>
                      <p className="vgame-meta">
                        Turn {game.turn} · {game.elapsedMinutes} elapsed minutes
                      </p>
                      <button disabled={busy} onClick={() => advanceGame()}>
                        Advance turn
                      </button>
                      <Field label="Minutes to advance">
                        <input
                          type="number"
                          min="1"
                          max="1440"
                          disabled={busy}
                          value={advanceMinutes}
                          onChange={(e) =>
                            setAdvanceMinutes(
                              Math.max(
                                1,
                                Math.min(1440, Math.round(+e.target.value)),
                              ),
                            )
                          }
                        />
                      </Field>
                      <button
                        disabled={busy}
                        onClick={() => advanceGame(advanceMinutes)}
                      >
                        Advance minutes
                      </button>
                      <p className="help">
                        Runs declared turn/interval hooks and eligible
                        encounters once. Opening editors never advances time.
                      </p>
                    </details>
                  </>
                )}
                {tab === "UI" && (
                  <>
                    <p className="help">
                      UI is the layout. A panel groups views; a widget is one
                      counter, bar or text bound to World data. Example: Money
                      is a stat, its counter is a widget, and Character is the
                      panel containing it. Removing a widget keeps the stat.
                    </p>
                    <UIEditor game={game} execute={execute} busy={busy} />
                  </>
                )}
                {tab === "Instructions" && (
                  <InstructionEditor
                    game={game}
                    execute={execute}
                    busy={busy}
                  />
                )}
                {tab === "Thinking" && (
                  <>
                    {thoughts && busy && (
                      <pre className="vgame-prompt-preview">{thoughts}</pre>
                    )}
                    <ThinkingPanel story={story} patch={patch} />
                  </>
                )}
                {tab === "Pages" && (
                  <>
                    <div className="vgame-pages-list">
                      {game.pages.map((item, index) => (
                        <button
                          key={item.id}
                          disabled={busy}
                          className={item.id === page.id ? "active" : ""}
                          onClick={() =>
                            execute(
                              `<page: goto: ${quote(item.id)}>`,
                              "View page",
                            )
                          }
                        >
                          {index + 1}. {item.title} ·{" "}
                          {item.text.length.toLocaleString()} chars
                        </button>
                      ))}
                    </div>
                    <Field label="Current page prose">
                      <textarea
                        spellCheck={false}
                        maxLength={2000000}
                        disabled={busy}
                        value={pageDraft}
                        onChange={(e) => setPageDraft(e.target.value)}
                      />
                    </Field>
                    <button
                      disabled={busy || pageDraft === page.text}
                      onClick={savePageProse}
                    >
                      Save page prose
                    </button>
                    {draftBasis.current.text !== page.text && (
                      <p className="error">
                        This page changed while you were editing.{" "}
                        <button
                          disabled={busy}
                          onClick={() => {
                            setPageDraft(page.text);
                            draftBasis.current.text = page.text;
                          }}
                        >
                          Reload current prose
                        </button>
                      </p>
                    )}
                    <Field label="Page summary">
                      <textarea
                        maxLength={12000}
                        disabled={busy}
                        value={summaryDraft}
                        onChange={(e) => setSummaryDraft(e.target.value)}
                      />
                    </Field>
                    <button
                      disabled={busy || summaryDraft === page.summary}
                      onClick={() => {
                        if (draftBasis.current.summary !== page.summary) {
                          setError(
                            "This summary changed. Reload it before saving.",
                          );
                          return;
                        }
                        if (
                          execute(
                            `<summary: page: ${quote(page.id)} value: ${quote(summaryDraft)}>`,
                            "Save page summary",
                          )
                        )
                          draftBasis.current.summary = summaryDraft;
                      }}
                    >
                      Save summary
                    </button>
                    {draftBasis.current.summary !== page.summary && (
                      <button
                        disabled={busy}
                        onClick={() => {
                          setSummaryDraft(page.summary);
                          draftBasis.current.summary = page.summary;
                        }}
                      >
                        Reload current summary
                      </button>
                    )}
                    <OptionEditor game={game} execute={execute} busy={busy} />
                    <p className="help">
                      Viewing an older page keeps current world values. Undo or
                      restore a revision to restore state, or branch explicitly.
                    </p>
                  </>
                )}
                {tab === "V-HTML" && (
                  <>
                    <p className="help">
                      Validated game commands, never browser HTML or JavaScript.
                      Drafts apply only after Preview and Apply.
                    </p>
                    <div className="vgame-source-tools">
                      <select
                        aria-label="Insert V-HTML command"
                        defaultValue=""
                        disabled={busy}
                        onChange={(e) => {
                          if (e.target.value) {
                            setSource(
                              source +
                                (source ? "\n" : "") +
                                snippets[
                                  e.target.value as keyof typeof snippets
                                ],
                            );
                            setPreview(null);
                            e.target.value = "";
                          }
                        }}
                      >
                        <option value="">Insert command…</option>
                        {Object.keys(snippets).map((name) => (
                          <option key={name}>{name}</option>
                        ))}
                      </select>
                      <button
                        disabled={busy}
                        onClick={() => sourceFile.current?.click()}
                      >
                        Import V-HTML
                      </button>
                      <input
                        hidden
                        ref={sourceFile}
                        type="file"
                        accept=".vhtml,.txt,text/plain"
                        aria-label="V-HTML file"
                        onChange={async (event) => {
                          const imported = event.target.files?.[0],
                            basis = latest.current;
                          event.target.value = "";
                          if (!imported) return;
                          try {
                            if (imported.size > VHTML_LIMITS.sourceLength)
                              throw new Error(
                                `V-HTML files must be at most ${VHTML_LIMITS.sourceLength.toLocaleString()} bytes.`,
                              );
                            const text = await imported.text();
                            if (text.length > VHTML_LIMITS.sourceLength)
                              throw new Error(
                                "V-HTML source exceeds the editor limit.",
                              );
                            if (
                              busyRef.current ||
                              latest.current.story.id !== basis.story.id ||
                              latest.current.game !== basis.game
                            )
                              throw new Error(
                                "The game changed while the source file was loading. Import it again.",
                              );
                            setSource(text);
                            setPreview(null);
                            setDefinitionMode(false);
                            setSourceDiagnostic(undefined);
                            setNotice(
                              "V-HTML loaded as a draft. Preview and Apply to change the game.",
                            );
                          } catch (caught) {
                            fail(caught);
                          }
                        }}
                      />
                      <button
                        disabled={busy}
                        onClick={() => {
                          const canonical = generateVHTML(game);
                          if (canonical.length > VHTML_LIMITS.sourceLength) {
                            setError(
                              "This game's definitions exceed the V-HTML editor limit. Export a full JSON checkpoint instead.",
                            );
                            return;
                          }
                          setSource(canonical);
                          setDefinitionMode(true);
                          setPreview(null);
                        }}
                      >
                        Load canonical source
                      </button>
                    </div>
                    <VHTMLInput
                      game={game}
                      value={source}
                      disabled={busy}
                      diagnostic={sourceDiagnostic}
                      onChange={(value) => {
                        setSource(value);
                        setPreview(null);
                      }}
                    />
                    <Toggle
                      label="Edit canonical definitions"
                      disabled={busy}
                      value={definitionMode}
                      onChange={(value) => {
                        setDefinitionMode(value);
                        setPreview(null);
                      }}
                    />
                    <div className="vgame-source-tools">
                      <button
                        disabled={busy || !source.trim()}
                        onClick={() => {
                          try {
                            const result = executeVHTML(game, source, {
                              origin: "user",
                              confirmed: true,
                              definitionMode,
                            });
                            setPreview({
                              basis: game,
                              game: result.project,
                              diff: result.diff,
                              source,
                            });
                            setError("");
                          } catch (caught) {
                            setPreview(null);
                            fail(caught);
                          }
                        }}
                      >
                        Preview V-HTML
                      </button>
                      <button
                        disabled={
                          busy ||
                          !preview ||
                          preview.source !== source ||
                          preview.basis !== game
                        }
                        onClick={() =>
                          execute(source, "Apply V-HTML", definitionMode)
                        }
                      >
                        Apply V-HTML
                      </button>
                      <button
                        onClick={() =>
                          download(
                            `${story.title}-vhtml.txt`,
                            generateVHTML(game),
                            "text/plain",
                          )
                        }
                      >
                        Export V-HTML
                      </button>
                    </div>
                    {sourceDiagnostic && (
                      <p className="error" role="status">
                        {sourceDiagnostic.message} · line{" "}
                        {sourceDiagnostic.span.line}, column{" "}
                        {sourceDiagnostic.span.column}
                        {sourceDiagnostic.suggestion
                          ? ` · ${sourceDiagnostic.suggestion}`
                          : ""}
                      </p>
                    )}
                    {preview && (
                      <div
                        className="vgame-preview"
                        aria-label="V-HTML preview"
                      >
                        <strong>Preview · {preview.diff.length} changes</strong>
                        <pre className="vgame-diff">
                          {changeText(preview.diff)}
                        </pre>
                        <p>
                          {
                            preview.game.pages.find(
                              (item) => item.id === preview.game.activePageId,
                            )?.text
                          }
                        </p>
                      </div>
                    )}
                    <p className="help">
                      Definition mode updates matching IDs and keeps omitted
                      definitions. Use an explicit remove command to delete.
                      Archived page prose stays in Pages and full JSON
                      checkpoints; canonical source includes only the current
                      page when compact. Unknown or unsupported commands fail
                      with a location; no partial state is applied.
                    </p>
                    <Field label="V-HTML command input">
                      <VHTMLComposer
                        game={game}
                        disabled={busy}
                        label="V-HTML command input"
                        value={commandInput}
                        onChange={setCommandInput}
                        placeholder='<add: stat: id: "money" name: "Money">'
                        maxLength={VHTML_LIMITS.sourceLength}
                        onSubmit={() => {
                          if (
                            commandInput.trim() &&
                            execute(commandInput, "Send V-HTML")
                          )
                            setCommandInput("");
                        }}
                      />
                    </Field>
                    <button
                      disabled={busy || !commandInput.trim()}
                      onClick={() => {
                        if (execute(commandInput, "Send V-HTML"))
                          setCommandInput("");
                      }}
                    >
                      Send V-HTML
                    </button>
                    <details className="vgame-guide">
                      <summary>V-HTML guide &amp; examples</summary>
                      <button
                        onClick={() =>
                          download("vhtml-guide-tr.txt", guide, "text/plain")
                        }
                      >
                        Download guide
                      </button>
                      <pre>{guide}</pre>
                    </details>
                  </>
                )}
                {tab === "Inbox" && (
                  <>
                    <Field label="AI change approval">
                      <select
                        disabled={busy}
                        value={game.settings.approval}
                        onChange={(e) =>
                          updateSetting("approval", e.target.value)
                        }
                      >
                        <option value="manual">
                          Manual · approve each proposal
                        </option>
                        <option value="smart">
                          Smart · routine allowed values only
                        </option>
                        <option value="auto">
                          Auto · valid permitted changes
                        </option>
                      </select>
                    </Field>
                    <p className="help">
                      Manual is the default. Smart keeps structural changes for
                      review. Auto applies only validated commands within
                      permissions; executable HTML/JS remains unsupported.
                    </p>
                    {game.proposals.length ? (
                      [...game.proposals]
                        .reverse()
                        .slice(0, proposalLimit)
                        .map((proposal) => (
                          <ProposalCard
                            key={proposal.id}
                            game={game}
                            id={proposal.id}
                            busy={busy}
                            approve={approve}
                            reject={(id) => {
                              try {
                                save(rejectGameProposal(game, id));
                              } catch (caught) {
                                fail(caught);
                              }
                            }}
                            edit={(id, script) => {
                              try {
                                save(editGameProposal(game, id, script));
                                setNotice("Proposal edited and revalidated.");
                              } catch (caught) {
                                fail(caught);
                              }
                            }}
                          />
                        ))
                    ) : (
                      <p className="vgame-empty">
                        No proposals. Prose-only responses are valid; the AI
                        does not need to add mechanics or choices.
                      </p>
                    )}
                    {proposalLimit < game.proposals.length && (
                      <button
                        onClick={() => setProposalLimit((count) => count + 30)}
                      >
                        Load more proposals
                      </button>
                    )}
                  </>
                )}
                {tab === "Context" && (
                  <>
                    <Toggle
                      label="New page after choices"
                      value={game.settings.choiceNewPage !== false}
                      disabled={busy}
                      onChange={(value) =>
                        updateSetting("choice-new-page", value)
                      }
                    />
                    <Toggle
                      label="New page for Generate"
                      value={game.settings.generationNewPage !== false}
                      disabled={busy}
                      onChange={(value) =>
                        updateSetting("generation-new-page", value)
                      }
                    />
                    <Field label="Game AI profile">
                      <select
                        disabled={busy}
                        value={game.settings.profile}
                        onChange={(e) =>
                          updateSetting("profile", e.target.value)
                        }
                      >
                        <option value="novel">Novel</option>
                        <option value="balanced">Balanced</option>
                        <option value="interactive">Interactive fiction</option>
                        <option value="designer">Sandbox designer</option>
                      </select>
                    </Field>
                    <Field label="Game max context (tokens)">
                      <input
                        type="number"
                        min="1024"
                        max="131072"
                        key={`context-${game.settings.maxContextTokens}`}
                        disabled={busy}
                        defaultValue={game.settings.maxContextTokens}
                        onBlur={(e) =>
                          updateSetting(
                            "max-context-tokens",
                            Math.round(+e.target.value),
                          )
                        }
                      />
                    </Field>
                    <Field label="History pages in AI context">
                      <select
                        disabled={busy}
                        value={game.settings.maxHistoryPages}
                        onChange={(e) =>
                          updateSetting("max-history-pages", +e.target.value)
                        }
                      >
                        {[5, 10, 20, 30, 50, 0].map((count) => (
                          <option key={count} value={count}>
                            {count || "All stored pages"}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Game context reserve (tokens)">
                      <input
                        type="number"
                        min="0"
                        max={game.settings.maxContextTokens - 1}
                        key={`reserve-${game.settings.reserveTokens}`}
                        disabled={busy}
                        defaultValue={game.settings.reserveTokens}
                        onBlur={(e) =>
                          updateSetting(
                            "reserve-tokens",
                            Math.round(+e.target.value),
                          )
                        }
                      />
                    </Field>
                    <Field label="Older-page summaries">
                      <select
                        disabled={busy}
                        value={game.settings.summary}
                        onChange={(e) =>
                          updateSetting("summary", e.target.value)
                        }
                      >
                        <option value="manual">Include manual summaries</option>
                        <option value="disabled">Disabled</option>
                      </select>
                    </Field>
                    <div className="vgame-form-grid">
                      <Field label="Game output (tokens)">
                        <input
                          type="number"
                          min="64"
                          max="131072"
                          key={`output-${game.settings.maxOutputTokens}`}
                          disabled={busy}
                          defaultValue={game.settings.maxOutputTokens}
                          onBlur={(e) =>
                            updateSetting(
                              "output-tokens",
                              Math.round(+e.target.value),
                            )
                          }
                        />
                      </Field>
                      <Field label="Game thinking output (tokens)">
                        <input
                          type="number"
                          min="0"
                          max="131072"
                          key={`thinking-output-${game.settings.thinkingMaxTokens}`}
                          disabled={busy}
                          defaultValue={game.settings.thinkingMaxTokens}
                          onBlur={(e) =>
                            updateSetting(
                              "thinking-output-tokens",
                              Math.round(+e.target.value),
                            )
                          }
                        />
                      </Field>
                    </div>
                    <Toggle
                      label="Game thinking"
                      disabled={busy}
                      value={game.settings.thinking}
                      onChange={(value) => updateSetting("thinking", value)}
                    />
                    <Field label="Game thinking level">
                      <select
                        disabled={busy || !game.settings.thinking}
                        value={game.settings.thinkingLevel}
                        onChange={(e) =>
                          updateSetting("thinking-level", e.target.value)
                        }
                      >
                        {["minimal", "low", "medium", "high"].map((level) => (
                          <option key={level}>{level}</option>
                        ))}
                      </select>
                    </Field>
                    <p className="help">
                      Context limits which pages are sent to the model, never
                      which pages are saved. Game output and thinking budgets
                      are saved independently from Vchat writing settings. The
                      model connection and sampling settings are shared. Counts
                      are estimates unless the provider confirms its limit.
                    </p>
                    {assembled?.error && (
                      <p className="error">{assembled.error}</p>
                    )}
                    <p className="vgame-meta">
                      {providerContext?.signature === providerSignature &&
                      providerContext.pending
                        ? "Checking the provider's context limit…"
                        : providerContext?.signature === providerSignature &&
                            providerContext.limit
                          ? `Provider context limit: ${providerContext.limit.toLocaleString()} tokens.`
                          : "Provider context limit unavailable; using the saved game limit."}{" "}
                      Token counts are estimates.
                    </p>
                    {assembled?.value && (
                      <>
                        <p className="vgame-meta">
                          ~{assembled.value.total.toLocaleString()} /{" "}
                          {assembled.value.budget.toLocaleString()} input tokens
                          · {assembled.value.reserved.toLocaleString()} reserved
                          · {assembled.value.includedPageIds.length} pages
                          included
                        </p>
                        {assembled.value.warnings.map((warning) => (
                          <p className="help" key={warning}>
                            {warning}
                          </p>
                        ))}
                        <details className="vgame-card">
                          <summary>Effective game prompt</summary>
                          <pre className="vgame-prompt-preview">
                            {assembled.value.prompt}
                          </pre>
                        </details>
                        {assembled.value.sections.map((section) => (
                          <details key={section.name} className="vgame-card">
                            <summary>
                              {section.name} · ~{section.tokens} tokens
                            </summary>
                            <pre className="vgame-prompt-preview">
                              {section.text}
                            </pre>
                          </details>
                        ))}
                      </>
                    )}
                  </>
                )}
                {tab === "History" && (
                  <>
                    <div className="vgame-source-tools">
                      <button
                        disabled={busy}
                        onClick={() =>
                          download(
                            `${story.title}-checkpoint.json`,
                            JSON.stringify({
                              format: "vchat-vgame-checkpoint",
                              version: 1,
                              project: { ...game, actionLock: undefined },
                            }),
                            "application/json",
                          )
                        }
                      >
                        Export checkpoint
                      </button>
                      <button
                        disabled={busy}
                        onClick={() => file.current?.click()}
                      >
                        Import checkpoint
                      </button>
                      <button
                        disabled={busy || !onBranch}
                        onClick={() =>
                          onBranch?.({
                            ...game,
                            actionLock: undefined,
                            future: [],
                          })
                        }
                      >
                        Branch current game
                      </button>
                      <input
                        hidden
                        ref={file}
                        type="file"
                        accept=".json,application/json"
                        aria-label="Game checkpoint JSON"
                        onChange={async (e) => {
                          const imported = e.target.files?.[0];
                          const importBasis = latest.current;
                          e.target.value = "";
                          if (!imported) return;
                          try {
                            if (imported.size > 128 * 1024 * 1024)
                              throw new Error(
                                "Checkpoint files must be at most 128 MiB.",
                              );
                            const data = JSON.parse(await imported.text());
                            if (
                              data.format !== "vchat-vgame-checkpoint" ||
                              data.version !== 1 ||
                              !validateGameProject(data.project)
                            )
                              throw new Error("Invalid game checkpoint.");
                            const next = {
                              ...data.project,
                              actionLock: undefined,
                            } as GameProject;
                            if (
                              busyRef.current ||
                              latest.current.story.id !==
                                importBasis.story.id ||
                              latest.current.game !== importBasis.game
                            )
                              throw new Error(
                                "The game changed while this checkpoint was loading. Import it again.",
                              );
                            setConfirmation({
                              label: "Restore imported checkpoint",
                              diff: gameDiff(importBasis.game, next),
                              run: () => {
                                if (
                                  busyRef.current ||
                                  latest.current.story.id !==
                                    importBasis.story.id ||
                                  latest.current.game !== importBasis.game
                                ) {
                                  setError(
                                    "The game changed. Review this import again.",
                                  );
                                  return;
                                }
                                save(next);
                              },
                            });
                          } catch (caught) {
                            fail(caught);
                          }
                        }}
                      />
                    </div>
                    <p className="help">
                      Checkpoints include pages and world state. Import replaces
                      this game's state after confirmation. Existing Vchat prose
                      stays separate. Viewing pages is navigation; restoring a
                      revision changes state. Files are limited to 128 MiB; the
                      saved-project size limit also applies.
                    </p>
                    {[...game.history]
                      .reverse()
                      .slice(0, historyLimit)
                      .map((revision) => (
                        <details className="vgame-card" key={revision.id}>
                          <summary>
                            {revision.label} · {revision.origin}
                          </summary>
                          <p className="vgame-meta">
                            {new Date(revision.at).toLocaleString()}
                          </p>
                          <pre className="vgame-diff">
                            {changeText(revision.changes)}
                          </pre>
                          <div className="vgame-history-row">
                            <button
                              disabled={busy}
                              onClick={() => restoreRevision(revision.id)}
                            >
                              Restore before revision
                            </button>
                            <button
                              disabled={busy || !onBranch}
                              onClick={() => restoreRevision(revision.id, true)}
                            >
                              Branch before revision
                            </button>
                          </div>
                        </details>
                      ))}
                    {historyLimit < game.history.length && (
                      <button
                        onClick={() => setHistoryLimit((count) => count + 20)}
                      >
                        Load more game history
                      </button>
                    )}
                    <details className="vgame-card">
                      <summary>Runtime log ({game.log.length})</summary>
                      {game.log
                        .slice(-30)
                        .reverse()
                        .map((entry) => (
                          <p className="vgame-meta" key={entry.id}>
                            {entry.message}
                          </p>
                        ))}
                    </details>
                  </>
                )}
              </div>
            </aside>
          </>
        )}
      </div>
      {confirmation && (
        <div className="vgame-overlay">
          <section
            className="vgame-confirm"
            ref={confirmDialog}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-label="Confirm game change"
          >
            <h2>{confirmation.label}</h2>
            <p className="help">
              Review the exact state change before applying. Undo remains
              available.
            </p>
            <pre className="vgame-diff">{changeText(confirmation.diff)}</pre>
            <div className="row">
              <button onClick={() => setConfirmation(null)}>
                Cancel change
              </button>
              <button
                className="primary"
                onClick={() => {
                  const action = confirmation.run;
                  setConfirmation(null);
                  action();
                }}
              >
                Confirm change
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
