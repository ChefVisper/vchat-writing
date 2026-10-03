import { afterEach, describe, expect, it, vi } from "vitest";
import { defaults, newStory, newNote } from "../src/types";
import {
  ThinkingSplitter,
  tokenEstimate,
  thinkingContext,
} from "../src/generation/thinking";
import { providers } from "../src/providers";
import { separate } from "../src/providers/separate";
import {
  reasoningText,
  type Request,
  type Provider,
} from "../src/providers/types";
import { buildPrompt } from "../src/context/promptBuilder";
import { buildNotePrompt } from "../src/generation/stateUpdater";
import { buildRewritePrompt } from "../src/generation/rewrite";
import { exportProject, importProject } from "../src/storage/transfer";

afterEach(() => vi.unstubAllGlobals());
const request = (): Request => ({
  prompt: "Continue.",
  settings: { ...defaults },
  connection: {
    kind: "nanogpt",
    url: "https://api.nano-gpt.com/api/v1",
    model: "test/reasoner",
  },
  key: "fake-key",
  signal: new AbortController().signal,
  onToken: vi.fn(),
  onReasoning: vi.fn(),
});
describe("thinking separation", () => {
  it.each([false, true])(
    "keeps split tags private with Thinking=%s",
    (thinking) => {
      let prose = "",
        thoughts = "";
      const split = new ThinkingSplitter(
        {
          ...defaults,
          thinking,
          thinkingPrefix: "[analysis]",
          thinkingSuffix: "[/analysis]",
        },
        (t) => (prose += t),
        (t) => (thoughts += t),
      );
      const text =
        "[analysis]private[/analysis]A sentence. <think>another thought</think>\nNext paragraph.";
      for (const char of text) split.push(char);
      split.finish();
      expect(prose).toBe("A sentence. \nNext paragraph.");
      expect(thoughts).toBe("privateanother thought");
    },
  );
  it("keeps unclosed thoughts private on EOF or Stop and handles server prefill", () => {
    let prose = "",
      thoughts = "";
    const split = new ThinkingSplitter(
      { ...defaults, thinkingPrefill: true },
      (t) => (prose += t),
      (t) => (thoughts += t),
    );
    split.push("private</think>Visible. <think>unfinished</thi");
    split.finish();
    expect(prose).toBe("Visible. ");
    expect(thoughts).toBe("privateunfinished");
  });
  it("does not duplicate reasoning aliases or expose encrypted details", () => {
    expect(
      reasoningText({
        reasoning: "one",
        reasoning_content: "one",
        reasoning_details: [{ text: "one" }],
      }),
    ).toBe("one");
    expect(
      reasoningText({
        reasoning_details: [
          { type: "reasoning.encrypted", text: "secret" },
          { type: "reasoning.summary", summary: "summary" },
        ],
      }),
    ).toBe("summary");
  });
  it("reserves 150 prose tokens independently and stops the native backend at its cap", async () => {
    const abort = vi.fn(async () => {});
    const raw: Provider = {
      listModels: async () => [],
      info: async () => ({ model: "test" }),
      abort,
      generate: async (r) => {
        r.onReasoning?.("thought ".repeat(100));
        r.onToken("<think>more private</think>" + "A".repeat(1500));
        expect(r.signal.aborted).toBe(true);
        r.signal.throwIfAborted();
        return "";
      },
    };
    const r = request();
    r.settings.maxTokens = 150;
    r.settings.thinkingMaxTokens = 20;
    const result = await separate(raw).generate(r);
    expect(tokenEstimate(result)).toBe(150);
    expect(result).not.toContain("private");
    expect(
      tokenEstimate((r.onReasoning as any).mock.calls.flat().join("")),
    ).toBeLessThanOrEqual(20);
    expect(abort).toHaveBeenCalledOnce();
  });
  it("propagates user cancellation while retaining captured reasoning", async () => {
    const user = new AbortController();
    const r = request();
    r.signal = user.signal;
    const raw: Provider = {
      listModels: async () => [],
      info: async () => ({ model: "test" }),
      generate: async (inner) => {
        inner.onToken("<think>private");
        user.abort();
        inner.signal.throwIfAborted();
        return "";
      },
    };
    await expect(separate(raw).generate(r)).rejects.toThrow();
    expect(r.onToken).not.toHaveBeenCalled();
    expect(r.onReasoning).toHaveBeenCalledWith("private");
  });
  it("uses only explicit opt-ins across writing, notes, rewrite and export", () => {
    const s = newStory();
    s.text = "A sentence.";
    s.notes = [newNote()];
    s.thoughts = [
      {
        id: "one",
        at: 1,
        model: "test",
        provider: "nanogpt",
        purpose: "writing",
        text: "Selected reference.",
        selected: true,
      },
      {
        id: "two",
        at: 2,
        model: "test",
        provider: "nanogpt",
        purpose: "notes",
        text: "Unselected secret.",
        selected: false,
      },
    ];
    expect(thinkingContext(s)).toBe("");
    expect(buildPrompt(s).prompt).not.toContain("Selected reference.");
    s.settings.includeThinking = true;
    for (const prompt of [
      buildPrompt(s).prompt,
      buildNotePrompt(s, s.text).prompt,
      buildRewritePrompt(s, 0, s.text.length, "Polish"),
    ]) {
      expect(prompt).toContain("Selected reference.");
      expect(prompt).not.toContain("Unselected secret.");
    }
    expect(importProject(exportProject(s))).toEqual(s);
  });
});
describe("NanoGPT and reasoning protocols", () => {
  it("fetches text models and context from NanoGPT's dedicated endpoint", async () => {
    const mock = vi.fn(async () =>
      Response.json({
        data: [
          { id: "test/reasoner", context_length: 64000 },
          { id: "image", architecture: { output_modalities: ["image"] } },
        ],
      }),
    );
    vi.stubGlobal("fetch", mock);
    const r = request();
    expect(await providers.nanogpt.listModels(r.connection, r.key)).toEqual([
      "test/reasoner",
    ]);
    expect(await providers.nanogpt.info(r.connection, r.key)).toEqual({
      model: "test/reasoner",
      context: 64000,
    });
    expect(mock.mock.calls[0][0]).toBe(
      "https://api.nano-gpt.com/api/v1/models",
    );
  });
  it("sends all samplers and combined budget, captures both SSE reasoning fields with Thinking off", async () => {
    let body: any;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_u, init) => {
        body = JSON.parse(init.body);
        return new Response(
          'data: {"choices":[{"delta":{"reasoning":"first "}}]}\n\ndata: {"choices":[{"delta":{"reasoning_content":"second"}}]}\n\ndata: {"choices":[{"delta":{"content":"Visible answer."}}]}\n\ndata: [DONE]\n\n',
        );
      }),
    );
    const r = request();
    r.settings.maxTokens = 150;
    r.settings.thinkingMaxTokens = 100;
    expect(await providers.nanogpt.generate(r)).toBe("Visible answer.");
    expect(body).toMatchObject({
      max_tokens: 250,
      top_k: 40,
      min_p: 0,
      repetition_penalty: 1.1,
      reasoning: { effort: "none", exclude: false },
    });
    expect((r.onReasoning as any).mock.calls.flat().join("")).toBe(
      "first second",
    );
    expect((r.onToken as any).mock.calls.flat().join("")).toBe(
      "Visible answer.",
    );
  });
  it("separates nonstreaming note reasoning without truncating valid JSON", async () => {
    const json = '{"updates":[]}';
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          choices: [
            { message: { reasoning_content: "Check notes.", content: json } },
          ],
        }),
      ),
    );
    const r = request();
    r.settings.streaming = false;
    r.purpose = "notes";
    r.settings.maxTokens = 1;
    expect(await providers.nanogpt.generate(r)).toBe(json);
    expect(r.onReasoning).toHaveBeenCalledWith("Check notes.");
  });
  it("reports reasoning-only output and still preserves the thoughts", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            'data: {"choices":[{"delta":{"reasoning":"private"}}]}\n\n',
          ),
      ),
    );
    const r = request();
    await expect(providers.nanogpt.generate(r)).rejects.toThrow(
      "no visible text",
    );
    expect(r.onReasoning).toHaveBeenCalledWith("private");
  });
  it("uses OpenRouter reasoning token budgets only when advertised, including mandatory reasoning", async () => {
    let body: any;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_u, init) => {
        if (!init?.method)
          return Response.json({
            data: [
              {
                id: "test/mandatory",
                reasoning: {
                  mandatory: true,
                  supports_max_tokens: true,
                  supported_efforts: ["high"],
                },
              },
            ],
          });
        body = JSON.parse(init.body);
        return Response.json({
          choices: [{ message: { reasoning: "Thought.", content: "Answer." } }],
        });
      }),
    );
    const r = request();
    r.connection = {
      kind: "openrouter",
      url: "https://openrouter.ai/api/v1",
      model: "test/mandatory",
    };
    r.settings.streaming = false;
    await providers.openrouter.listModels(r.connection, r.key);
    expect(await providers.openrouter.generate(r)).toBe("Answer.");
    expect(body.reasoning).toEqual({
      enabled: true,
      max_tokens: 2048,
      exclude: false,
    });
    expect(r.onReasoning).toHaveBeenCalledWith("Thought.");
  });
});
