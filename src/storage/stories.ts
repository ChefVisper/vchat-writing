import { openDB } from "idb";
import type { Story } from "../types";
const db = openDB("margin-writing", 1, {
  upgrade(db) {
    db.createObjectStore("stories", { keyPath: "id" });
    db.createObjectStore("preferences");
  },
});
export const storage = {
  all: async () =>
    ((await db).getAll("stories") as Promise<Story[]>).then((stories) =>
      stories.map((story) => ({
        ...story,
        settings: {
          ...story.settings,
          inputTokens: story.settings.inputTokens ?? story.settings.context,
        },
      })),
    ),
  save: async (s: Story) => (await db).put("stories", s),
  remove: async (id: string) => (await db).delete("stories", id),
  pref: async (key: string) => (await db).get("preferences", key),
  setPref: async (key: string, value: unknown) =>
    (await db).put("preferences", value, key),
};
