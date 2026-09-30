import { base, json, nativeParams, type Provider } from "./types";
export const horde: Provider = {
  async listModels(c) {
    const data = await json(base(c) + "/api/v2/status/models?type=text");
    if (!Array.isArray(data))
      throw new Error("AI Horde returned an invalid model list.");
    return data
      .map((item: { name?: unknown }) => item?.name)
      .filter((name: unknown): name is string => typeof name === "string")
      .sort((a: string, b: string) => a.localeCompare(b));
  },
  async generate(r) {
    const root = base(r.connection);
    const headers = {
      "Content-Type": "application/json",
      apikey: r.key || "0000000000",
      "Client-Agent": "Margin:1.0:local",
    };
    const p = nativeParams(r);
    const { prompt, ...params } = p;
    const job = await json(root + "/api/v2/generate/text/async", {
      method: "POST",
      headers,
      signal: r.signal,
      body: JSON.stringify({
        prompt,
        params: { ...params, n: 1 },
        models: r.connection.model ? [r.connection.model] : [],
      }),
    });
    try {
      while (true) {
        r.signal.throwIfAborted();
        const result = await json(
          root + "/api/v2/generate/text/status/" + job.id,
          { headers, signal: r.signal },
        );
        if (result.faulted) throw new Error("Horde generation failed.");
        if (result.done) {
          const text = result.generations?.[0]?.text;
          if (typeof text !== "string")
            throw new Error("Horde returned no text.");
          r.onToken(text);
          return text;
        }
        await new Promise<void>((resolve, reject) => {
          const abort = () => {
            clearTimeout(timer);
            reject(new DOMException("Aborted", "AbortError"));
          };
          const timer = setTimeout(() => {
            r.signal.removeEventListener("abort", abort);
            resolve();
          }, 1500);
          r.signal.addEventListener("abort", abort, { once: true });
        });
      }
    } finally {
      if (r.signal.aborted)
        await fetch(root + "/api/v2/generate/text/status/" + job.id, {
          method: "DELETE",
          headers,
        }).catch(() => {});
    }
  },
  async info(c) {
    const models = await json(base(c) + "/api/v2/status/models?type=text");
    return { model: c.model || models[0]?.name || "AI Horde" };
  },
};
