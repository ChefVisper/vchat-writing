import { base, headers, stream, type Provider } from "./types";
const modelOptions = new Map<
  string,
  {
    supported_parameters?: string[];
    reasoning?: { mandatory?: boolean; supported_efforts?: string[] };
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
    if (options?.reasoning?.mandatory && !s.thinking)
      throw new Error(
        "This model requires Thinking. Enable it in Settings or select a non-thinking model.",
      );
    const supportedEfforts = options?.reasoning?.supported_efforts;
    if (
      s.thinking &&
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
        messages: [{ role: "user", content: r.prompt }],
        max_tokens: s.maxTokens,
        temperature: s.temperature,
        top_p: s.top_p,
        seed: s.seed < 0 ? undefined : s.seed,
        stop: s.stops.split("\n").filter(Boolean),
        stream: s.streaming,
        reasoning: s.thinking
          ? { enabled: true, effort: s.thinkingLevel }
          : { enabled: false },
        response_format:
          r.purpose === "notes" &&
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
    if (r.purpose === "notes" && data.choices?.[0]?.finish_reason === "length")
      throw new Error(
        "Note output was cut off. Increase Note Output or lower Note Thinking. No notes were changed.",
      );
    if (typeof text !== "string" || !text.trim())
      throw new Error(
        r.purpose === "notes"
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
