import { create } from "zustand";
import { newStory, uid, type Story } from "./types";
import { storage } from "./storage/stories";
interface State {
  stories: Story[];
  current: string;
  ready: boolean;
  saving: boolean;
  saveError: string;
  init: () => Promise<void>;
  patch: (patch: Partial<Story>) => void;
  edit: (text: string) => void;
  undo: () => void;
  redo: () => void;
  add: (story?: Story) => void;
  select: (id: string) => void;
  remove: (id: string) => Promise<void>;
  flush: () => Promise<void>;
}
let queue = Promise.resolve();
let initialization: Promise<void> | undefined;
let queued = 0;
let lastEdit:
  { storyId: string; text: string; at: number; kind: string } | undefined;
function persist(story: Story) {
  queued++;
  useStore.setState({ saving: true });
  queue = queue
    .then(() => storage.save(story))
    .then(() => {
      useStore.setState({ saveError: "" });
    })
    .catch(() => {
      useStore.setState({
        saveError: "Local save failed. Export your project to keep your work.",
      });
    })
    .finally(() => {
      queued--;
      useStore.setState({ saving: queued > 0 });
    });
}
export const useStore = create<State>((set, get) => ({
  stories: [],
  current: "",
  ready: false,
  saving: false,
  saveError: "",
  init: () =>
    (initialization ??= (async () => {
      try {
        let stories = await storage.all();
        if (!stories.length) {
          stories = [newStory(true)];
          await storage.save(stories[0]);
        }
        set({
          stories,
          current: [...stories].sort((a, b) => b.modified - a.modified)[0].id,
          ready: true,
        });
      } catch {
        const story = newStory();
        set({
          ready: true,
          saveError: "Local storage unavailable. Your work is not being saved.",
          stories: [story],
          current: story.id,
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
    const s = story
      ? { ...structuredClone(story), id: uid(), modified: Date.now() }
      : newStory();
    set((x) => ({ stories: [...x.stories, s], current: s.id }));
    persist(s);
  },
  select: (current) => {
    lastEdit = undefined;
    set({ current });
  },
  remove: async (id) => {
    await queue;
    await storage.remove(id);
    set((s) => ({ stories: s.stories.filter((x) => x.id !== id) }));
    if (!get().stories.length) get().add();
    else if (get().current === id) set({ current: get().stories[0].id });
  },
  flush: async () => {
    await queue;
  },
}));
