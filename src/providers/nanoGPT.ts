import {
  base,
  headers,
  json,
  reasoningText,
  stream,
  taskInstruction,
  chatContent,
  type Provider,
} from "./types";
import { totalOutput } from "../generation/thinking";
const catalog = new Map<string, any>();
async function models(c: Parameters<Provider["listModels"]>[0], key: string) {
  const data = await json(base(c) + "/models", { headers: headers(key) });
  if (!Array.isArray(data.data))
    throw new Error("NanoGPT returned an invalid model list.");
  for (const model of data.data)
    if (typeof model?.id === "string")
      catalog.set(`${base(c)}/${model.id}`, model);
  return data.data.filter(
    (m: any) =>
      typeof m.id === "string" &&
      (!Array.isArray(m.architecture?.output_modalities) ||
        m.architecture.output_modalities.includes("text")),
  );
}
export const nanogpt: Provider = {
  async listModels(c, key) {
    return (await models(c, key))
      .map((m: any) => m.id)
      .sort((a: string, b: string) => a.localeCompare(b));
  },
  async info(c, key) {
    if (!key.trim()) throw new Error("Enter your NanoGPT API key.");
    const found = (await models(c, key)).find((m: any) => m.id === c.model);
    if (!found) throw new Error("Select a model from Fetch models.");
    return { model: found.id, context: found.context_length };
  },
  async generate(r) {
    if (!r.key.trim() || !r.connection.model.trim())
      throw new Error("Enter your NanoGPT API key and model in Connection.");
    const s = r.settings,
      model = catalog.get(`${base(r.connection)}/${r.connection.model}`);
    if (
      r.images?.length &&
      ((Array.isArray(model?.architecture?.input_modalities) &&
        !model.architecture.input_modalities.includes("image")) ||
        model?.capabilities?.vision === false)
    )
      throw new Error(
        "This model does not accept images. Choose a vision model or remove the reference image.",
      );
    const supported = (name: string) =>
      !Array.isArray(model?.supported_parameters) ||
      model.supported_parameters.includes(name);
    const response = await fetch(base(r.connection) + "/chat/completions", {
      method: "POST",
      headers: {
        ...headers(r.key),
        Accept: s.streaming ? "text/event-stream" : "application/json",
      },
      signal: r.signal,
      body: JSON.stringify({
        model: r.connection.model,
        messages: [
          {
            role: "system",
            content: taskInstruction(r.purpose, r.writingPreset),
          },
          { role: "user", content: chatContent(r) },
        ],
        max_tokens: totalOutput(s),
        temperature: s.temperature,
        top_p: s.top_p,
        top_k: supported("top_k") ? s.top_k : undefined,
        min_p: supported("min_p") ? s.min_p : undefined,
        repetition_penalty: supported("repetition_penalty")
          ? s.rep_pen
          : undefined,
        seed: s.seed < 0 ? undefined : s.seed,
        stop: s.stops.split("\n").filter(Boolean),
        stream: s.streaming,
        reasoning: {
          effort: s.thinking ? s.thinkingLevel : "none",
          exclude: false,
        },
      }),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => null);
      const message =
        typeof data?.error?.message === "string"
          ? data.error.message.replaceAll(r.key, "[redacted]").slice(0, 400)
          : "Check your model, API key and account limits.";
      throw new Error(`NanoGPT HTTP ${response.status}: ${message}`);
    }
    if (
      s.streaming &&
      !response.headers.get("content-type")?.includes("application/json")
    )
      return stream(
        response,
        r.onToken,
        (o) => {
          const delta = o.choices?.[0]?.delta;
          const thought = reasoningText(delta);
          if (thought) r.onReasoning?.(thought);
          return delta?.content || "";
        },
        (e) =>
          `NanoGPT stream error: ${String(e?.message || "request failed")
            .replaceAll(r.key, "[redacted]")
            .slice(0, 400)}`,
      );
    const data = await response.json(),
      choice = data.choices?.[0];
    const thought = reasoningText(choice?.message);
    if (thought) r.onReasoning?.(thought);
    if (
      (r.purpose === "notes" || r.purpose === "create") &&
      choice?.finish_reason === "length"
    )
      throw new Error(
        r.purpose === "create"
          ? "Creation was cut off. Increase Create Output or reduce thinking. Your previous result was kept."
          : "Note output was cut off. Increase Note Output or reduce thinking. No notes changed.",
      );
    const text = choice?.message?.content;
    if (typeof text !== "string")
      throw new Error(
        "NanoGPT returned no answer text; any exposed reasoning is in Thinking.",
      );
    r.onToken(text);
    return text;
  },
};
