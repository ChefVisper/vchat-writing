import { useEffect, useLayoutEffect, useState, useRef, useMemo } from "react";
import {
  BookOpen,
  Feather,
  Plus,
  ArrowLeft,
  PanelRightClose,
  PanelRightOpen,
  Sparkles,
  RotateCcw,
  Undo2,
  Redo2,
  SlidersHorizontal,
  NotebookPen,
  Globe2,
  Layers,
  Plug,
  Code2,
  Sun,
  Moon,
  Maximize2,
  Minimize2,
  Search,
  Download,
  Upload,
  Copy,
  Trash2,
  GitBranch,
  Camera,
  History,
  X,
  Check,
  Square,
  ChevronDown,
} from "lucide-react";
import { useStore } from "./store";
import { uid, type Story, type Note, newStory } from "./types";
import { storage } from "./storage/stories";
import { buildPrompt } from "./context/promptBuilder";
import { providers } from "./providers";
import { retryBase, cleanContinuation } from "./generation/history";
import {
  validateUpdates,
  applyUpdate,
  updaterPrompt,
  type Update,
} from "./generation/stateUpdater";
import { exportProject, importProject, download } from "./storage/transfer";
import { NotesPanel } from "./components/NotesPanel";
import { ContextPanel, LorebookEditor } from "./components/ContextPanel";
import {
  ConnectionPanel,
  GenerationSettings,
} from "./components/GenerationSettings";
import { PromptInspector } from "./components/PromptInspector";
const tabs = [
  { id: "notes", label: "Notebook", icon: NotebookPen },
  { id: "context", label: "Memory", icon: Layers },
  { id: "lore", label: "Lorebook", icon: Globe2 },
  { id: "settings", label: "Settings", icon: SlidersHorizontal },
  { id: "connection", label: "Connection", icon: Plug },
  { id: "prompt", label: "View prompt", icon: Code2 },
  { id: "history", label: "History", icon: History },
];
export default function App() {
  const store = useStore();
  const { patch } = store;
  const story = store.stories.find((x) => x.id === store.current);
  const [library, setLibrary] = useState(false);
  const [panel, setPanel] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState("");
  const [status, setStatus] = useState("Not connected");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [keys, setKeys] = useState<Record<string, string>>({});
  const pending = story?.pending || [];
  const setPending = (pending: Update[]) => patch({ pending });
  const [lastPrompt, setLastPrompt] = useState("");
  const [dark, setDark] = useState(true);
  const [focus, setFocus] = useState(false);
  const [font, setFont] = useState(16);
  const [width, setWidth] = useState(1600);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const editor = useRef<HTMLTextAreaElement>(null);
  const followGeneration = useRef(false);
  const scrollEditorToBottom = () => {
    requestAnimationFrame(() => {
      if (editor.current)
        editor.current.scrollTop = editor.current.scrollHeight;
    });
  };
  const file = useRef<HTMLInputElement>(null);
  const current = () =>
    useStore
      .getState()
      .stories.find((x) => x.id === useStore.getState().current)!;
  const apiKey = story ? keys[story.connection.kind] || "" : "";
  useEffect(() => {
    void store.init();
    storage
      .pref("appearance-compact")
      .then((p) => {
        if (p) {
          setDark(p.dark);
          setFont(p.font);
          setWidth(p.width);
        }
      })
      .catch(() => {});
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
  }, [dark]);
  useEffect(() => {
    setLastPrompt("");
    setError("");
    setStatus("Not connected");
  }, [store.current]);
  useLayoutEffect(() => {
    if (!followGeneration.current || !editor.current) return;
    editor.current.scrollTop = editor.current.scrollHeight;
    const frame = requestAnimationFrame(() => {
      if (editor.current)
        editor.current.scrollTop = editor.current.scrollHeight;
    });
    return () => cancelAnimationFrame(frame);
  }, [story?.text]);
  useEffect(() => {
    if (editor.current) editor.current.scrollTop = editor.current.scrollHeight;
  }, [store.current]);
  const prompt = useMemo(() => (story ? buildPrompt(story) : null), [story]);
  function stop() {
    controller.current?.abort();
    if (story)
      void providers[story.connection.kind]
        .abort?.(story.connection, apiKey)
        .catch(() => {});
  }
  async function generate(retry = false) {
    if (busy || controller.current || !story) return;
    setError("");
    setNotice("");
    if (pending.length) {
      setPanel("notes");
      setError("Accept or reject the pending note changes before continuing.");
      return;
    }
    let s = structuredClone(current());
    try {
      if (retry) {
        const segment = retryBase(s);
        s = {
          ...s,
          text: segment.before,
          notes: segment.notesBefore || s.notes,
          segments: s.segments.slice(0, -1),
        };
      }
      const assembled = buildPrompt(s);
      if (assembled.invalidTemplate)
        throw new Error(
          "Prompt template needs both {{context}} and {{story}}. Edit it in Prompt.",
        );
      if (assembled.overflow)
        throw new Error(
          "Memory and notes exceed the context budget. Review the prompt before continuing.",
        );
      if (!/^https?:\/\//.test(s.connection.url))
        throw new Error("Enter a valid HTTP server URL in Connection.");
      const c = new AbortController();
      controller.current = c;
      setBusy(true);
      followGeneration.current = true;
      setPhase("Writing");
      setLastPrompt(assembled.prompt);
      setPending([]);
      let raw = "";
      const original = current().text;
      const before = s.text;
      const notesBefore = structuredClone(s.notes);
      if (retry) patch({ text: before, notes: s.notes, segments: s.segments });
      const request = {
        prompt: assembled.prompt,
        settings: s.settings,
        connection: s.connection,
        key: apiKey,
        signal: c.signal,
        onToken: (token: string) => {
          raw += token;
          patch({ text: before + cleanContinuation(raw) });
          scrollEditorToBottom();
        },
      };
      let successful = false;
      try {
        await providers[s.connection.kind].generate(request);
        if (!cleanContinuation(raw).trim())
          throw new Error(
            "The model returned no story text. Increase Output limit in Settings or try another model.",
          );
        successful = true;
      } finally {
        const text = before + cleanContinuation(raw);
        if (cleanContinuation(raw).trim())
          patch({
            text,
            past: [...s.past, original].slice(-100),
            future: [],
            segments: [
              ...s.segments,
              { id: uid(), before, after: text, at: Date.now(), notesBefore },
            ],
          });
        else if (retry)
          patch({
            text: original,
            notes: story.notes,
            segments: story.segments,
          });
        else if (raw) patch({ text: original });
      }
      if (
        successful &&
        raw &&
        !c.signal.aborted &&
        s.notes.some(
          (n) => n.enabled && n.aiEditable && !n.locked && n.mode !== "off",
        )
      ) {
        setPhase("Updating notes");
        try {
          const now = current();
          const newText = now.text.startsWith(s.lastUpdateText)
            ? now.text.slice(s.lastUpdateText.length)
            : before.slice(-3000) + cleanContinuation(raw);
          const updater = updaterPrompt(now, newText);
          if (
            new TextEncoder().encode(updater).length / 3.5 + 1024 >
            s.settings.context
          )
            throw new Error(
              "Note update skipped: notes and new prose exceed the context window.",
            );
          const result = await providers[s.connection.kind].generate({
            ...request,
            prompt: updater,
            settings: {
              ...s.settings,
              temperature: 0.1,
              maxTokens: 1024,
              streaming: false,
              stops: "",
            },
            onToken: () => {},
          });
          const updates = validateUpdates(result, current().notes);
          let notes = current().notes;
          for (const u of updates)
            if (notes.find((n) => n.id === u.noteId)?.mode === "auto")
              notes = applyUpdate(notes, u);
          setPending(
            updates.filter(
              (u) => notes.find((n) => n.id === u.noteId)?.mode === "review",
            ),
          );
          patch({
            notes,
            lastUpdateText: current().text,
            segments: current().segments.map((x, i, a) =>
              i === a.length - 1 ? { ...x, notesAfter: notes } : x,
            ),
          });
          if (updates.length)
            setNotice(
              `${updates.length} note ${updates.length === 1 ? "update" : "updates"} ${updates.some((u) => notes.find((n) => n.id === u.noteId)?.mode === "review") ? "ready for review" : "applied"}.`,
            );
        } catch (e) {
          if (!c.signal.aborted)
            setError(e instanceof Error ? e.message : "Note update failed.");
        }
      }
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError"))
        setError(
          e instanceof Error
            ? e.message
            : "Generation failed. Check your connection.",
        );
    } finally {
      scrollEditorToBottom();
      followGeneration.current = false;
      setBusy(false);
      setPhase("");
      controller.current = null;
    }
  }
  function accept(id?: string) {
    let notes = current().notes;
    for (const u of pending.filter((u) => !id || u.noteId === id))
      notes = applyUpdate(notes, u);
    patch({
      notes,
      segments: current().segments.map((x, i, a) =>
        i === a.length - 1 ? { ...x, notesAfter: notes } : x,
      ),
    });
    setPending(pending.filter((u) => id && u.noteId !== id));
  }
  function snapshot() {
    if (!story) return;
    patch({
      snapshots: [
        ...story.snapshots,
        {
          id: uid(),
          title: `Snapshot ${story.snapshots.length + 1}`,
          at: Date.now(),
          text: story.text,
          notes: structuredClone(story.notes),
        },
      ],
    });
    setNotice("Snapshot saved.");
  }
  function branch() {
    if (!story) return;
    store.add({ ...story, parent: story.id, title: story.title + " · branch" });
    setNotice("Branch created. Your original is in the library.");
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (busy) stop();
        else {
          setFocus(false);
          setSearching(false);
        }
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        void generate();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void store.flush().then(() => setNotice("Saved on this device."));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  async function importFile(f: File) {
    try {
      const raw = await f.text();
      const s = f.name.endsWith(".json")
        ? importProject(raw)
        : { ...newStory(), title: f.name.replace(/\.txt$/i, ""), text: raw };
      store.add(s);
      setLibrary(false);
      setNotice("Story imported.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed.");
    }
  }
  function findNext() {
    if (!editor.current || !story || !query) return;
    const start = editor.current.selectionEnd;
    let idx = story.text.toLowerCase().indexOf(query.toLowerCase(), start);
    if (idx < 0) idx = story.text.toLowerCase().indexOf(query.toLowerCase());
    if (idx >= 0) {
      editor.current.focus();
      editor.current.setSelectionRange(idx, idx + query.length);
      const lines = story.text.slice(0, idx).split("\n").length;
      editor.current.scrollTo({
        top: Math.max(0, lines * font * 1.8 - 160),
        behavior: "smooth",
      });
    } else setNotice("No matches found.");
  }
  if (!store.ready || !story)
    return (
      <div className="loading">
        <Feather /> Loading…
      </div>
    );
  const words = story.text.trim() ? story.text.trim().split(/\s+/).length : 0;
  return (
    <div
      className={`app ${focus ? "focus-mode" : ""} ${panel ? "has-panel" : ""}`}
    >
      <input
        type="file"
        accept=".txt,.json"
        hidden
        ref={file}
        onChange={(e) => {
          if (e.target.files?.[0]) void importFile(e.target.files[0]);
          e.target.value = "";
        }}
      />
      <header className="topbar">
        <nav className="main-nav" aria-label="Main navigation">
          <button
            onClick={() => {
              setLibrary(false);
              setPanel("connection");
            }}
          >
            AI
          </button>
          <button disabled={busy} onClick={() => setLibrary(!library)}>
            My stories
          </button>
          <button
            disabled={busy}
            onClick={() => {
              store.add();
              setLibrary(false);
            }}
          >
            New
          </button>
          <button
            onClick={() => {
              setLibrary(false);
              setPanel("history");
            }}
          >
            Save / Load
          </button>
        </nav>
        {!library && (
          <input
            className="document-name"
            aria-label="Story title"
            value={story.title}
            disabled={busy}
            onChange={(e) => patch({ title: e.target.value })}
          />
        )}
        <div className="top-actions">
          <span className="saved">
            {store.saveError
              ? "Save failed"
              : store.saving
                ? "Saving…"
                : "Saved"}
          </span>
          <button
            className="connection-pill"
            onClick={() => {
              setLibrary(false);
              setPanel("connection");
            }}
          >
            {
              {
                kobold: "KoboldCpp",
                openai: "OpenAI compatible",
                horde: "AI Horde",
                openrouter: "OpenRouter",
              }[story.connection.kind]
            }
          </button>
          <button
            className="icon"
            aria-label={dark ? "Light mode" : "Dark mode"}
            onClick={() => {
              setDark(!dark);
              void storage.setPref("appearance-compact", {
                dark: !dark,
                font,
                width,
              });
            }}
          >
            {dark ? <Sun size={16} /> : <Moon size={16} />}
          </button>
        </div>
      </header>
      {(error || store.saveError) && (
        <div className="banner error" role="alert">
          {error || store.saveError}
          <button
            className="icon"
            aria-label="Dismiss error"
            onClick={() => setError("")}
          >
            <X size={16} />
          </button>
        </div>
      )}
      {notice && (
        <div className="banner" role="status">
          {notice}
          <button
            className="icon"
            aria-label="Dismiss notice"
            onClick={() => setNotice("")}
          >
            <X size={16} />
          </button>
        </div>
      )}
      {library ? (
        <main className="library">
          <div className="library-heading">
            <div>
              <h1>My stories</h1>
            </div>
            <div className="row">
              <button onClick={() => file.current?.click()}>
                <Upload size={16} /> Import
              </button>
              <button
                className="primary"
                onClick={() => {
                  store.add();
                  setLibrary(false);
                }}
              >
                <Plus size={16} /> New story
              </button>
            </div>
          </div>
          <div className="story-grid">
            {[...store.stories]
              .sort((a, b) => b.modified - a.modified)
              .map((s) => (
                <article className="story-card" key={s.id}>
                  <button
                    className="story-open"
                    onClick={() => {
                      store.select(s.id);
                      setLibrary(false);
                    }}
                  >
                    <BookOpen size={25} />
                    <small>{s.parent ? "BRANCH" : "MANUSCRIPT"}</small>
                    <h2>{s.title}</h2>
                    <p>{s.text.slice(0, 220) || "Empty document"}</p>
                  </button>
                  <div className="story-meta">
                    <small>
                      {new Date(s.modified).toLocaleDateString()} ·{" "}
                      {s.text.trim() ? s.text.trim().split(/\s+/).length : 0}{" "}
                      words
                    </small>
                    <button
                      className="icon"
                      aria-label={"Duplicate " + s.title}
                      onClick={() =>
                        store.add({ ...s, title: s.title + " · copy" })
                      }
                    >
                      <Copy size={15} />
                    </button>
                    <button
                      className="icon"
                      aria-label={"Delete " + s.title}
                      onClick={() => {
                        if (
                          confirm(`Delete “${s.title}”? This cannot be undone.`)
                        )
                          void store.remove(s.id);
                      }}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </article>
              ))}
          </div>
        </main>
      ) : (
        <>
          <div className="workspace">
            <main className="manuscript">
              <div className="editor-toolbar">
                <div className="row">
                  <div className="tool-links">
                    {tabs.map((t) => (
                      <button
                        key={t.id}
                        aria-label={t.label}
                        className={panel === t.id ? "active" : ""}
                        onClick={() => setPanel(panel === t.id ? null : t.id)}
                      >
                        <t.icon size={15} />
                        <span>
                          {t.id === "notes"
                            ? "Notes"
                            : t.id === "prompt"
                              ? "Prompt"
                              : t.label}
                        </span>
                        {t.id === "notes" && pending.length > 0 && (
                          <b>{pending.length}</b>
                        )}
                      </button>
                    ))}
                  </div>
                  <button
                    className="icon"
                    aria-label="Undo"
                    disabled={busy || !story.past.length}
                    onClick={store.undo}
                  >
                    <Undo2 size={17} />
                  </button>
                  <button
                    className="icon"
                    aria-label="Redo"
                    disabled={busy || !story.future.length}
                    onClick={store.redo}
                  >
                    <Redo2 size={17} />
                  </button>
                </div>
                <div className="row">
                  <button
                    className="icon"
                    aria-label="Search story"
                    onClick={() => setSearching(!searching)}
                  >
                    <Search size={17} />
                  </button>
                  <button
                    className="icon"
                    aria-label="Create snapshot"
                    disabled={busy}
                    onClick={snapshot}
                  >
                    <Camera size={17} />
                  </button>
                  <button
                    className="icon"
                    aria-label="Focus mode"
                    onClick={() => setFocus(!focus)}
                  >
                    {focus ? <Minimize2 size={17} /> : <Maximize2 size={17} />}
                  </button>
                  <button
                    className="icon"
                    aria-label="Toggle notebook"
                    onClick={() => setPanel(panel ? null : "notes")}
                  >
                    {panel ? (
                      <PanelRightClose size={17} />
                    ) : (
                      <PanelRightOpen size={17} />
                    )}
                  </button>
                </div>
              </div>
              {searching && (
                <div className="searchbar">
                  <Search size={16} />
                  <input
                    aria-label="Search within story"
                    autoFocus
                    placeholder="Find in your story…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") findNext();
                    }}
                  />
                  <button onClick={findNext}>Find next</button>
                  <button
                    className="icon"
                    aria-label="Close search"
                    onClick={() => setSearching(false)}
                  >
                    <X size={16} />
                  </button>
                </div>
              )}
              <div className="editor-scroll">
                <div className="paper" style={{ maxWidth: width }}>
                  <textarea
                    ref={editor}
                    className="story-editor"
                    aria-label="Story manuscript"
                    placeholder="Write here…"
                    spellCheck
                    value={story.text}
                    readOnly={busy}
                    style={{ fontSize: font }}
                    onChange={(e) => store.edit(e.target.value)}
                    onKeyDown={(e) => {
                      if (
                        (e.ctrlKey || e.metaKey) &&
                        e.key.toLowerCase() === "z"
                      ) {
                        e.preventDefault();
                        if (!busy) (e.shiftKey ? store.redo : store.undo)();
                      }
                    }}
                  />
                </div>
              </div>
              <div className="compose-dock">
                <span className="document-status">
                  {busy ? phase + "…" : words.toLocaleString() + " words"}
                </span>
                <div className="dock-actions">
                  <button
                    className="retry"
                    disabled={
                      busy ||
                      !story.segments.length ||
                      story.text !== story.segments.at(-1)?.after
                    }
                    onClick={() => void generate(true)}
                    title="Regenerate the latest unchanged continuation"
                  >
                    <RotateCcw size={16} />
                    <span>Retry</span>
                  </button>
                  {busy ? (
                    <button className="primary" onClick={stop}>
                      <Square size={15} /> Stop
                    </button>
                  ) : (
                    <button
                      className="primary continue"
                      onClick={() => void generate()}
                    >
                      Continue <kbd>Ctrl ↵</kbd>
                    </button>
                  )}
                </div>
              </div>
            </main>
            {panel && (
              <>
                <button
                  className="drawer-backdrop"
                  aria-label="Close panel"
                  onClick={() => setPanel(null)}
                />
                <aside className="side-panel">
                  <div className="panel-close">
                    <button
                      className="icon"
                      aria-label="Close writing tools"
                      onClick={() => setPanel(null)}
                    >
                      <X size={17} />
                    </button>
                  </div>
                  <div className="panel-body">
                    <fieldset disabled={busy} className="panel-fieldset">
                      {panel === "notes" && (
                        <NotesPanel
                          story={story}
                          patch={patch}
                          pending={pending}
                          accept={accept}
                          reject={() => setPending([])}
                        />
                      )}
                      {panel === "context" && (
                        <ContextPanel story={story} patch={patch} />
                      )}
                      {panel === "lore" && (
                        <LorebookEditor story={story} patch={patch} />
                      )}
                      {panel === "connection" && (
                        <ConnectionPanel
                          story={story}
                          patch={patch}
                          apiKey={apiKey}
                          setKey={(key) =>
                            setKeys({ ...keys, [story.connection.kind]: key })
                          }
                          onStatus={setStatus}
                        />
                      )}
                      {panel === "settings" && (
                        <>
                          <GenerationSettings story={story} patch={patch} />
                          <details className="appearance-compact">
                            <summary>Writing appearance</summary>
                            <label className="field">
                              <span>Font size · {font}px</span>
                              <input
                                type="range"
                                min="12"
                                max="30"
                                value={font}
                                onChange={(e) => {
                                  setFont(+e.target.value);
                                  void storage.setPref("appearance-compact", {
                                    dark,
                                    font: +e.target.value,
                                    width,
                                  });
                                }}
                              />
                            </label>
                            <label className="field">
                              <span>Page width · {width}px</span>
                              <input
                                type="range"
                                min="480"
                                max="2000"
                                step="20"
                                value={width}
                                onChange={(e) => {
                                  setWidth(+e.target.value);
                                  void storage.setPref("appearance-compact", {
                                    dark,
                                    font,
                                    width: +e.target.value,
                                  });
                                }}
                              />
                            </label>
                          </details>
                        </>
                      )}
                      {panel === "prompt" && (
                        <PromptInspector
                          story={story}
                          lastPrompt={lastPrompt}
                          patch={patch}
                        />
                      )}
                      {panel === "history" && (
                        <>
                          <h2>History & files</h2>

                          <div className="row">
                            <button onClick={snapshot}>
                              <Camera size={16} /> Snapshot
                            </button>
                            <button onClick={branch}>
                              <GitBranch size={16} /> Branch
                            </button>
                          </div>
                          <h3>Snapshots</h3>
                          {story.snapshots.length === 0 && (
                            <p className="help">
                              Save a snapshot before taking a new direction.
                            </p>
                          )}
                          {[...story.snapshots].reverse().map((s) => (
                            <section className="context-card" key={s.id}>
                              <strong>{s.title}</strong>
                              <p>{new Date(s.at).toLocaleString()}</p>
                              <p>{s.text.slice(-100)}</p>
                              <button
                                onClick={() => {
                                  patch({
                                    text: s.text,
                                    notes: structuredClone(s.notes),
                                    past: [...story.past, story.text],
                                    future: [],
                                  });
                                  setPending([]);
                                  setNotice(
                                    "Snapshot restored with its notes.",
                                  );
                                }}
                              >
                                Restore
                              </button>
                            </section>
                          ))}
                          <h3>AI continuations · {story.segments.length}</h3>
                          {[...story.segments].reverse().map((s) => (
                            <details key={s.id}>
                              <summary>
                                {new Date(s.at).toLocaleString()}
                              </summary>
                              <p>{s.after.slice(s.before.length)}</p>
                              <button
                                onClick={() => {
                                  store.add({
                                    ...story,
                                    title: story.title + " · branch",
                                    parent: story.id,
                                    text: s.after,
                                    notes:
                                      s.notesAfter ||
                                      s.notesBefore ||
                                      story.notes,
                                    past: [],
                                    future: [],
                                    segments: story.segments.slice(
                                      0,
                                      story.segments.indexOf(s) + 1,
                                    ),
                                  });
                                  setPending([]);
                                }}
                              >
                                Branch from here
                              </button>
                            </details>
                          ))}
                          <h3>Import / Export</h3>
                          <div className="export-actions">
                            <button
                              onClick={() =>
                                download(
                                  story.title + ".txt",
                                  story.text,
                                  "text/plain",
                                )
                              }
                            >
                              <Download size={16} /> Plain text
                            </button>
                            <button
                              onClick={() =>
                                download(
                                  story.title + ".json",
                                  exportProject(story),
                                  "application/json",
                                )
                              }
                            >
                              <Download size={16} /> Full project
                            </button>
                            <button onClick={() => file.current?.click()}>
                              <Upload size={16} /> Import story
                            </button>
                          </div>
                        </>
                      )}
                    </fieldset>
                  </div>
                  <div className="panel-bottom">
                    <span>CONTEXT</span>
                    <button onClick={() => setPanel("prompt")}>
                      ≈ {prompt?.total.toLocaleString()} /{" "}
                      {story.settings.context.toLocaleString()} tokens{" "}
                      <Code2 size={14} />
                    </button>
                  </div>
                </aside>
              </>
            )}
          </div>
          {focus && (
            <button className="exit-focus" onClick={() => setFocus(false)}>
              <Minimize2 size={16} /> Exit focus <kbd>Esc</kbd>
            </button>
          )}
        </>
      )}
      {panel === "connection" && !library && (
        <div className="connection-status" role="status">
          {status}
        </div>
      )}
    </div>
  );
}
