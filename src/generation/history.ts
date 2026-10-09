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

function comparable(text: string) {
  let normalized = "";
  const ends: number[] = [];
  let offset = 0;
  for (const c of text) {
    offset += c.length;
    const value = /\s/u.test(c)
      ? " "
      : c.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').toLowerCase();
    if (value === " " && normalized.endsWith(" ")) {
      ends[ends.length - 1] = offset;
      continue;
    }
    normalized += value;
    for (let i = 0; i < value.length; i++) ends.push(offset);
  }
  return { normalized, ends };
}

export function trimRepeatedPrefix(
  before: string,
  addition: string,
  streaming = false,
) {
  if (!before || !addition) return addition;
  const input = comparable(
    before.slice(-6000).replace(/(?:\.{2,}|…)\s*$/, ""),
  ).normalized;
  const start = addition.length - addition.trimStart().length;
  const output = comparable(addition.slice(start, start + 6000));
  const pattern = output.normalized;
  if (!pattern) return addition;
  // Hold an early streamed fragment while it can still be an echo of a long
  // input suffix. Once it diverges, render it or remove the completed overlap.
  if (streaming && pattern.length < 120) {
    for (const m of input.matchAll(/(?:^|\s|[.!?])([^\s])/g)) {
      const suffix = input.slice(m.index! + m[0].length - m[1].length);
      if (
        suffix.trim().split(/\s+/).length >= 3 &&
        suffix.startsWith(pattern) &&
        pattern.length <= suffix.length
      )
        return "";
    }
  }
  const failure = new Array<number>(pattern.length).fill(0);
  for (let i = 1, k = 0; i < pattern.length; i++) {
    while (k && pattern[i] !== pattern[k]) k = failure[k - 1];
    if (pattern[i] === pattern[k]) k++;
    failure[i] = k;
  }
  let matched = 0;
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    while (matched && (matched === pattern.length || pattern[matched] !== c))
      matched = failure[matched - 1];
    if (pattern[matched] === c) matched++;
  }
  const overlap = pattern.slice(0, matched).trim();
  const words = overlap.split(/\s+/).length;
  if (words < 3 && !(words >= 2 && overlap.length >= 20)) return addition;
  return addition.slice(start + output.ends[matched - 1]);
}

export function continuationText(
  before: string,
  raw: string,
  removeRepeat: boolean,
  streaming = false,
) {
  const clean = cleanContinuation(raw);
  return removeRepeat ? trimRepeatedPrefix(before, clean, streaming) : clean;
}
