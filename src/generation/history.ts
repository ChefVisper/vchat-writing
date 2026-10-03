import type { Story } from "../types";
export function branchTitle(story: Story, stories: Story[]) {
  const root = (s: Story) => {
    const seen = new Set<string>();
    while (s.parent && !seen.has(s.id)) {
      seen.add(s.id);
      const parent = stories.find((x) => x.id === s.parent);
      if (!parent) break;
      s = parent;
    }
    return s;
  };
  const origin = root(story);
  let number = 1;
  for (const s of stories)
    if (root(s).id === origin.id) {
      const match = s.title.match(/ · Branch (\d+)$/i);
      if (match) number = Math.max(number, +match[1] + 1);
    }
  return `${origin.title.replace(/ · branch(?: \d+)?$/i, "")} · Branch ${number}`;
}

export function trimIncomplete(before: string, addition: string) {
  // Only the added text may be removed. Check a small input tail to recognize
  // decimals and abbreviations when the model completes the author's sentence.
  const prefix = before.slice(-300);
  const text = prefix + addition;
  let end = prefix.length;
  const boundary = /[.!?。！？]+["'”’»）)\]]*/gu;
  for (const match of text.matchAll(boundary)) {
    const at = match.index!;
    if (at < prefix.length || /^\.{2,}/.test(match[0])) continue;
    if (match[0][0] === ".") {
      if (/\d/.test(text[at - 1] ?? "") && /\d/.test(text[at + 1] ?? ""))
        continue;
      if (
        /\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|vs|etc)\.$/i.test(
          text.slice(Math.max(0, at - 10), at + 1),
        )
      )
        continue;
    }
    const after = text[at + match[0].length];
    if (/[.!?]/.test(match[0][0]) && after && !/\s/u.test(after)) continue;
    end = at + match[0].length;
  }
  if (!text.slice(end).trim()) return addition;
  return addition.slice(0, Math.max(0, end - prefix.length));
}
export function retryBase(story: Story) {
  const segment = story.segments.at(-1);
  if (!segment || story.text !== segment.after)
    throw new Error(
      "The document changed after this continuation. Restore its snapshot or create a branch before retrying.",
    );
  return segment;
}
export function cleanContinuation(text: string) {
  return text.replace(
    /^(?:\s*(?:Assistant|AI):\s*|\s*Here is (?:the|your) continuation:\s*)/i,
    "",
  );
}
