import { openDB } from "idb";
import { defaults, upgradePromptTemplate, type Story } from "../types";
import { packStory, unpackStory } from "./compact";
const db = openDB("margin-writing", 1, {
  upgrade(db) {
    db.createObjectStore("stories", { keyPath: "id" });
    db.createObjectStore("preferences");
  },
});
export const storage = {
  all: async (): Promise<Story[]> =>
    ((await db).getAll("stories") as Promise<Story[]>).then((stories) =>
      stories.map((stored) => {
        const story =
          (stored as any).encoding === "delta-v1"
            ? unpackStory(stored as any)
            : stored;
        return {
          ...story,
          promptTemplate: upgradePromptTemplate(story.promptTemplate),
          settings: {
            ...defaults,
            ...story.settings,
          },
        };
      }),
    ),
  save: async (s: Story) => (await db).put("stories", packStory(s)),
  remove: async (id: string) => (await db).delete("stories", id),
  pref: async (key: string) => (await db).get("preferences", key),
  setPref: async (key: string, value: unknown) =>
    (await db).put("preferences", value, key),
};
