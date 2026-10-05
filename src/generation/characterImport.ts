import { newLore, type Lore } from "../types";
import type { CreationResult } from "./creation";

export interface CharacterImport {
  result: CreationResult;
  author: string;
  lore: Lore[];
  source: string;
  creatorNotes: string;
}
const text = (value: unknown, max = 100000): string => {
  if (value == null) return "";
  if (typeof value !== "string" || value.length > max)
    throw new Error("Character card has invalid or oversized text.");
  return value;
};

export function chubPath(input: string) {
  let u: URL;
  try {
    u = new URL(
      input.includes("://") ? input.trim() : `https://${input.trim()}`,
    );
  } catch {
    throw new Error(
      "Enter a Chub character link, such as chub.ai/characters/author/name.",
    );
  }
  if (
    ![
      "chub.ai",
      "www.chub.ai",
      "characterhub.org",
      "www.characterhub.org",
    ].includes(u.hostname.toLowerCase()) ||
    !["https:", "http:"].includes(u.protocol) ||
    u.username ||
    u.password ||
    u.port
  )
    throw new Error(
      "Link import currently supports public Chub / CharacterHub characters only.",
    );
  const parts = u.pathname.split("/").filter(Boolean);
  if (parts[0] === "characters") parts.shift();
  if (
    parts.length !== 2 ||
    parts.some((p) => !/^[a-zA-Z0-9_-]+$/.test(p) || p.length > 200) ||
    ["presets", "lorebooks", "users"].includes(parts[0])
  )
    throw new Error(
      "Use a character link with an author and character name, not a profile or preset link.",
    );
  return parts.join("/");
}

export function mapCharacterCard(raw: unknown, source = ""): CharacterImport {
  if (!raw || typeof raw !== "object")
    throw new Error("No character data found.");
  const payload = raw as any;
  const definition = payload.node?.definition;
  if (payload.errors?.length || (payload.node && !definition))
    throw new Error("This character is unavailable or private.");
  const d = definition
    ? {
        name: definition.name,
        description: definition.personality,
        personality: definition.tavern_personality,
        scenario: definition.scenario,
        first_mes: definition.first_message,
        mes_example: definition.example_dialogs,
        creator_notes: definition.description,
        system_prompt: definition.system_prompt,
        post_history_instructions: definition.post_history_instructions,
        alternate_greetings: definition.alternate_greetings,
        character_book: definition.embedded_lorebook,
      }
    : payload.data || payload;
  const name = text(d.name, 150).trim();
  if (!name) throw new Error("No character name found in this card.");
  const fields = [
    ["Description", text(d.description)],
    ["Personality", text(d.personality)],
    ["Scenario", text(d.scenario)],
    ["Example dialogue", text(d.mes_example)],
  ].filter(([, value]) => value.trim());
  const memory = `Character: ${name}\nRole: {{char}}; reader: {{user}}${fields.map(([label, value]) => `\n\n${label}:\n${value}`).join("")}`;
  if (memory.length > 100000)
    throw new Error("Combined character memory is too large.");
  const greetings = d.alternate_greetings ?? [];
  if (!Array.isArray(greetings) || greetings.length > 99)
    throw new Error("Invalid alternate greetings (maximum 99).");
  const alternateGreetings = greetings
    .map((g) => text(g))
    .filter((g) => g.trim());
  const entries = d.character_book?.entries ?? [];
  if (!Array.isArray(entries) || entries.length > 500)
    throw new Error("Invalid character lorebook (maximum 500 entries).");
  const keys = (v: any) => {
    if (v == null) return "";
    if (!Array.isArray(v) || v.length > 200)
      throw new Error("Invalid lorebook keywords.");
    return v.map((k) => text(k, 2000)).join(", ");
  };
  const lore = entries.map((e: any) => {
    if (!e || typeof e !== "object") throw new Error("Invalid lorebook entry.");
    return {
      ...newLore(),
      title: text(e.name || e.comment || "Imported lore", 150),
      content: text(e.content),
      keywords: keys(e.keys),
      secondary: keys(e.secondary_keys),
      enabled: e.enabled !== false,
      constant: e.constant === true,
      caseSensitive: e.case_sensitive === true,
      priority: Number.isFinite(e.insertion_order)
        ? Math.max(0, Math.min(1000, e.insertion_order))
        : 50,
    };
  });
  const author = [text(d.system_prompt), text(d.post_history_instructions)]
    .filter(Boolean)
    .join("\n\n");
  if (author.length > 100000)
    throw new Error("Character instructions are too large.");
  return {
    result: {
      title: name,
      memory,
      startingText: text(d.first_mes),
      alternateGreetings,
    },
    author,
    lore,
    source,
    creatorNotes: text(d.creator_notes),
  };
}

export async function fetchChubCharacter(
  link: string,
  signal: AbortSignal,
): Promise<CharacterImport> {
  const path = chubPath(link);
  const response = await fetch(
    `https://api.chub.ai/api/characters/${path}?full=true`,
    {
      headers: { Accept: "application/json" },
      credentials: "omit",
      signal,
    },
  );
  if (!response.ok)
    throw new Error(
      response.status === 404
        ? "Character not found. Check the full Chub link."
        : response.status === 401 || response.status === 403
          ? "This character is private or Chub denied access. Import its exported JSON instead."
          : `Chub returned HTTP ${response.status}. Try again later.`,
    );
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Empty character response.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 4 * 1024 * 1024)
        throw new Error("Character response is larger than 4 MB.");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  let data;
  try {
    data = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error(
      "Chub did not return character JSON. Try its exported JSON file.",
    );
  }
  return mapCharacterCard(data, `https://chub.ai/characters/${path}`);
}
