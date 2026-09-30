import { base, json, stream, nativeParams, type Provider } from "./types";
export const kobold: Provider = {
  async listModels(c) {
    const model = await json(base(c) + "/api/v1/model");
    return typeof model.result === "string" && model.result
      ? [model.result]
      : [];
  },
  async generate(r) {
    const url = base(r.connection);
    const body = JSON.stringify(nativeParams(r));
    if (r.settings.streaming)
      return stream(
        await fetch(url + "/api/extra/generate/stream", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
          signal: r.signal,
        }),
        r.onToken,
        (o) => o.token || "",
      );
    const data = await json(url + "/api/v1/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal: r.signal,
    });
    const text = data.results?.[0]?.text;
    if (typeof text !== "string")
      throw new Error("No text returned by KoboldCpp.");
    r.onToken(text);
    return text;
  },
  async info(c) {
    const model = await json(base(c) + "/api/v1/model");
    let context;
    try {
      context = (await json(base(c) + "/api/extra/true_max_context_length"))
        .value;
    } catch {
      try {
        context = (await json(base(c) + "/api/v1/config/max_context_length"))
          .value;
      } catch {}
    }
    return { model: model.result, context };
  },
  async abort(c) {
    await json(base(c) + "/api/extra/abort", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
  },
  async count(c, text) {
    return (
      await json(base(c) + "/api/extra/tokencount", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: text }),
      })
    ).value;
  },
};
