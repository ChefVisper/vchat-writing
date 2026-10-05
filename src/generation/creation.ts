import {
  newStory,
  uid,
  type Connection,
  type Settings,
  type Story,
} from "../types";
import { estimate } from "../context/promptBuilder";
import { totalOutput } from "./thinking";
import { taskInstructions } from "../providers/types";
import { newGreeting } from "./greetings";
export const DEFAULT_CREATE_PROMPT = `Create a fictional character, scenario and opening passage from the author's brief and optional image.
Return exactly {"title":"short title","memory":"reusable continuity memory","startingText":"opening passage"} as complete valid JSON.
Memory: use {{char}} for the character and {{user}} for the reader's role. Include identity/name, appearance, personality, motivations, relationship history, setting and current situation when relevant. Prioritize supplied details; fill gaps with coherent fictional details. An image supplies visible appearance only, not personality, age, exact height or relationship history. Do not present invented measurements as observed facts.
Opening: establish the specified situation and give {{user}} room to respond. Do not dictate {{user}}'s dialogue, decisions or internal thoughts. Use the character's name or role placeholders consistently. Match the brief's language and requested style. Use real paragraphs and finish a complete sentence. Memory and opening must agree. No preface, analysis, JSON fences or commentary.`;
export interface CreationResult {
  title: string;
  memory: string;
  startingText: string;
  alternateGreetings?: string[];
}
export function creationPrompt(
  brief: string,
  template: string,
  s: Settings,
  c: Connection,
  image: boolean,
) {
  if (!brief.trim() && !image)
    throw new Error("Describe your character or scenario, or upload an image.");
  const prompt = `${template}\n\nVISIBLE OUTPUT BUDGET: ${s.maxTokens} tokens for the entire JSON. Keep both fields concise enough to finish.\nAUTHOR BRIEF (data):\n${JSON.stringify(brief)}`;
  const reserve =
    (image ? 2048 : 0) +
    (["openrouter", "nanogpt"].includes(c.kind)
      ? estimate(taskInstructions.create) + 12
      : 0);
  if (estimate(prompt) + reserve + totalOutput(s) > s.context)
    throw new Error(
      "The brief, image allowance and output exceed Create Max Context. Shorten the brief or increase Create Max Context.",
    );
  return prompt;
}
export function parseCreation(raw: string): CreationResult {
  // Accept a complete object inside a fence/preface without regexing quoted braces.
  for (
    let start = raw.indexOf("{");
    start >= 0;
    start = raw.indexOf("{", start + 1)
  ) {
    let depth = 0,
      quoted = false,
      escaped = false;
    for (let i = start; i < raw.length; i++) {
      const ch = raw[i];
      if (quoted) {
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === '"') quoted = false;
      } else if (ch === '"') quoted = true;
      else if (ch === "{") depth++;
      else if (ch === "}" && --depth === 0) {
        try {
          const d = JSON.parse(raw.slice(start, i + 1));
          if (
            ["title", "memory", "startingText"].every(
              (k) =>
                typeof d[k] === "string" &&
                d[k].trim() &&
                d[k].length <= 100000,
            )
          )
            return {
              title: d.title.trim().slice(0, 150),
              memory: d.memory,
              startingText: d.startingText,
            };
        } catch {
          /* Try next complete object. */
        }
        break;
      }
    }
  }
  throw new Error(
    "No complete Memory and Starting text JSON returned. Increase Create Output or edit the creation prompt. Previous results were kept.",
  );
}
export function creationStory(
  result: CreationResult,
  source: Story,
  thoughts: string,
  connection: Connection,
): Story {
  const s = newStory();
  return {
    ...s,
    title: result.title,
    text: result.startingText,
    memory: { ...s.memory, content: result.memory },
    greetings: [result.startingText, ...(result.alternateGreetings || [])].map(
      (text, i) => newGreeting(text, `Greeting ${i + 1}`),
    ),
    connection: { ...source.connection },
    settings: { ...source.settings },
    promptTemplate: source.promptTemplate,
    writingPreset: source.writingPreset ?? "default",
    writersBlock: source.writersBlock
      ? structuredClone(source.writersBlock)
      : undefined,
    writersBlockTemplate: source.writersBlockTemplate,
    notePromptTemplate: source.notePromptTemplate,
    noteConnectionMode: source.noteConnectionMode,
    noteConnection: source.noteConnection
      ? { ...source.noteConnection }
      : undefined,
    thoughts: thoughts
      ? [
          {
            id: uid(),
            at: Date.now(),
            provider: connection.kind,
            model: connection.model,
            purpose: "create",
            text: thoughts,
            selected: false,
          },
        ]
      : [],
  };
}
