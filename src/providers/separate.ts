import {
  ThinkingSplitter,
  fitTokens,
  tokenEstimate,
} from "../generation/thinking";
import type { Provider, Request } from "./types";

export function separate(provider: Provider): Provider {
  return {
    ...provider,
    async generate(r: Request) {
      if (
        r.images?.length &&
        !["openrouter", "nanogpt"].includes(r.connection.kind)
      )
        throw new Error(
          "Image input needs a vision model on NanoGPT or OpenRouter. Remove the image to use this provider with text.",
        );
      const structured = r.purpose === "notes" || r.purpose === "create";
      const controller = new AbortController();
      const abort = () => controller.abort(r.signal.reason);
      r.signal.addEventListener("abort", abort, { once: true });
      if (r.signal.aborted) abort();
      let output = "",
        reasoning = "",
        stopped = false;
      const stop = () => {
        if (stopped) return;
        stopped = true;
        controller.abort();
      };
      const thoughts = (text: string) => {
        const next = fitTokens(reasoning + text, r.settings.thinkingMaxTokens);
        const delta = next.slice(reasoning.length);
        reasoning = next;
        if (delta) r.onReasoning?.(delta);
      };
      const splitter = new ThinkingSplitter(
        r.settings,
        (text) => {
          // Never truncate structured note/creation JSON with a prose token estimate.
          const next = structured
            ? output + text
            : fitTokens(output + text, r.settings.maxTokens);
          const delta = next.slice(output.length);
          output = next;
          if (delta) r.onToken(delta);
          if (
            !structured &&
            (delta.length < text.length ||
              tokenEstimate(output) >= r.settings.maxTokens)
          )
            stop();
        },
        thoughts,
      );
      let nativeStop: Promise<unknown> | undefined;
      try {
        await provider.generate({
          ...r,
          signal: controller.signal,
          onToken: (text) => {
            splitter.push(text);
            if (stopped && !nativeStop)
              nativeStop = provider
                .abort?.(r.connection, r.key)
                .catch(() => {});
          },
          onReasoning: thoughts,
        });
      } catch (e) {
        if (!stopped || r.signal.aborted) throw e;
      } finally {
        splitter.finish();
        await nativeStop;
        r.signal.removeEventListener("abort", abort);
      }
      if (!output.trim() && !r.signal.aborted)
        throw new Error(
          "The model returned no visible text. Reasoning is kept in Thinking. Increase Thinking Output or select a model that returns an answer.",
        );
      return output;
    },
  };
}
