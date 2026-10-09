import { uid, type Story, type Lore, type Lorebook } from "../types";

export const newLorebook = (
  title = "Untitled lorebook",
  entries: Lore[] = [],
): Lorebook => ({ id: uid(), title, entries, modified: Date.now() });
export const selectedLore = (story: Story, library: Lorebook[] = []) => [
  ...story.lore,
  ...library
    .filter((b) => story.activeLorebooks?.includes(b.id))
    .flatMap((b) => b.entries.map((e) => ({ ...e, id: `${b.id}:${e.id}` }))),
];

// Keep the original entry IDs and settings. A deterministic ID makes interrupted
// migrations safe to retry, and the database migration commits both halves together.
export function migrateLorebooks(stories: Story[], library: Lorebook[]) {
  const books = [...library];
  let changed = false;
  const migrated = stories.map((s) => {
    if (!s.lore.length) return s;
    const id = `legacy:${s.id}`;
    if (!books.some((b) => b.id === id))
      books.push({
        id,
        title: `${s.title} lore`.slice(0, 150),
        entries: s.lore,
        modified: s.modified,
      });
    changed = true;
    return {
      ...s,
      lore: [],
      activeLorebooks: [...new Set([...(s.activeLorebooks || []), id])],
    };
  });
  return { stories: migrated, library: books, changed };
}

export function attachImportedLorebooks(story: Story, library: Lorebook[]) {
  const books = [...library];
  const remap = new Map<string, string>();
  for (const incoming of story.lorebookCopies || []) {
    const same = books.find((b) => b.id === incoming.id);
    if (
      same &&
      JSON.stringify(same.entries) === JSON.stringify(incoming.entries) &&
      same.title === incoming.title
    )
      remap.set(incoming.id, same.id);
    else {
      const copy = {
        ...structuredClone(incoming),
        id: same ? uid() : incoming.id,
      };
      books.push(copy);
      remap.set(incoming.id, copy.id);
    }
  }
  const { lorebookCopies: _copies, ...rest } = story;
  const active = (rest.activeLorebooks || [])
    .map((id) => remap.get(id) || id)
    .filter((id) => books.some((b) => b.id === id));
  return migrateLorebooks(
    [
      {
        ...rest,
        ...(story.activeLorebooks ? { activeLorebooks: active } : {}),
      },
    ],
    books,
  );
}
