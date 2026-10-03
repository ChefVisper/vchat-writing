import type { Story, Note, Revision } from "../types";

type Document =
  string | { base: number; keep: number; tail: number; insert: string };
interface Ref {
  $doc: number;
}
export interface PackedStory {
  id: string;
  encoding: "delta-v1";
  documents: Document[];
  story: unknown;
  revisions?: Revision[];
  noteSnapshots?: unknown[];
}

// A manuscript appears once. Undo states, AI passages and snapshots share it,
// storing only their changed span. This preserves the complete history.
export function packStory(story: Story): PackedStory {
  const documents: Document[] = [story.text];
  const ids = new Map<string, number>([[story.text, 0]]);
  const revisions: Revision[] = [],
    noteSnapshots: unknown[] = [];
  const revisionIds = new Map<string, number>(),
    noteIds = new Map<string, number>();
  const notes = (value: Note[]) =>
    value.map((n) => ({
      ...n,
      revisions: n.revisions.map((r) => {
        const key = JSON.stringify(r);
        let id = revisionIds.get(key);
        if (id === undefined) {
          id = revisions.length;
          revisions.push(r);
          revisionIds.set(key, id);
        }
        return { $revision: id };
      }),
    }));
  const noteSnapshot = (value: Note[]) => {
    const encoded = notes(value),
      key = JSON.stringify(encoded);
    let id = noteIds.get(key);
    if (id === undefined) {
      id = noteSnapshots.length;
      noteSnapshots.push(encoded);
      noteIds.set(key, id);
    }
    return { $notes: id };
  };
  const reference = (text: string): Ref => {
    const known = ids.get(text);
    if (known !== undefined) return { $doc: known };
    const base = story.text;
    let keep = 0,
      tail = 0;
    if (base.startsWith(text) || text.startsWith(base))
      keep = Math.min(base.length, text.length);
    else {
      while (
        keep < base.length &&
        keep < text.length &&
        base.charCodeAt(keep) === text.charCodeAt(keep)
      )
        keep++;
      while (
        tail < base.length - keep &&
        tail < text.length - keep &&
        base.charCodeAt(base.length - tail - 1) ===
          text.charCodeAt(text.length - tail - 1)
      )
        tail++;
    }
    const insert = text.slice(keep, text.length - tail);
    const id = documents.length;
    documents.push(
      insert.length + 60 < text.length ? { base: 0, keep, tail, insert } : text,
    );
    ids.set(text, id);
    return { $doc: id };
  };
  return {
    id: story.id,
    encoding: "delta-v1",
    documents,
    revisions,
    noteSnapshots,
    story: {
      ...story,
      text: reference(story.text),
      lastUpdateText: reference(story.lastUpdateText),
      past: story.past.map(reference),
      future: story.future.map(reference),
      notes: notes(story.notes),
      segments: story.segments.map((s) => ({
        ...s,
        before: reference(s.before),
        after: reference(s.after),
        notesBefore: s.notesBefore ? noteSnapshot(s.notesBefore) : undefined,
        notesAfter: s.notesAfter ? noteSnapshot(s.notesAfter) : undefined,
      })),
      snapshots: story.snapshots.map((s) => ({
        ...s,
        text: reference(s.text),
        notes: noteSnapshot(s.notes),
      })),
    },
  };
}

export function unpackStory(packed: PackedStory): Story {
  if (
    packed.encoding !== "delta-v1" ||
    !Array.isArray(packed.documents) ||
    packed.documents.length > 10000
  )
    throw new Error("Invalid compact project.");
  const documents: string[] = [];
  let expanded = 0;
  for (const item of packed.documents) {
    let text: string;
    if (typeof item === "string") text = item;
    else {
      const base = documents[item?.base];
      if (
        typeof base !== "string" ||
        !Number.isInteger(item.base) ||
        item.base < 0 ||
        !Number.isInteger(item.keep) ||
        !Number.isInteger(item.tail) ||
        item.keep < 0 ||
        item.tail < 0 ||
        item.keep + item.tail > base.length ||
        typeof item.insert !== "string"
      )
        throw new Error("Invalid document delta.");
      text =
        base.slice(0, item.keep) +
        item.insert +
        (item.tail ? base.slice(-item.tail) : "");
    }
    expanded += text.length;
    if (expanded > 256 * 1024 * 1024)
      throw new Error("Project history is too large to load safely.");
    documents.push(text);
  }
  const resolve = (ref: Ref | string): string => {
    if (typeof ref === "string") return ref; // Allows editing a project file by hand.
    if (
      !ref ||
      !Number.isInteger(ref.$doc) ||
      typeof documents[ref.$doc] !== "string"
    )
      throw new Error("Invalid document reference.");
    return documents[ref.$doc];
  };
  const s = packed.story as any;
  if (!s || ![s.past, s.future, s.segments, s.snapshots].every(Array.isArray))
    throw new Error("Invalid project history.");
  const notes = (value: any): Note[] => {
    if (!Array.isArray(value) && !Number.isInteger(value?.$notes))
      throw new Error("Invalid note snapshot reference.");
    const list = Array.isArray(value)
      ? value
      : packed.noteSnapshots?.[value?.$notes];
    if (!Array.isArray(list)) throw new Error("Invalid note snapshot.");
    return list.map((n) => {
      if (!Array.isArray(n?.revisions))
        throw new Error("Invalid note revisions.");
      return {
        ...n,
        revisions: n.revisions.map((r: any) => {
          if (r && "$revision" in r) {
            if (
              !Number.isInteger(r.$revision) ||
              !packed.revisions?.[r.$revision]
            )
              throw new Error("Invalid note revision reference.");
            return packed.revisions[r.$revision];
          }
          return r;
        }),
      };
    });
  };
  return {
    ...s,
    text: resolve(s.text),
    lastUpdateText: resolve(s.lastUpdateText),
    past: s.past.map(resolve),
    future: s.future.map(resolve),
    notes: notes(s.notes),
    segments: s.segments.map((x: any) => ({
      ...x,
      before: resolve(x.before),
      after: resolve(x.after),
      notesBefore: x.notesBefore ? notes(x.notesBefore) : undefined,
      notesAfter: x.notesAfter ? notes(x.notesAfter) : undefined,
    })),
    snapshots: s.snapshots.map((x: any) => ({
      ...x,
      text: resolve(x.text),
      notes: notes(x.notes),
    })),
  };
}
