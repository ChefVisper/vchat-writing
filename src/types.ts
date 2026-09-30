export type Position = "before" | "after";
export interface ContextText {
  content: string;
  enabled: boolean;
  position: Position;
  depth: number;
}
export interface Revision {
  id: string;
  content: string;
  at: number;
  source: string;
}
export interface Note {
  id: string;
  title: string;
  content: string;
  enabled: boolean;
  include: boolean;
  aiEditable: boolean;
  locked: boolean;
  position: Position;
  keywords: string;
  mode: "off" | "review" | "auto";
  revisions: Revision[];
}
export interface Lore {
  id: string;
  title: string;
  content: string;
  keywords: string;
  secondary: string;
  enabled: boolean;
  constant: boolean;
  priority: number;
  caseSensitive: boolean;
  scanDepth: number;
  budget: number;
  probability: number;
}
export interface Settings {
  temperature: number;
  top_p: number;
  top_k: number;
  min_p: number;
  typical: number;
  rep_pen: number;
  rep_pen_range: number;
  maxTokens: number;
  inputTokens: number;
  context: number;
  seed: number;
  stops: string;
  streaming: boolean;
}
export interface Connection {
  kind: "kobold" | "openai" | "horde" | "openrouter";
  url: string;
  model: string;
}
export interface Segment {
  id: string;
  before: string;
  after: string;
  at: number;
  notesBefore?: Note[];
  notesAfter?: Note[];
}
export interface Snapshot {
  id: string;
  title: string;
  at: number;
  text: string;
  notes: Note[];
}
export interface Story {
  id: string;
  title: string;
  text: string;
  modified: number;
  memory: ContextText;
  author: ContextText;
  notes: Note[];
  lore: Lore[];
  loreBudget: number;
  settings: Settings;
  promptTemplate?: string;
  connection: Connection;
  segments: Segment[];
  snapshots: Snapshot[];
  past: string[];
  future: string[];
  parent?: string;
  lastUpdateText: string;
  pending?: { noteId: string; newContent: string; oldContent: string }[];
}
export const uid = () => {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};
export const defaults: Settings = {
  temperature: 0.8,
  top_p: 0.95,
  top_k: 40,
  min_p: 0,
  typical: 1,
  rep_pen: 1.1,
  rep_pen_range: 1024,
  maxTokens: 240,
  inputTokens: 8192,
  context: 8192,
  seed: -1,
  stops: "",
  streaming: true,
};
export const DEFAULT_PROMPT_TEMPLATE = `Continue the manuscript from its last character. Match its language, point of view, tense, voice, and formatting. Preserve established details. Write only the next passage: no recap, heading, role label, explanation, or meta-commentary. Use the context as guidance, not text to copy.

{{context}}

[MANUSCRIPT — continue from the final character]
{{story}}`;
export const newNote = (): Note => ({
  id: uid(),
  title: "Untitled note",
  content: "",
  enabled: true,
  include: true,
  aiEditable: true,
  locked: false,
  position: "after",
  keywords: "",
  mode: "review",
  revisions: [],
});
export const newLore = (): Lore => ({
  id: uid(),
  title: "Untitled entry",
  content: "",
  keywords: "",
  secondary: "",
  enabled: true,
  constant: false,
  priority: 50,
  caseSensitive: false,
  scanDepth: 8,
  budget: 0,
  probability: 100,
});
export function newStory(sample = false): Story {
  return {
    id: uid(),
    title: sample ? "The hours between" : "Untitled story",
    text: sample
      ? `The rain hadn't stopped since midnight.\n\nMira leaned against the kitchen counter, watching the city dissolve into the glass. Somewhere below, a train pulled out of the station. She counted the lit windows until it disappeared.\n\nThe key turned in the lock.\n\n“You're late again.”\n\nDaniel took off his coat and placed it over the chair. There was something careful about the way he did it, as if the room were full of sleeping things.\n\n“I know,” he said.\n\nShe waited for the rest of it. The kettle clicked off behind her, leaving a silence neither of them seemed willing to fill.`
      : "",
    modified: Date.now(),
    memory: {
      content: sample
        ? "A slow-burn modern drama set in Tokyo. Mira and Daniel have been dating for two years. Daniel is a photographer."
        : "",
      enabled: true,
      position: "before",
      depth: 0,
    },
    author: {
      content: sample
        ? "Use restrained dialogue and small, telling details. Let the tension remain beneath the surface."
        : "",
      enabled: true,
      position: "after",
      depth: 2,
    },
    notes: sample
      ? [
          {
            ...newNote(),
            title: "Current scene",
            content:
              "Location: Daniel’s apartment\nTime: After midnight\nMira is suspicious. Daniel has just come home.\nNeither has explained what happened.",
          },
        ]
      : [],
    lore: [],
    loreBudget: 1000,
    settings: { ...defaults },
    promptTemplate: DEFAULT_PROMPT_TEMPLATE,
    connection: { kind: "kobold", url: "http://localhost:5001", model: "" },
    segments: [],
    snapshots: [],
    past: [],
    future: [],
    lastUpdateText: "",
  };
}
