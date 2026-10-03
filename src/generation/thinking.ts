import type { Settings, Story } from "../types";

export function totalOutput(settings: Settings) {
  return settings.maxTokens + settings.thinkingMaxTokens;
}
export function thinkingContext(story: Story) {
  return story.settings.includeThinking
    ? (story.thoughts ?? [])
        .filter((t) => t.selected)
        .map((t) => `${t.model} (${t.purpose}):\n${t.text}`)
        .join("\n\n")
    : "";
}
export function tokenEstimate(text: string) {
  return Math.ceil(new TextEncoder().encode(text).length / 3.5);
}
export function fitTokens(text: string, limit: number) {
  if (tokenEstimate(text) <= limit) return text;
  let low = 0,
    high = text.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (tokenEstimate(text.slice(0, mid)) <= limit) low = mid;
    else high = mid - 1;
  }
  // Avoid splitting a UTF-16 surrogate pair.
  if (low && /[\uD800-\uDBFF]/.test(text[low - 1])) low--;
  return text.slice(0, low);
}

// Keep delimiter fragments private until they can be classified. All tagged
// reasoning is separated even if the request asked the model not to think.
export class ThinkingSplitter {
  private buffer = "";
  private depth = 0;
  private pairs: [string, string][];
  constructor(
    settings: Settings,
    private prose: (s: string) => void,
    private reasoning: (s: string) => void,
  ) {
    this.pairs = [
      [settings.thinkingPrefix.trim(), settings.thinkingSuffix.trim()],
      ["<think>", "</think>"],
    ].filter(
      ([a, b], i, all) =>
        a &&
        b &&
        a !== b &&
        all.findIndex((p) => p[0] === a && p[1] === b) === i,
    ) as [string, string][];
    if (settings.thinkingPrefill) this.depth = 1;
  }
  push(text: string) {
    this.buffer += text;
    this.drain(false);
  }
  finish() {
    this.drain(true);
  }
  private drain(final: boolean) {
    while (this.buffer) {
      let at = this.buffer.length,
        marker = "",
        opening = false;
      for (const [start, end] of this.pairs)
        for (const [tag, open] of [
          [start, true],
          [end, false],
        ] as const) {
          const found = this.buffer.indexOf(tag);
          if (found >= 0 && found < at) {
            at = found;
            marker = tag;
            opening = open;
          }
        }
      if (marker) {
        this.emit(this.buffer.slice(0, at));
        this.buffer = this.buffer.slice(at + marker.length);
        this.depth = opening ? this.depth + 1 : Math.max(0, this.depth - 1);
        continue;
      }
      let keep = 0;
      if (!final)
        for (const pair of this.pairs)
          for (const tag of pair) {
            for (
              let n = Math.min(tag.length - 1, this.buffer.length);
              n > keep;
              n--
            )
              if (this.buffer.endsWith(tag.slice(0, n))) {
                keep = n;
                break;
              }
          }
      // A trailing partial delimiter at EOF is not prose.
      if (final)
        for (const pair of this.pairs)
          for (const tag of pair) {
            for (
              let n = Math.min(tag.length - 1, this.buffer.length);
              n > keep;
              n--
            )
              if (this.buffer.endsWith(tag.slice(0, n))) {
                keep = n;
                break;
              }
          }
      this.emit(this.buffer.slice(0, this.buffer.length - keep));
      this.buffer = final ? "" : this.buffer.slice(this.buffer.length - keep);
      break;
    }
  }
  private emit(text: string) {
    if (text) (this.depth ? this.reasoning : this.prose)(text);
  }
}
