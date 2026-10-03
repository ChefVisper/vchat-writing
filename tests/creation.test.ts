import { afterEach, describe, it, expect, vi } from "vitest";
import { newStory } from "../src/types";
import {
  creationPrompt,
  DEFAULT_CREATE_PROMPT,
  parseCreation,
  creationStory,
} from "../src/generation/creation";
import { providers } from "../src/providers";
import { exportProject, importProject } from "../src/storage/transfer";
afterEach(() => vi.unstubAllGlobals());
describe("creation", () => {
  it("parses complete wrapped JSON with quoted braces and rejects incomplete results", () => {
    const d = {
      title: "Mira",
      memory: '{{char}} is shy, carries a "{moon}" key.',
      startingText: "Mira waved.\n\n“Hello.”",
    };
    expect(
      parseCreation("Preface\n```json\n" + JSON.stringify(d) + "\n```"),
    ).toEqual(d);
    expect(() => parseCreation('{"title":"x","memory":"m"}')).toThrow(
      "No complete",
    );
    expect(() =>
      parseCreation(JSON.stringify({ ...d, startingText: "" })),
    ).toThrow();
  });
  it("protects brief and image allowance, accepts image-only input", () => {
    const s = newStory();
    expect(() =>
      creationPrompt(
        "",
        DEFAULT_CREATE_PROMPT,
        s.settings,
        s.connection,
        false,
      ),
    ).toThrow("Describe");
    expect(
      creationPrompt("", DEFAULT_CREATE_PROMPT, s.settings, s.connection, true),
    ).toContain("AUTHOR BRIEF");
    s.settings.context = 3000;
    expect(() =>
      creationPrompt(
        "Brief",
        DEFAULT_CREATE_PROMPT,
        s.settings,
        s.connection,
        true,
      ),
    ).toThrow("Create Max Context");
  });
  it("creates a fresh story with writing settings, memory and private creation thoughts", () => {
    const source = newStory();
    source.text = "Existing story.";
    source.nextInstruction = "Existing direction";
    const d = {
      title: "Mira",
      memory: "{{char}} is tall.",
      startingText: "Mira entered.",
    };
    const s = creationStory(d, source, "Private plan.", {
      kind: "nanogpt",
      url: "https://api.nano-gpt.com/api/v1",
      model: "vision",
    });
    expect(s.text).toBe(d.startingText);
    expect(s.memory.content).toBe(d.memory);
    expect(s.settings).toEqual(source.settings);
    expect(s.nextInstruction).toBeUndefined();
    expect(s.past).toEqual([]);
    expect(s.thoughts?.[0]).toMatchObject({
      purpose: "create",
      selected: false,
    });
    expect(importProject(exportProject(s))).toEqual(s);
    expect(source.text).toBe("Existing story.");
  });
  it.each(["nanogpt", "openrouter"] as const)(
    "sends multimodal creation content and keeps structured JSON intact on %s",
    async (kind) => {
      const s = newStory();
      const d = {
        title: "Mira",
        memory: "{{char}} is tall.",
        startingText: "Mira entered.",
      };
      let body: any;
      vi.stubGlobal(
        "fetch",
        vi.fn(async (_u, init) => {
          body = JSON.parse(init.body);
          return Response.json({
            choices: [
              {
                message: {
                  content: JSON.stringify(d),
                  reasoning_content: "Check reference.",
                },
              },
            ],
          });
        }),
      );
      const onReasoning = vi.fn();
      const r = {
        prompt: "Create a character.",
        connection: {
          kind,
          url: "https://test.invalid/v1",
          model: "test/vision",
        },
        settings: { ...s.settings, maxTokens: 1, streaming: false },
        key: "test-key",
        purpose: "create" as const,
        images: ["data:image/png;base64,YQ=="],
        signal: new AbortController().signal,
        onToken: vi.fn(),
        onReasoning,
      };
      expect(parseCreation(await providers[kind].generate(r))).toEqual(d);
      expect(body.messages[1].content[1]).toEqual({
        type: "image_url",
        image_url: { url: r.images[0] },
      });
      expect(body.messages[0].content).toContain("startingText");
      expect(onReasoning).toHaveBeenCalledWith("Check reference.");
    },
  );
  it("rejects image input on text-only adapters before sending private input", async () => {
    const mock = vi.fn();
    vi.stubGlobal("fetch", mock);
    const s = newStory();
    await expect(
      providers.kobold.generate({
        prompt: "Private",
        connection: s.connection,
        settings: s.settings,
        key: "",
        purpose: "create",
        images: ["data:image/png;base64,YQ=="],
        signal: new AbortController().signal,
        onToken: () => {},
      }),
    ).rejects.toThrow("vision model");
    expect(mock).not.toHaveBeenCalled();
  });
  it.each(["nanogpt", "openrouter"] as const)(
    "blocks fetched text-only models on %s",
    async (kind) => {
      const mock = vi.fn(async () =>
        Response.json({
          data: [
            {
              id: "test/text-only",
              architecture: {
                input_modalities: ["text"],
                output_modalities: ["text"],
              },
            },
          ],
        }),
      );
      vi.stubGlobal("fetch", mock);
      const s = newStory(),
        connection = {
          kind,
          url: "https://catalog-test.invalid/v1",
          model: "test/text-only",
        };
      await providers[kind].listModels(connection, "key");
      await expect(
        providers[kind].generate({
          prompt: "Create",
          connection,
          settings: s.settings,
          key: "key",
          purpose: "create",
          images: ["data:image/png;base64,YQ=="],
          signal: new AbortController().signal,
          onToken: () => {},
        }),
      ).rejects.toThrow("does not accept images");
      expect(mock).toHaveBeenCalledTimes(1);
    },
  );
});
