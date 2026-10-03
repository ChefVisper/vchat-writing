import { useEffect, useLayoutEffect, useState, useRef, useMemo } from "react";
import {
  BookOpen,
  Brain,
  PersonStanding,
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
import {
  uid,
  type Story,
  type Note,
  type Connection,
  type Thought,
  newStory,
  noteConnection,
} from "./types";
import {
  credentialId,
  readCredentials,
  saveCredentials,
} from "./storage/credentials";
import { storage } from "./storage/stories";
import { buildPrompt } from "./context/promptBuilder";
import { providers } from "./providers";
import {
  retryBase,
  cleanContinuation,
  trimIncomplete,
  branchTitle,
} from "./generation/history";
import { buildRewritePrompt } from "./generation/rewrite";
import {
  validateUpdates,
  applyUpdate,
  buildNotePrompt,
  type Update,
} from "./generation/stateUpdater";
import { exportProject, importProject, download } from "./storage/transfer";
import { NotesPanel } from "./components/NotesPanel";
import { ContextPanel, LorebookEditor } from "./components/ContextPanel";
import {
  ConnectionsPanel,
  GenerationSettings,
} from "./components/GenerationSettings";
import { PromptInspector } from "./components/PromptInspector";
import { ThinkingPanel } from "./components/ThinkingPanel";
import { BodyPanel } from "./components/BodyPanel";
import {
  ManuscriptEditor,
  type ManuscriptHandle,
} from "./components/ManuscriptEditor";
const tabs = [
  { id: "body", label: "Body", icon: PersonStanding },
  { id: "thinking", label: "Thinking", icon: Brain },
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
  const [rewrite, setRewrite] = useState<{
    id: string;
    from: number;
    to: number;
    text: string;
    original: string;
  } | null>(null);
  const [rewriteInstruction, setRewriteInstruction] = useState(
    "Improve clarity and flow while preserving meaning, tone and events.",
  );
  const [rewriteDraft, setRewriteDraft] = useState("");
  const [countText, setCountText] = useState("");
  const [keys, setKeys] = useState<Record<string, string>>(readCredentials);
  const setCredential = (id: string, value: string) => {
    const next = { ...keys, [id]: value };
    if (!value) delete next[id];
    setKeys(next);
    try {
      saveCredentials(next);
    } catch {
      setError(
        "This browser could not save the key. It will last only for this session.",
      );
    }
  };
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
  const activeRequest = useRef<{ connection: Connection; key: string } | null>(
    null,
  );
  const nativeAbort = useRef<Promise<unknown>>(Promise.resolve());
  const editor = useRef<ManuscriptHandle>(null);
  const followGeneration = useRef(false);
  const settleScroll = useRef(false);
  const scrollEditorToBottom = () => {
    requestAnimationFrame(() => {
      editor.current?.scrollToEnd();
    });
  };
  const file = useRef<HTMLInputElement>(null);
  const current = () =>
    useStore
      .getState()
      .stories.find((x) => x.id === useStore.getState().current)!;
  const apiKey = story ? keys[credentialId(story.connection)] || "" : "";
  useEffect(() => {
    void store.init();
    const flush = () => {
      void useStore.getState().flush();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", flush);
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
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", flush);
    };
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
  }, [dark]);
  useEffect(() => {
    setLastPrompt("");
    setRewrite(null);
    setRewriteDraft("");
    setError("");
    setStatus("Not connected");
  }, [store.current]);
  useLayoutEffect(() => {
    if (!followGeneration.current || !editor.current) return;
    editor.current.scrollToEnd();
    const frame = requestAnimationFrame(() => {
      editor.current?.scrollToEnd();
    });
    return () => cancelAnimationFrame(frame);
  }, [story?.text]);
  useEffect(() => {
    editor.current?.scrollToEnd();
  }, [store.current]);
  useLayoutEffect(() => {
    if (!busy && settleScroll.current) {
      settleScroll.current = false;
      scrollEditorToBottom();
    }
  }, [busy]);
  const prompt = useMemo(
    () => (story && panel === "prompt" && !busy ? buildPrompt(story) : null),
    [story, panel, busy],
  );
  useEffect(() => {
    const timer = setTimeout(() => setCountText(story?.text ?? ""), 250);
    return () => clearTimeout(timer);
  }, [story?.text]);
  const words = useMemo(
    () => (countText.trim() ? countText.trim().split(/\s+/).length : 0),
    [countText],
  );
  function openRewrite() {
    const selection = editor.current?.selection();
    if (!selection) {
      setNotice("Select the passage you want to rewrite first.");
      return;
    }
    setRewrite({ ...selection, id: current().id, original: current().text });
    setRewriteDraft("");
    setError("");
    setPanel("rewrite");
  }
  function captureThinking(
    purpose: Thought["purpose"],
    connection: Connection,
  ) {
    const storyId = current().id,
      id = uid(),
      at = Date.now();
    let text = "",
      timer: ReturnType<typeof setTimeout> | undefined;
    const save = () => {
      timer = undefined;
      if (!text || current().id !== storyId) return;
      const all = current().thoughts ?? [],
        previous = all.find((t) => t.id === id);
      const record: Thought = {
        id,
        at,
        model: connection.model,
        provider: connection.kind,
        purpose,
        text,
        selected: previous?.selected ?? false,
      };
      patch({
        thoughts: previous
          ? all.map((t) => (t.id === id ? record : t))
          : [...all, record],
      });
    };
    return {
      onReasoning: (token: string) => {
        text += token;
        if (!timer) timer = setTimeout(save, 80);
      },
      finish: () => {
        clearTimeout(timer);
        save();
      },
    };
  }
  async function generateRewrite() {
    if (busy || controller.current || !rewrite) return;
    const s = current();
    if (s.id !== rewrite.id || s.text !== rewrite.original) {
      setError("The manuscript changed. Select the passage again.");
      return;
    }
    setError("");
    setNotice("");
    setRewriteDraft("");
    setBusy(true);
    setPhase("Rewriting");
    const c = new AbortController();
    controller.current = c;
    activeRequest.current = { connection: s.connection, key: apiKey };
    nativeAbort.current = Promise.resolve();
    let raw = "",
      timer: ReturnType<typeof setTimeout> | undefined;
    const thoughts = captureThinking("rewrite", s.connection);
    try {
      const prompt = buildRewritePrompt(
        s,
        rewrite.from,
        rewrite.to,
        rewriteInstruction,
      );
      await providers[s.connection.kind].generate({
        prompt,
        connection: s.connection,
        key: apiKey,
        purpose: "rewrite",
        onReasoning: thoughts.onReasoning,
        settings: { ...s.settings, stops: "" },
        signal: c.signal,
        onToken: (token) => {
          raw += token;
          if (!timer)
            timer = setTimeout(() => {
              timer = undefined;
              setRewriteDraft(cleanContinuation(raw));
            }, 80);
        },
      });
      if (!raw.trim())
        throw new Error(
          "No replacement text returned. Try a larger Writing Output.",
        );
    } catch (e) {
      if (!c.signal.aborted)
        setError(e instanceof Error ? e.message : "Rewrite failed.");
    } finally {
      clearTimeout(timer);
      thoughts.finish();
      const clean = cleanContinuation(raw);
      setRewriteDraft(
        s.settings.trimIncomplete && !c.signal.aborted
          ? trimIncomplete("", clean)
          : clean,
      );
      await nativeAbort.current;
      controller.current = null;
      activeRequest.current = null;
      setBusy(false);
      setPhase("");
    }
  }
  function applyRewrite() {
    if (!rewrite || !rewriteDraft.trim()) return;
    const s = current();
    if (s.id !== rewrite.id || s.text !== rewrite.original) {
      setError(
        "The manuscript changed. Select the passage again; no text was replaced.",
      );
      return;
    }
    store.replace(
      s.text.slice(0, rewrite.from) + rewriteDraft + s.text.slice(rewrite.to),
    );
    setRewrite(null);
    setRewriteDraft("");
    setPanel(null);
    setNotice(
      "Passage replaced. Undo restores it in one step. Use Note to recheck continuity notes.",
    );
    void store.flush();
  }
  function stop() {
    controller.current?.abort();
    const active = activeRequest.current;
    if (active) {
      nativeAbort.current =
        providers[active.connection.kind]
          .abort?.(active.connection, active.key)
          .catch(() => {}) ?? Promise.resolve();
    }
  }
  async function updateNotes(force = false) {
    const now = current();
    if (
      !now.notes.some(
        (n) => n.enabled && n.aiEditable && !n.locked && n.mode !== "off",
      )
    ) {
      setNotice(
        "No editable notes. Enable AI editing and Review or Auto mode in Notebook.",
      );
      return;
    }
    setPhase("Updating notes");
    followGeneration.current = false;
    const c = new AbortController();
    controller.current = c;
    const connection = noteConnection(now);
    const key =
      keys[
        credentialId(
          connection,
          now.noteConnectionMode === "separate" ? "notes" : "writing",
        )
      ] || "";
    activeRequest.current = { connection, key };
    const prose =
      !force && now.lastUpdateText && now.text.startsWith(now.lastUpdateText)
        ? now.text.slice(now.lastUpdateText.length)
        : now.text;
    if (!prose.trim()) {
      setNotice("Notes are already up to date; no new prose to check.");
      return;
    }
    const assembled = buildNotePrompt(now, prose);
    const thoughts = captureThinking("notes", connection);
    let result: string;
    try {
      result = await providers[connection.kind].generate({
        prompt: assembled.prompt,
        connection,
        key,
        purpose: "notes",
        onReasoning: thoughts.onReasoning,
        signal: c.signal,
        settings: {
          ...now.settings,
          temperature: 0.1,
          maxTokens: now.settings.noteMaxTokens,
          thinking: now.settings.noteThinking,
          thinkingLevel: now.settings.noteThinkingLevel,
          thinkingMaxTokens: now.settings.noteThinkingMaxTokens,
          streaming: false,
          stops: "",
        },
        onToken: () => {},
      });
    } finally {
      thoughts.finish();
    }
    c.signal.throwIfAborted();
    const updates = validateUpdates(result, current().notes);
    let notes = current().notes;
    for (const update of updates)
      if (notes.find((n) => n.id === update.noteId)?.mode === "auto")
        notes = applyUpdate(notes, update);
    patch({
      notes,
      pending: updates.filter(
        (u) => notes.find((n) => n.id === u.noteId)?.mode === "review",
      ),
      lastUpdateText: now.text,
      segments: current().segments.map((x, i, all) =>
        i === all.length - 1 && x.after === now.text
          ? { ...x, notesAfter: notes }
          : x,
      ),
    });
    setNotice(
      (updates.length
        ? `${updates.length} note update(s) ${updates.some((u) => notes.find((n) => n.id === u.noteId)?.mode === "review") ? "ready for review" : "applied"}.`
        : "Notes checked. No changes needed.") +
        (assembled.trimmed
          ? ` ${assembled.trimmed} older prose characters omitted to fit Max Context.`
          : ""),
    );
  }
  async function generate(
    retry = false,
    mode: "continue" | "write" | "note" = "continue",
  ) {
    if (busy || controller.current || !story) return;
    setError("");
    setNotice("");
    if (pending.length && mode !== "write") {
      setPanel("notes");
      setError(
        "Accept or reject the pending note changes before updating notes.",
      );
      return;
    }
    let s = current();
    setBusy(true);
    settleScroll.current = mode !== "note";
    nativeAbort.current = Promise.resolve();
    try {
      if (mode === "note") {
        await updateNotes(true);
        return;
      }
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
          "Memory and notes exceed Max Context after reserving Writing Output.",
        );
      if (!/^https?:\/\//.test(s.connection.url))
        throw new Error("Enter a valid HTTP server URL in Connection.");
      const c = new AbortController();
      controller.current = c;
      activeRequest.current = { connection: s.connection, key: apiKey };
      followGeneration.current = true;
      setPhase("Writing");
      setLastPrompt(assembled.prompt);
      const originalStory = current();
      const original = originalStory.text;
      const before = s.text;
      const notesBefore = structuredClone(s.notes);
      if (retry) patch({ text: before, notes: s.notes, segments: s.segments });
      let raw = "";
      const thoughts = captureThinking("writing", s.connection);
      let timer: ReturnType<typeof setTimeout> | undefined;
      const renderDraft = () => {
        timer = undefined;
        patch({ text: before + cleanContinuation(raw) });
        scrollEditorToBottom();
      };
      try {
        await providers[s.connection.kind].generate({
          prompt: assembled.prompt,
          settings: s.settings,
          connection: s.connection,
          key: apiKey,
          purpose: "writing",
          onReasoning: thoughts.onReasoning,
          signal: c.signal,
          onToken: (token) => {
            raw += token;
            if (!timer) timer = setTimeout(renderDraft, 80);
          },
        });
        if (!cleanContinuation(raw).trim())
          throw new Error(
            "The model returned no story text. Increase Writing Output or lower Writing Thinking.",
          );
      } catch (e) {
        if (!c.signal.aborted) throw e;
      } finally {
        clearTimeout(timer);
        thoughts.finish();
        const clean = cleanContinuation(raw);
        const addition =
          s.settings.trimIncomplete && !c.signal.aborted
            ? trimIncomplete(before, clean)
            : clean;
        if (addition.length < clean.length)
          setNotice(
            addition.trim()
              ? "Incomplete final sentence trimmed."
              : "No complete sentence returned; the manuscript was kept unchanged. Increase Writing Output or disable trimming.",
          );
        if (addition.trim()) {
          const text = before + addition;
          patch({
            text,
            past: [...s.past, original].slice(-100),
            future: [],
            segments: [
              ...s.segments,
              { id: uid(), before, after: text, at: Date.now(), notesBefore },
            ],
          });
        } else if (retry) {
          patch({
            text: original,
            notes: originalStory.notes,
            segments: originalStory.segments,
          });
        } else if (raw) patch({ text: original });
        scrollEditorToBottom();
      }
      await nativeAbort.current;
      if (mode === "continue") await updateNotes();
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError"))
        setError(
          e instanceof Error
            ? e.message
            : "Generation failed. Check your connection.",
        );
    } finally {
      followGeneration.current = false;
      setBusy(false);
      setPhase("");
      controller.current = null;
      activeRequest.current = null;
      void store.flush();
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
    store.add({
      ...story,
      parent: story.id,
      title: branchTitle(story, store.stories),
    });
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
    if (query && !editor.current?.find(query)) setNotice("No matches found.");
  }
  if (!store.ready || !story)
    return (
      <div className="loading">
        <Feather /> Loading…
      </div>
    );
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
                nanogpt: "NanoGPT",
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
                  <button
                    className="icon"
                    aria-label="Rewrite selection"
                    title="Select a passage, then rewrite it"
                    disabled={busy}
                    onClick={openRewrite}
                  >
                    <Feather size={17} />
                  </button>
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
                  <ManuscriptEditor
                    key={story.id}
                    ref={editor}
                    text={story.text}
                    readOnly={busy}
                    font={font}
                    latest={
                      story.segments.at(-1)?.after === story.text
                        ? {
                            from: story.segments.at(-1)!.before.length,
                            to: story.text.length,
                          }
                        : null
                    }
                    onChange={store.edit}
                    undo={store.undo}
                    redo={store.redo}
                  />
                </div>
              </div>
              <div className="compose-dock">
                <div className="dock-left">
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
                  <span className="document-status">
                    {busy ? phase + "…" : words.toLocaleString() + " words"}
                  </span>
                </div>
                <div className="dock-actions">
                  <button
                    disabled={busy}
                    onClick={() => void generate(false, "note")}
                    title="Update notes only"
                  >
                    Note
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => void generate(false, "write")}
                    title="Write prose only"
                  >
                    Write
                  </button>
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
                      <Square size={15} />{" "}
                      {phase === "Updating notes"
                        ? "Stop notes"
                        : phase === "Rewriting"
                          ? "Stop rewriting"
                          : "Stop writing"}
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
                    {busy && phase === "Rewriting" && (
                      <button onClick={stop}>Stop rewrite</button>
                    )}
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
                      {panel === "body" && (
                        <BodyPanel key={story.id} story={story} patch={patch} />
                      )}
                      {panel === "thinking" && (
                        <ThinkingPanel story={story} patch={patch} />
                      )}
                      {panel === "rewrite" && (
                        <>
                          <h2>Rewrite selection</h2>
                          {rewrite ? (
                            <>
                              <label className="field">
                                <span>
                                  Selected passage ·{" "}
                                  {rewrite.text.length.toLocaleString()}{" "}
                                  characters
                                </span>
                                <textarea
                                  aria-label="Selected passage"
                                  readOnly
                                  value={rewrite.text.slice(0, 6000)}
                                  rows={5}
                                />
                              </label>
                              <label className="field">
                                <span>Editing instruction</span>
                                <textarea
                                  aria-label="Editing instruction"
                                  value={rewriteInstruction}
                                  onChange={(e) =>
                                    setRewriteInstruction(e.target.value)
                                  }
                                  rows={3}
                                />
                              </label>
                              <button
                                disabled={!rewriteInstruction.trim()}
                                onClick={() => void generateRewrite()}
                              >
                                Generate rewrite
                              </button>
                              <p className="help">
                                Uses the writing model and Writing Output. The
                                manuscript changes only when you apply the
                                result. Notes are not changed automatically.
                              </p>
                              {rewriteDraft && (
                                <>
                                  <label className="field">
                                    <span>Replacement preview</span>
                                    <textarea
                                      aria-label="Replacement preview"
                                      value={rewriteDraft}
                                      onChange={(e) =>
                                        setRewriteDraft(e.target.value)
                                      }
                                      rows={8}
                                    />
                                  </label>
                                  <div className="row">
                                    <button
                                      disabled={!rewriteDraft.trim()}
                                      onClick={applyRewrite}
                                    >
                                      Apply replacement
                                    </button>
                                    <button
                                      onClick={() => {
                                        setRewrite(null);
                                        setRewriteDraft("");
                                        setPanel(null);
                                      }}
                                    >
                                      Discard
                                    </button>
                                  </div>
                                </>
                              )}
                            </>
                          ) : (
                            <p>
                              Select text in the manuscript, then press Rewrite
                              selection.
                            </p>
                          )}
                        </>
                      )}
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
                        <ConnectionsPanel
                          story={story}
                          patch={patch}
                          keys={keys}
                          setCredential={setCredential}
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
                      {panel === "prompt" && !busy && (
                        <PromptInspector
                          story={story}
                          lastPrompt={lastPrompt}
                          patch={patch}
                          assembled={prompt!}
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
                                    title: branchTitle(story, store.stories),
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
                      {prompt
                        ? "≈ " + prompt.total.toLocaleString()
                        : "Context"}{" "}
                      / {story.settings.context.toLocaleString()} tokens{" "}
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
