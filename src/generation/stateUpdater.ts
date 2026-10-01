import { DEFAULT_NOTE_PROMPT, uid, type Note, type Story } from "../types";
import { estimate } from "../context/promptBuilder";
export interface Update {
  noteId: string;
  newContent: string;
  oldContent: string;
}
export function validateUpdates(raw: string, notes: Note[]): Update[] {
  let data;
  try {
    const cleaned = raw.replace(/<think\b[^>]*>[\s\S]*?<\/think>/gi, "").trim();
    // Extract a complete JSON object, respecting braces inside quoted strings.
    let start = -1,
      depth = 0,
      quoted = false,
      escaped = false;
    for (let i = 0; i < cleaned.length; i++) {
      const c = cleaned[i];
      if (start < 0) {
        if (c !== "{") continue;
        start = i;
        depth = 1;
        continue;
      }
      if (quoted) {
        if (escaped) escaped = false;
        else if (c === "\\") escaped = true;
        else if (c === '"') quoted = false;
      } else if (c === '"') quoted = true;
      else if (c === "{") depth++;
      else if (c === "}" && --depth === 0) {
        try {
          const candidate = JSON.parse(cleaned.slice(start, i + 1));
          if (Array.isArray(candidate?.updates)) {
            data = candidate;
            break;
          }
        } catch {
          /* Try the next complete object. */
        }
        start = -1;
      }
    }
    if (!data) throw new Error();
  } catch {
    throw new Error(
      "Note response did not contain a complete updates JSON object. Try Note again with Thinking off or a higher Note Output. No notes were changed.",
    );
  }
  if (
    !data ||
    !Array.isArray(data.updates) ||
    data.updates.length > notes.length
  )
    throw new Error("Invalid note update structure. No notes were changed.");
  const ids = new Set<string>();
  return data.updates
    .map((u: any) => {
      const note = notes.find((n) => n.id === u?.noteId);
      if (
        !note ||
        !note.enabled ||
        !note.aiEditable ||
        note.locked ||
        note.mode === "off" ||
        typeof u.newContent !== "string" ||
        u.newContent.length > 100000 ||
        ids.has(u.noteId)
      )
        throw new Error("Unsafe note update rejected. No notes were changed.");
      ids.add(u.noteId);
      return {
        noteId: note.id,
        newContent: u.newContent,
        oldContent: note.content,
      };
    })
    .filter((u: Update) => u.newContent !== u.oldContent);
}
export function applyUpdate(notes: Note[], u: Update, source = "AI"): Note[] {
  return notes.map((n) =>
    n.id === u.noteId &&
    n.enabled &&
    n.aiEditable &&
    !n.locked &&
    n.mode !== "off" &&
    n.content === u.oldContent
      ? {
          ...n,
          content: u.newContent,
          revisions: [
            ...n.revisions,
            { id: uid(), content: n.content, at: Date.now(), source },
          ],
        }
      : n,
  );
}
export function updaterPrompt(story: Story, newText: string) {
  const template = story.notePromptTemplate ?? DEFAULT_NOTE_PROMPT;
  if (!template.includes("{{notes}}") || !template.includes("{{prose}}"))
    throw new Error(
      "Note prompt needs {{notes}} and {{prose}}. Edit it in Prompt.",
    );
  const notes = JSON.stringify(
    story.notes
      .filter((n) => n.enabled && n.aiEditable && !n.locked && n.mode !== "off")
      .map((n) => ({ noteId: n.id, title: n.title, content: n.content })),
  );
  return template.replace(/\{\{(notes|prose)\}\}/g, (_, key) =>
    key === "notes" ? notes : JSON.stringify(newText),
  );
}
export function buildNotePrompt(story: Story, prose: string) {
  const budget = story.settings.context - story.settings.noteMaxTokens;
  if (estimate(updaterPrompt(story, "")) >= budget)
    throw new Error(
      "Notes and instructions exceed Max Context after reserving Note Output. Increase Max Context or shorten the notes.",
    );
  let text = prose;
  let prompt = updaterPrompt(story, text);
  while (estimate(prompt) > budget && text.length) {
    text = text.slice(
      Math.max(1, Math.ceil((estimate(prompt) - budget) * 3.5)),
    );
    prompt = updaterPrompt(story, text);
  }
  return { prompt, trimmed: prose.length - text.length };
}
