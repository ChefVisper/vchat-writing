import type { Connection, Settings } from "../types";
export interface Request {
  prompt: string;
  settings: Settings;
  connection: Connection;
  key: string;
  signal: AbortSignal;
  onToken: (text: string) => void;
  purpose?: "writing" | "notes";
}
export interface Provider {
  generate: (r: Request) => Promise<string>;
  listModels: (c: Connection, key: string) => Promise<string[]>;
  info: (
    c: Connection,
    key: string,
  ) => Promise<{ model: string; context?: number }>;
  abort?: (c: Connection, key: string) => Promise<void>;
  count?: (c: Connection, text: string) => Promise<number>;
}
export async function json(url: string, init: RequestInit = {}) {
  const r = await fetch(url, init);
  if (!r.ok)
    throw new Error(
      `Provider returned HTTP ${r.status}. Check your connection, model, and credentials.`,
    );
  return r.json();
}
export const base = (c: Connection) => c.url.replace(/\/+$/, "");
export const headers = (key: string) => ({
  "Content-Type": "application/json",
  ...(key ? { Authorization: `Bearer ${key}` } : {}),
});
export async function stream(
  response: Response,
  onToken: (s: string) => void,
  extract: (o: any) => string,
  errorMessage?: (error: any) => string,
) {
  if (!response.ok)
    throw new Error(`Generation failed (HTTP ${response.status}).`);
  if (!response.body) throw new Error("Streaming is unavailable.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "",
    output = "";
  const parse = (event: string) => {
    const data = event
      .split("\n")
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).trim())
      .join("\n");
    if (!data || data === "[DONE]") return;
    const o = JSON.parse(data);
    if (o.error)
      throw new Error(
        errorMessage?.(o.error) || "Provider reported a stream error.",
      );
    const t = extract(o);
    if (t) {
      output += t;
      onToken(t);
    }
  };
  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    buffer = buffer.replace(/\r\n/g, "\n");
    let i;
    while ((i = buffer.indexOf("\n\n")) >= 0) {
      parse(buffer.slice(0, i));
      buffer = buffer.slice(i + 2);
    }
    if (done) {
      if (buffer.trim()) parse(buffer);
      break;
    }
  }
  return output;
}
export const nativeParams = (r: Request) => ({
  prompt: r.prompt,
  max_length: r.settings.maxTokens,
  max_context_length: r.settings.context,
  temperature: r.settings.temperature,
  top_p: r.settings.top_p,
  top_k: r.settings.top_k,
  min_p: r.settings.min_p,
  typical: r.settings.typical,
  rep_pen: r.settings.rep_pen,
  rep_pen_range: r.settings.rep_pen_range,
  sampler_seed: r.settings.seed,
  stop_sequence: r.settings.stops.split("\n").filter(Boolean),
});
