import {
  base,
  headers,
  stream,
  taskInstruction,
  reasoningText,
  chatContent,
  type Provider,
} from "./types";
import { totalOutput } from "../generation/thinking";
const modelOptions = new Map<
  string,
  {
    supported_parameters?: string[];
    architecture?: { input_modalities?: string[] };
    reasoning?: {
      mandatory?: boolean;
      supported_efforts?: string[];
      supports_max_tokens?: boolean;
    };
  }
>();
function rememberModels(url: string, data: any) {
  if (Array.isArray(data))
    for (const model of data)
      if (typeof model?.id === "string")
        modelOptions.set(`${url}/${model.id}`, model);
}
function safeMessage(value: unknown, key: string) {
  if (typeof value !== "string" || !value.trim()) return "";
  return value.replaceAll(key, "[redacted]").slice(0, 400);
}
async function checkResponse(response: Response, key: string) {
  if (response.ok) return;
  const body = await response.json().catch(() => null);
  const reason = safeMessage(body?.error?.message, key);
  const fallback =
    response.status === 403
      ? "OpenRouter denied this request. Check model access, key limits, privacy settings, and guardrails in your OpenRouter account."
      : response.status === 401
        ? "Check your OpenRouter API key."
        : "Check your model, account limits, and connection.";
  throw new Error(`OpenRouter HTTP ${response.status}: ${reason || fallback}`);
}
async function openRouterJson(url: string, key: string) {
  const response = await fetch(url, { headers: headers(key) });
  await checkResponse(response, key);
  return response.json();
}
export const openrouter: Provider = {
  async generate(r) {
    if (!r.key.trim())
      throw new Error("Enter your OpenRouter API key in Connection.");
    if (!r.connection.model.trim())
      throw new Error("Enter an OpenRouter model ID in Connection.");
    const s = r.settings;
    const options = modelOptions.get(
      `${base(r.connection)}/${r.connection.model}`,
    );
    const supportedEfforts = options?.reasoning?.supported_efforts;
    if (
      r.images?.length &&
      options?.architecture?.input_modalities &&
      !options.architecture.input_modalities.includes("image")
    )
      throw new Error(
        "This model does not accept images. Choose a vision model or remove the reference image.",
      );
    if (
      s.thinking &&
      !options?.reasoning?.supports_max_tokens &&
      supportedEfforts?.length &&
      !supportedEfforts.includes(s.thinkingLevel)
    )
      throw new Error(
        `This model supports Thinking levels: ${supportedEfforts.join(", ")}. Choose a supported level or another model.`,
      );
    const response = await fetch(base(r.connection) + "/chat/completions", {
      method: "POST",
      headers: headers(r.key),
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
        top_k:
          !options?.supported_parameters ||
          options.supported_parameters.includes("top_k")
            ? s.top_k
            : undefined,
        min_p:
          !options?.supported_parameters ||
          options.supported_parameters.includes("min_p")
            ? s.min_p
            : undefined,
        repetition_penalty:
          !options?.supported_parameters ||
          options.supported_parameters.includes("repetition_penalty")
            ? s.rep_pen
            : undefined,
        seed: s.seed < 0 ? undefined : s.seed,
        stop: s.stops.split("\n").filter(Boolean),
        stream: s.streaming,
        reasoning:
          s.thinking || options?.reasoning?.mandatory
            ? options?.reasoning?.supports_max_tokens && s.thinkingMaxTokens > 0
              ? {
                  enabled: true,
                  max_tokens: s.thinkingMaxTokens,
                  exclude: false,
                }
              : {
                  enabled: true,
                  effort:
                    !s.thinking && supportedEfforts?.length
                      ? supportedEfforts[0]
                      : s.thinkingLevel,
                  exclude: false,
                }
            : { enabled: false, exclude: false },
        response_format:
          (r.purpose === "notes" ||
            r.purpose === "create" ||
            r.purpose === "states") &&
          options?.supported_parameters?.includes("response_format")
            ? { type: "json_object" }
            : undefined,
      }),
    });
    await checkResponse(response, r.key);
    if (s.streaming) {
      let finishReason = "";
      let reasoningSeen = false;
      const output = await stream(
        response,
        r.onToken,
        (o) => {
          const choice = o.choices?.[0];
          if (choice?.finish_reason) finishReason = choice.finish_reason;
          if (choice?.delta?.reasoning || choice?.delta?.reasoning_details)
            reasoningSeen = true;
          const thoughts = reasoningText(choice?.delta);
          if (thoughts) r.onReasoning?.(thoughts);
          return choice?.delta?.content || "";
        },
        (error) =>
          `OpenRouter stream error: ${safeMessage(error?.message, r.key) || "request failed"}`,
      );
      if (!output.trim())
        throw new Error(
          reasoningSeen || finishReason === "length"
            ? "The model returned no story text. Its output limit may have been spent on reasoning. Increase Output limit in Settings or choose another model."
            : "The model returned no story text. Try another model or increase Output limit in Settings.",
        );
      return output;
    }
    const data = await response.json();
    if (data.error)
      throw new Error(
        "OpenRouter could not complete the request. Check your model and credits.",
      );
    const text = data.choices?.[0]?.message?.content;
    const thoughts = reasoningText(data.choices?.[0]?.message);
    if (thoughts) r.onReasoning?.(thoughts);
    if (
      (r.purpose === "notes" ||
        r.purpose === "create" ||
        r.purpose === "states") &&
      data.choices?.[0]?.finish_reason === "length"
    )
      throw new Error(
        r.purpose === "states"
          ? "Internal States output was cut off. Increase Internal States Output or reduce its Thinking budget. Previous states were kept."
          : r.purpose === "create"
            ? "Creation was cut off. Increase Create Output or reduce thinking. Your previous result was kept."
            : "Note output was cut off. Increase Note Output or lower Note Thinking. No notes were changed.",
      );
    if (typeof text !== "string" || !text.trim())
      throw new Error(
        r.purpose === "states"
          ? "No Internal States JSON returned. Check the Internal States output and thinking settings; previous states were kept."
          : r.purpose === "notes"
            ? "No note JSON returned. Disable Note Thinking, increase Note Output, or choose a different note model."
            : "OpenRouter returned no text. Try a larger Writing Output or another model.",
      );
    r.onToken(text);
    return text;
  },
  async listModels(c, key) {
    if (!key.trim()) throw new Error("Enter your OpenRouter API key first.");
    const catalog = await openRouterJson(base(c) + "/models", key);
    rememberModels(base(c), catalog.data);
    if (!Array.isArray(catalog.data))
      throw new Error("OpenRouter returned an invalid model list.");
    return catalog.data
      .filter(
        (model: any) =>
          typeof model.id === "string" &&
          (!Array.isArray(model.architecture?.output_modalities) ||
            model.architecture.output_modalities.includes("text")),
      )
      .map((model: { id: string }) => model.id)
      .sort((a: string, b: string) => a.localeCompare(b));
  },
  async info(c, key) {
    if (!key.trim()) throw new Error("Enter your OpenRouter API key.");
    if (!c.model.trim())
      throw new Error("Enter a model ID, such as provider/model-name.");
    await openRouterJson(base(c) + "/key", key);
    const catalog = await openRouterJson(base(c) + "/models", key);
    rememberModels(base(c), catalog.data);
    const model = catalog.data?.find((m: { id: string }) => m.id === c.model);
    if (!model)
      throw new Error("Model ID not found in the OpenRouter catalog.");
    return { model: model.id, context: model.context_length };
  },
};
