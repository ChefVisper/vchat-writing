/** Slash instructions are transport metadata, never story prose or executable XML. */
export function aiDirective(text: string): string | undefined {
  const trimmed = text.trim();
  if (!/^\/ai(?:\s|$)/.test(trimmed)) return undefined;
  const raw = trimmed.slice(3).trim();
  if (!raw) throw new Error('Use /ai "Your instruction".');
  if (!raw.startsWith('"')) return raw;
  let instruction: unknown;
  try {
    instruction = JSON.parse(raw);
  } catch {
    throw new Error(
      'Close the instruction quotes. Example: /ai "Offer three choices using V-HTML."',
    );
  }
  if (typeof instruction !== "string" || !instruction.trim())
    throw new Error("The AI instruction cannot be empty.");
  return instruction;
}
