import { create } from "zustand";
import { newStory, uid, type Story, type Lorebook } from "./types";
import { attachImportedLorebooks, migrateLorebooks } from "./lore/library";
import { validLorebook } from "./lore/import";
import { storage } from "./storage/stories";
interface State {
  stories: Story[];
  lorebooks: Lorebook[];
  setLorebooks: (books: Lorebook[]) => void;
  current: string;
  ready: boolean;
  saving: boolean;
  saveError: string;
  init: () => Promise<void>;
  patch: (patch: Partial<Story>) => void;
  edit: (text: string) => void;
  replace: (text: string) => void;
  undo: () => void;
  redo: () => void;
  add: (story?: Story) => void;
  select: (id: string) => void;
  remove: (id: string) => Promise<void>;
  flush: () => Promise<void>;
}
let queue = Promise.resolve();
let initialization: Promise<void> | undefined;
const pendingSaves = new Map<string, Story>();
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let savingCount = 0;
let pendingLibrary: Lorebook[] | undefined;
let lastEdit:
  { storyId: string; text: string; at: number; kind: string } | undefined;
function persist(story: Story) {
  pendingSaves.set(story.id, story);
  useStore.setState({ saving: true });
  // Coalesce typing/streaming snapshots. Never queue a full database write per token.
  if (!saveTimer) saveTimer = setTimeout(flushPending, 500);
}
function flushPending() {
  clearTimeout(saveTimer);
  saveTimer = undefined;
  const stories = [...pendingSaves.values()];
  const library = pendingLibrary;
  pendingLibrary = undefined;
  pendingSaves.clear();
  if (!stories.length && !library) return;
  savingCount++;
  queue = queue
    .then(async () => {
      if (library) await storage.saveLibrary(stories, library);
      else for (const story of stories) await storage.save(story);
    })
    .then(() => {
      useStore.setState({ saveError: "" });
    })
    .catch(() => {
      useStore.setState({
        saveError: "Local save failed. Export your project to keep your work.",
      });
    })
    .finally(() => {
      savingCount--;
      useStore.setState({
        saving: savingCount > 0 || pendingSaves.size > 0 || !!pendingLibrary,
      });
    });
}
export const useStore = create<State>((set, get) => ({
  stories: [],
  lorebooks: [],
  setLorebooks: (books) => {
    const ids = new Set(books.map((b) => b.id));
    const stories = get().stories.map((s) => {
      if (!s.activeLorebooks?.some((id) => !ids.has(id))) return s;
      const changed = {
        ...s,
        activeLorebooks: s.activeLorebooks.filter((id) => ids.has(id)),
      };
      pendingSaves.set(s.id, changed);
      return changed;
    });
    set({ lorebooks: books, stories });
    pendingLibrary = books;
    set({ saving: true });
    if (!saveTimer) saveTimer = setTimeout(flushPending, 500);
  },
  current: "",
  ready: false,
  saving: false,
  saveError: "",
  init: () =>
    (initialization ??= (async () => {
      let stories: Story[] = [];
      try {
        stories = await storage.all();
        const savedBooks = await storage.pref("lorebooks");
        if (
          savedBooks !== undefined &&
          (!Array.isArray(savedBooks) || !savedBooks.every(validLorebook))
        )
          throw new Error("Invalid saved lorebook library.");
        const migrated = migrateLorebooks(stories, savedBooks || []);
        if (migrated.changed)
          await storage.saveLibrary(migrated.stories, migrated.library);
        stories = migrated.stories;
        if (!stories.length) {
          stories = [newStory(true)];
          await storage.save(stories[0]);
        }
        set({
          stories,
          lorebooks: migrated.library,
          current: [...stories].sort((a, b) => b.modified - a.modified)[0].id,
          ready: true,
        });
      } catch {
        const story = newStory();
        set({
          ready: true,
          saveError: "Local storage unavailable. Your work is not being saved.",
          stories: stories.length ? stories : [story],
          current: stories.length ? stories[0].id : story.id,
        });
      }
    })()),
  patch: (patch) => {
    set((s) => ({
      stories: s.stories.map((x) =>
        x.id === s.current ? { ...x, ...patch, modified: Date.now() } : x,
      ),
    }));
    persist(get().stories.find((s) => s.id === get().current)!);
  },
  edit: (text) => {
    const s = get().stories.find((x) => x.id === get().current)!;
    if (text === s.text) return;
    const kind = text.length > s.text.length ? "insert" : "delete";
    const contiguous =
      (kind === "insert" && text.length === s.text.length + 1) ||
      (kind === "delete" && text.length === s.text.length - 1);
    const grouped =
      lastEdit?.storyId === s.id &&
      lastEdit.text === s.text &&
      lastEdit.kind === kind &&
      Date.now() - lastEdit.at < 1000 &&
      contiguous &&
      !text.endsWith("\n") &&
      !s.text.endsWith("\n");
    get().patch({
      text,
      past: grouped ? s.past : [...s.past, s.text].slice(-100),
      future: [],
    });
    lastEdit = { storyId: s.id, text, at: Date.now(), kind };
  },
  replace: (text) => {
    lastEdit = undefined;
    get().edit(text);
    lastEdit = undefined;
  },
  undo: () => {
    lastEdit = undefined;
    const s = get().stories.find((x) => x.id === get().current)!;
    if (!s.past.length) return;
    const target = s.past.at(-1)!;
    const segment = s.segments.findLast(
      (x) => x.after === s.text && x.before === target,
    );
    get().patch({
      text: target,
      past: s.past.slice(0, -1),
      future: [s.text, ...s.future],
      ...(segment?.notesBefore
        ? { notes: structuredClone(segment.notesBefore), pending: [] }
        : {}),
    });
  },
  redo: () => {
    lastEdit = undefined;
    const s = get().stories.find((x) => x.id === get().current)!;
    if (!s.future.length) return;
    const segment = s.segments.findLast(
      (x) => x.before === s.text && x.after === s.future[0],
    );
    get().patch({
      text: s.future[0],
      future: s.future.slice(1),
      past: [...s.past, s.text],
      ...(segment?.notesAfter
        ? { notes: structuredClone(segment.notesAfter), pending: [] }
        : {}),
    });
  },
  add: (story) => {
    let s = story ? { ...story, id: uid(), modified: Date.now() } : newStory();
    const attached = attachImportedLorebooks(s, get().lorebooks);
    s = attached.stories[0];
    if (attached.library.length !== get().lorebooks.length)
      get().setLorebooks(attached.library);
    set((x) => ({ stories: [...x.stories, s], current: s.id }));
    persist(s);
  },
  select: (current) => {
    lastEdit = undefined;
    set({ current });
  },
  remove: async (id) => {
    flushPending();
    await queue;
    await storage.remove(id);
    set((s) => ({ stories: s.stories.filter((x) => x.id !== id) }));
    if (!get().stories.length) get().add();
    else if (get().current === id) set({ current: get().stories[0].id });
  },
  flush: async () => {
    flushPending();
    await queue;
  },
}));
