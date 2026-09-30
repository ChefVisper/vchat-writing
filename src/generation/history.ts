import type { Story } from "../types";
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
