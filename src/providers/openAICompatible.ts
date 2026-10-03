import {
  base,
  json,
  headers,
  stream,
  reasoningText,
  type Provider,
} from "./types";
import { totalOutput } from "../generation/thinking";
export const openai: Provider = {
  async listModels(c, key) {
    const data = await json(base(c) + "/models", { headers: headers(key) });
    if (!Array.isArray(data.data))
      throw new Error("The server returned an invalid model list.");
    return data.data
      .map((item: { id?: unknown }) => item?.id)
      .filter((id: unknown): id is string => typeof id === "string")
      .sort((a: string, b: string) => a.localeCompare(b));
  },
  async generate(r) {
    const s = r.settings;
    const response = await fetch(base(r.connection) + "/completions", {
      method: "POST",
      headers: headers(r.key),
      signal: r.signal,
      body: JSON.stringify({
        model: r.connection.model,
        prompt: r.prompt,
        max_tokens: totalOutput(s),
        temperature: s.temperature,
        top_p: s.top_p,
        top_k: s.top_k,
        min_p: s.min_p,
        repetition_penalty: s.rep_pen,
        seed: s.seed < 0 ? undefined : s.seed,
        stop: s.stops.split("\n").filter(Boolean),
        stream: s.streaming,
      }),
    });
    if (s.streaming)
      return stream(response, r.onToken, (o) => {
        const choice = o.choices?.[0];
        const thoughts = reasoningText(choice?.delta ?? choice);
        if (thoughts) r.onReasoning?.(thoughts);
        return choice?.text || choice?.delta?.content || "";
      });
    if (!response.ok)
      throw new Error(`Generation failed (HTTP ${response.status}).`);
    const data = await response.json();
    const text = data.choices?.[0]?.text;
    const thoughts = reasoningText(data.choices?.[0]);
    if (thoughts) r.onReasoning?.(thoughts);
    if (typeof text !== "string")
      throw new Error(
        "No completion returned. Use a text-completion compatible model.",
      );
    r.onToken(text);
    return text;
  },
  async info(c, key) {
    const d = await json(base(c) + "/models", { headers: headers(key) });
    return { model: c.model || d.data?.[0]?.id || "Connected" };
  },
};
