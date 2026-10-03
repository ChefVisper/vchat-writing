import { afterEach, describe, it, expect, vi } from "vitest";
import { providers } from "../src/providers";
import { stream, type Request } from "../src/providers/types";
import { defaults } from "../src/types";
const req = (): Request => ({
  prompt: "Continue.",
  settings: { ...defaults },
  connection: { kind: "kobold", url: "http://localhost:5001", model: "test" },
  key: "",
  signal: new AbortController().signal,
  onToken: vi.fn(),
});
afterEach(() => vi.unstubAllGlobals());
describe("provider protocol", () => {
  it("omits samplers that the OpenRouter model catalog does not support", async () => {
    let body: any;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url, init) => {
        if (!init?.method)
          return Response.json({
            data: [
              {
                id: "test/no-samplers",
                supported_parameters: ["temperature", "top_p"],
              },
            ],
          });
        body = JSON.parse(init.body);
        return Response.json({
          choices: [{ message: { content: "A passage." } }],
        });
      }),
    );
    const r = req();
    r.connection = {
      kind: "openrouter",
      url: "https://openrouter.ai/api/v1",
      model: "test/no-samplers",
    };
    r.key = "fake-key";
    r.settings.streaming = false;
    await providers.openrouter.listModels(r.connection, r.key);
    await providers.openrouter.generate(r);
    expect(body).not.toHaveProperty("top_k");
    expect(body).not.toHaveProperty("min_p");
    expect(body).not.toHaveProperty("repetition_penalty");
  });
  it("decodes streaming events split across network chunks", async () => {
    const chunks = [
      'data: {"token":"hel',
      'lo"}\n\nda',
      'ta: {"token":" world"}\n\ndata: [DONE]\n\n',
    ];
    const body = new ReadableStream({
      start(c) {
        chunks.forEach((t) => c.enqueue(new TextEncoder().encode(t)));
        c.close();
      },
    });
    const onToken = vi.fn();
    expect(await stream(new Response(body), onToken, (o) => o.token)).toBe(
      "hello world",
    );
    expect(onToken).toHaveBeenCalledTimes(2);
  });
  it("only sends supported completion parameters to OpenAI compatible servers", async () => {
    let body: any;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url, init) => {
        body = JSON.parse(init.body);
        return Response.json({ choices: [{ text: " prose" }] });
      }),
    );
    const r = req();
    r.settings.streaming = false;
    r.connection.kind = "openai";
    r.connection.url = "http://localhost:1234/v1";
    expect(await providers.openai.generate(r)).toBe(" prose");
    expect(body).not.toHaveProperty("top_k");
    expect(body).not.toHaveProperty("rep_pen");
    expect(body).toHaveProperty("max_tokens", 240);
  });
  it("uses native streaming endpoint and sampler names", async () => {
    const mock = vi.fn(async () => new Response('data: {"token":"prose"}\n\n'));
    vi.stubGlobal("fetch", mock);
    expect(await providers.kobold.generate(req())).toBe("prose");
    expect(mock.mock.calls[0][0]).toContain("/api/extra/generate/stream");
    const body = JSON.parse((mock.mock.calls[0] as any)[1].body);
    expect(body.max_length).toBe(240);
    expect(body.rep_pen).toBe(1.1);
  });
  it("polls and collects Horde output", async () => {
    const mock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ id: "job" }))
      .mockResolvedValueOnce(
        Response.json({ done: true, generations: [{ text: "Horde prose" }] }),
      );
    vi.stubGlobal("fetch", mock);
    const r = req();
    r.connection = { kind: "horde", url: "https://aihorde.net", model: "" };
    expect(await providers.horde.generate(r)).toBe("Horde prose");
    expect(mock.mock.calls[0][0]).toContain("/api/v2/generate/text/async");
    expect(mock.mock.calls[1][0]).toContain("/api/v2/generate/text/status/job");
  });
  it("sends the native abort request", async () => {
    const mock = vi.fn().mockResolvedValue(Response.json({ success: true }));
    vi.stubGlobal("fetch", mock);
    await providers.kobold.abort!(req().connection, "");
    expect(mock.mock.calls[0][0]).toContain("/api/extra/abort");
    expect(mock.mock.calls[0][1].method).toBe("POST");
  });
  it("rejects HTTP errors rather than appending error bodies", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("error", { status: 500 })),
    );
    await expect(providers.kobold.generate(req())).rejects.toThrow("HTTP 500");
  });
});

describe("OpenRouter", () => {
  it("identifies truncated note output before trying to parse JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          choices: [
            { message: { content: '{"updates":[' }, finish_reason: "length" },
          ],
        }),
      ),
    );
    const r = req();
    r.key = "test-key";
    r.purpose = "notes";
    r.settings.streaming = false;
    await expect(providers.openrouter.generate(r)).rejects.toThrow(
      "Note output was cut off",
    );
  });
  it("does not silently accept a reasoning-only stream", async () => {
    const body =
      'data: {"choices":[{"delta":{"reasoning":"thinking"}}]}\n\n' +
      'data: {"choices":[{"delta":{},"finish_reason":"length"}]}\n\n' +
      "data: [DONE]\n\n";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body)));
    const r = req();
    r.connection.kind = "openrouter";
    r.key = "test-key";
    await expect(providers.openrouter.generate(r)).rejects.toThrow(
      "Increase Output limit",
    );
    expect(r.onToken).not.toHaveBeenCalled();
  });
  it("fetches text model IDs", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          data: [
            { id: "writer/b", architecture: { output_modalities: ["text"] } },
            { id: "image/a", architecture: { output_modalities: ["image"] } },
            { id: "writer/a", architecture: { output_modalities: ["text"] } },
          ],
        }),
      ),
    );
    expect(
      await providers.openrouter.listModels(
        { kind: "openrouter", url: "https://openrouter.ai/api/v1", model: "" },
        "test-key",
      ),
    ).toEqual(["writer/a", "writer/b"]);
  });
  it("shows the provider's 403 reason and redacts the key", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json(
          {
            error: { message: "Request blocked by content filter; test-key" },
          },
          { status: 403 },
        ),
      ),
    );
    const r = req();
    r.key = "test-key";
    r.connection.kind = "openrouter";
    await expect(providers.openrouter.generate(r)).rejects.toThrow(
      "OpenRouter HTTP 403: Request blocked by content filter; [redacted]",
    );
  });
  it("streams chat deltas and ignores reasoning and keepalive events", async () => {
    const mock = vi
      .fn()
      .mockResolvedValue(
        new Response(
          ': keepalive\n\ndata: {"choices":[{"delta":{"reasoning":"private"}}]}\n\ndata: {"choices":[{"delta":{"content":" next prose"}}]}\n\ndata: [DONE]\n\n',
        ),
      );
    vi.stubGlobal("fetch", mock);
    const r = req();
    r.connection = {
      kind: "openrouter",
      url: "https://openrouter.ai/api/v1",
      model: "test/writer",
    };
    r.key = "test-key";
    expect(await providers.openrouter.generate(r)).toBe(" next prose");
    expect(mock.mock.calls[0][0]).toBe(
      "https://openrouter.ai/api/v1/chat/completions",
    );
    const body = JSON.parse(mock.mock.calls[0][1].body);
    expect(body.messages[0].role).toBe("system");
    expect(body.messages[1]).toEqual({ role: "user", content: r.prompt });
    expect(body).not.toHaveProperty("rep_pen");
    expect(body).not.toHaveProperty("prompt");
    expect(mock.mock.calls[0][1].signal).toBe(r.signal);
  });
  it("returns nonstreaming JSON for the note updater", async () => {
    const output = '{"updates":[]}';
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ choices: [{ message: { content: output } }] }),
        ),
    );
    const r = req();
    r.key = "test-key";
    r.connection.kind = "openrouter";
    r.settings.streaming = false;
    expect(await providers.openrouter.generate(r)).toBe(output);
  });
  it("checks credentials and model context without generating", async () => {
    const mock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ data: {} }))
      .mockResolvedValueOnce(
        Response.json({ data: [{ id: "test/writer", context_length: 32000 }] }),
      );
    vi.stubGlobal("fetch", mock);
    expect(
      await providers.openrouter.info(
        {
          kind: "openrouter",
          url: "https://openrouter.ai/api/v1",
          model: "test/writer",
        },
        "test-key",
      ),
    ).toEqual({ model: "test/writer", context: 32000 });
    expect(mock.mock.calls[0][0]).toContain("/key");
  });
  it("requires credentials before sending story text", async () => {
    const mock = vi.fn();
    vi.stubGlobal("fetch", mock);
    await expect(providers.openrouter.generate(req())).rejects.toThrow(
      "API key",
    );
    expect(mock).not.toHaveBeenCalled();
  });
});
