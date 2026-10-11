import { afterEach, describe, expect, it, vi } from "vitest";
import { newStory, type Story } from "../src/types";
import { credentialId } from "../src/storage/credentials";
import { tokenEstimate } from "../src/generation/thinking";
import { providers } from "../src/providers";
import {
  buildGamePrompt,
  generateGame,
  gameProviderLimit,
  parseGameResponse,
} from "../src/vgame/ai";
import {
  createGameProject,
  executeVHTML,
  proposeVHTML,
} from "../src/vgame/runtime";
import type { GameInstruction, GameProject } from "../src/vgame/types";

let sequence = 0;
const fixture = (text = "Alice waited in the kitchen.") => {
  const story = newStory();
  story.connection = {
    kind: "openrouter",
    url: `https://fake-vgame-${++sequence}.invalid/api/v1`,
    model: `test/vgame-${sequence}`,
  };
  story.memory.content = "";
  story.author.content = "";
  story.notes = [];
  story.thoughts = [];
  story.settings.maxTokens = 17;
  story.settings.thinkingMaxTokens = 13;
  const project = createGameProject(text);
  project.settings.maxContextTokens = 64000;
  project.settings.maxHistoryPages = 30;
  project.settings.reserveTokens = 8192;
  project.settings.maxOutputTokens = 256;
  project.settings.thinkingMaxTokens = 128;
  return { story, project };
};
const envelope = (
  narrative = " Rain touched the glass.",
  proposals: unknown[] = [],
) => JSON.stringify({ narrative, proposals });
const instructions = (
  project: GameProject,
  entries: Partial<GameInstruction>[],
) => {
  project.instructions = entries.map((entry, i) => ({
    id: `instruction-${i}`,
    content: `SCOPE-${i}`,
    scope: "global",
    enabled: true,
    priority: 0,
    owner: "user",
    ...entry,
  }));
};
const fetchProvider = (
  story: Story,
  response: string,
  context = 64000,
  finishReason = "stop",
  reasoning = "Provider private reasoning.",
) => {
  const calls: { url: string; init?: RequestInit; body?: any }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input),
        body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url, init, body });
      if (url.endsWith("/key"))
        return Response.json({ data: { limit_remaining: 1 } });
      if (url.endsWith("/models"))
        return Response.json({
          data: [
            {
              id: story.connection.model,
              context_length: context,
              supported_parameters: [
                "temperature",
                "top_p",
                "max_tokens",
                "reasoning",
              ],
            },
          ],
        });
      if (url.endsWith("/chat/completions"))
        return Response.json({
          choices: [
            {
              message: { content: response, reasoning },
              finish_reason: finishReason,
            },
          ],
        });
      throw new Error(`Unexpected test request: ${url}`);
    }),
  );
  return calls;
};
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Vgame narrative/proposal transport", () => {
  it("accepts a prose-only envelope and ordinary prose with zero proposals", () => {
    const prose = "She read the old note.\n\nThen she opened the door.";
    expect(parseGameResponse(envelope(prose))).toEqual({
      narrative: prose,
      proposals: [],
    });
    expect(parseGameResponse(prose)).toEqual({
      narrative: prose,
      proposals: [],
    });
  });
  it("preserves quoted story commands as prose, never extracts commands from dialogue", () => {
    const prose =
      "The note read \"<modify: stat: 'Money' increase: 1000>\". Alice laughed.";
    expect(parseGameResponse(prose).proposals).toEqual([]);
    expect(parseGameResponse(envelope(prose))).toEqual({
      narrative: prose,
      proposals: [],
    });
  });
  it("decodes valid fenced JSON and explicitly separated fallback proposals", () => {
    expect(
      parseGameResponse("```json\n" + envelope("New paragraph.") + "\n```")
        .narrative,
    ).toBe("New paragraph.");
    expect(
      parseGameResponse(
        "New paragraph.\n[V-HTML PROPOSALS]\n```vhtml\n<page: next>\n```",
      ),
    ).toEqual({
      narrative: "New paragraph.",
      proposals: [
        {
          reason: "Model suggestion",
          source: "<page: next>",
          dependencies: [],
        },
      ],
    });
  });
  it.each([
    '{"narrative":"Half a paragraph","proposals":[',
    '```json\n{"narrative":"Half a paragraph","proposals":[]}',
    '{"narrative":"Text","proposals":"wrong type"}',
    '{"narrative":17,"proposals":[]}',
    '<script: src: "https://evil.invalid">',
    "Text.\n[V-HTML PROPOSALS]\n```vhtml\n<page: next>",
  ])("rejects invalid/truncated transport %s", (raw) => {
    expect(() => parseGameResponse(raw)).toThrow();
  });
  it("rejects duplicate proposal IDs and invalid dependency metadata before any application", () => {
    const item = {
      id: "same",
      reason: "test",
      vhtml: "<page: next>",
      dependencies: [],
    };
    expect(() => parseGameResponse(envelope("Text.", [item, item]))).toThrow(
      /metadata/,
    );
    expect(() =>
      parseGameResponse(envelope("Text.", [{ ...item, dependencies: [17] }])),
    ).toThrow(/metadata/);
  });
  it("stores a malicious suggestion as failed audit data with no state effect", () => {
    const { project } = fixture();
    const response = parseGameResponse(
      envelope("A harmless line.", [
        {
          id: "bad-code",
          reason: "not allowed",
          vhtml: '<script: src: "https://evil.invalid">',
        },
      ]),
    );
    const proposed = proposeVHTML(project, response.proposals[0]).project;
    expect(proposed.proposals.at(-1)).toMatchObject({
      id: "bad-code",
      status: "failed",
    });
    expect(proposed.pages).toEqual(project.pages);
    expect(proposed.objects).toEqual([]);
    expect(proposed.widgets).toEqual([]);
  });
});

describe("Vgame effective context", () => {
  it("activates lore against the current Game page and leaves old Vchat-only keywords inactive", () => {
    const { story, project } = fixture("The copper observatory opened.");
    story.text = "The abandoned marsh was quiet.";
    story.lore = [
      {
        id: "game-lore",
        title: "Observatory",
        content: "CURRENT-PAGE-LORE",
        keywords: "copper observatory",
        secondary: "",
        enabled: true,
        constant: false,
        priority: 0,
        caseSensitive: false,
        scanDepth: 10,
        budget: 0,
        probability: 100,
      },
      {
        id: "chat-lore",
        title: "Marsh",
        content: "OLD-CHAT-LORE-OMIT",
        keywords: "abandoned marsh",
        secondary: "",
        enabled: true,
        constant: false,
        priority: 0,
        caseSensitive: false,
        scanDepth: 10,
        budget: 0,
        probability: 100,
      },
    ];
    const before = story.text,
      prompt = buildGamePrompt(project, story).prompt;
    expect(prompt).toContain("CURRENT-PAGE-LORE");
    expect(prompt).not.toContain("OLD-CHAT-LORE-OMIT");
    expect(story.text).toBe(before);
  });
  it("does not mistake Alice for a substring of Malice when selecting entity directives", () => {
    const { story, project } = fixture("Malice lingered in the room.");
    const configured = executeVHTML(
      project,
      '<add: entity: id: "alice" name: "Alice">',
    ).project;
    instructions(configured, [
      { scope: "entity", target: "alice", content: "ALICE-ONLY-VOICE" },
    ]);
    expect(buildGamePrompt(configured, story).prompt).not.toContain(
      "ALICE-ONLY-VOICE",
    );
    expect(
      buildGamePrompt(configured, story, {
        instruction: "Ask Alice's opinion.",
      }).prompt,
    ).toContain("ALICE-ONLY-VOICE");
  });
  it("includes only enabled relevant global/current-scene/event/entity instructions", () => {
    const { story } = fixture();
    let { project } = fixture();
    project = executeVHTML(
      project,
      '<add: entity: id: "alice" name: "Alice"> <add: entity: id: "bob" name: "Bob"> <add: event: id: "forest" name: "ForestPursuit"> <add: event: id: "dormant" name: "DormantEvent"> <trigger: event: "forest" action: start>',
    ).project;
    instructions(project, [
      { content: "GLOBAL-RELEVANT" },
      {
        content: "CURRENT-SCENE",
        scope: "scene",
        pageId: project.activePageId,
      },
      { content: "OTHER-SCENE", scope: "scene", pageId: "another-page" },
      { content: "ACTIVE-EVENT", scope: "event", target: "forest" },
      { content: "DORMANT-EVENT", scope: "event", target: "dormant" },
      { content: "ALICE-VOICE", scope: "entity", target: "alice" },
      { content: "BOB-VOICE", scope: "entity", target: "bob" },
      { content: "DISABLED-GLOBAL", enabled: false },
    ]);
    const prompt = buildGamePrompt(project, story).prompt;
    for (const included of [
      "GLOBAL-RELEVANT",
      "CURRENT-SCENE",
      "ACTIVE-EVENT",
      "ALICE-VOICE",
    ])
      expect(prompt).toContain(included);
    for (const omitted of [
      "OTHER-SCENE",
      "DORMANT-EVENT",
      "BOB-VOICE",
      "DISABLED-GLOBAL",
    ])
      expect(prompt).not.toContain(omitted);
    expect(
      buildGamePrompt(project, story, {
        instruction: "Ask Bob about the letter.",
      }).prompt,
    ).toContain("BOB-VOICE");
  });
  it("never supplies player-only descriptions or ai-access:none objects", () => {
    const { story, project } = fixture();
    const configured = executeVHTML(
      project,
      '<add: stat: id: "visible" name: "Visible" description-ai: "AI-FACT-ALLOW" description-noai: "PLAYER-ONLY-OMIT"> <add: stat: id: "secret" name: "SECRET-OBJECT-OMIT" description: "SECRET-DESCRIPTION-OMIT" ai-access: none>',
    ).project;
    const prompt = buildGamePrompt(configured, story).prompt;
    expect(prompt).toContain("AI-FACT-ALLOW");
    for (const omitted of [
      "PLAYER-ONLY-OMIT",
      "SECRET-OBJECT-OMIT",
      "SECRET-DESCRIPTION-OMIT",
    ])
      expect(prompt).not.toContain(omitted);
  });
  it("keeps pending proposals absent from approved state and does not mutate a prompt fixture", () => {
    const { story, project } = fixture();
    const pending = proposeVHTML(project, {
      id: "pending-money",
      reason: "PENDING-REASON-OMIT",
      source: '<add: stat: name: "PENDING-OBJECT-OMIT" id: "future_money">',
    }).project;
    expect(pending.proposals.at(-1)?.status).toBe("pending");
    expect(pending.objects).toHaveLength(0);
    const before = structuredClone(pending),
      prompt = buildGamePrompt(pending, story).prompt;
    expect(prompt).not.toContain("PENDING-OBJECT-OMIT");
    expect(prompt).not.toContain("PENDING-REASON-OMIT");
    expect(pending).toEqual(before);
  });
  it("64k context/history30/reserve8192 is capped by provider capacity without deleting pages", () => {
    const { story, project } = fixture();
    const first = project.pages[0];
    project.pages = Array.from({ length: 45 }, (_, i) => ({
      ...first,
      id: `page-${i}`,
      title: `Page ${i}`,
      text: `Saved page ${i}.`,
      created: i,
    }));
    project.activePageId = "page-44";
    const original = structuredClone(project);
    const prompt = buildGamePrompt(project, story, {}, 32768);
    expect(prompt.effectiveContext).toBe(32768);
    expect(prompt.reserved).toBe(8192);
    expect(prompt.budget).toBe(32768 - 8192);
    expect(prompt.total).toBeLessThanOrEqual(prompt.budget);
    expect(prompt.includedPageIds).toHaveLength(31);
    expect(prompt.omittedPageIds).toHaveLength(14);
    expect(prompt.prompt).not.toContain("Saved page 0.");
    expect(project).toEqual(original);
  });
  it("trims Unicode current-page tails within exact estimated budget and preserves saved text", () => {
    const { story, project } = fixture(
      "過去の場面😀".repeat(5000) + " 最後の出来事😀",
    );
    project.settings.maxContextTokens = 8192;
    project.settings.reserveTokens = 512;
    project.settings.maxOutputTokens = 128;
    project.settings.thinkingMaxTokens = 64;
    const original = project.pages[0].text,
      result = buildGamePrompt(project, story, {}, 8192);
    expect(result.trimmedCharacters).toBeGreaterThan(0);
    expect(result.prompt).toContain("最後の出来事😀");
    expect(result.total).toBe(tokenEstimate(result.prompt));
    expect(result.total).toBeLessThanOrEqual(result.budget);
    expect(result.prompt).not.toMatch(
      /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/,
    );
    expect(project.pages[0].text).toBe(original);
  });
  it("reserves independent Game Output/Thinking and does not change Story writing settings", () => {
    const { story, project } = fixture();
    project.settings.reserveTokens = 1;
    project.settings.maxOutputTokens = 1500;
    project.settings.thinkingMaxTokens = 2500;
    const storyBefore = structuredClone(story.settings),
      result = buildGamePrompt(project, story);
    expect(result.reserved).toBeGreaterThanOrEqual(4000);
    expect(result.prompt).toContain("1500 visible tokens");
    expect(story.settings).toEqual(storyBefore);
  });
});

describe("Vgame provider integration (fake requests only)", () => {
  it("audits a colliding proposal ID separately while preserving valid narrative and the original proposal", async () => {
    const { story, project } = fixture();
    const pending = proposeVHTML(project, {
      id: "original",
      reason: "Original approved-state suggestion",
      source: '<add: stat: id: "original-stat" name: "Original Stat">',
    }).project;
    const original = structuredClone(pending.proposals[0]);
    fetchProvider(
      story,
      envelope(" A valid complete sentence.", [
        {
          id: "original",
          reason: "Colliding suggestion",
          vhtml: '<add: stat: id: "evil-replacement" name: "Replacement">',
        },
        {
          id: "later-valid",
          reason: "Another suggestion",
          vhtml: '<add: stat: id: "later-stat" name: "Later Stat">',
        },
      ]),
    );
    const result = await generateGame(
      pending,
      story,
      { [credentialId(story.connection)]: "fake-key" },
      {},
      new AbortController().signal,
    );
    expect(result.project.pages[0].text).toBe(
      pending.pages[0].text + " A valid complete sentence.",
    );
    expect(
      result.project.proposals.find((proposal) => proposal.id === "original"),
    ).toEqual(original);
    const failure = result.project.proposals.find(
      (proposal) => proposal.reason === "Colliding suggestion",
    );
    expect(failure).toMatchObject({
      status: "failed",
      error: expect.stringMatching(/Duplicate proposal/),
    });
    expect(failure?.id).not.toBe("original");
    expect(
      result.project.proposals.find((proposal) => proposal.id === "later-valid")
        ?.status,
    ).toBe("pending");
    expect(result.project.objects).toEqual([]);
    expect(pending.proposals).toEqual([original]);
  });
  it("appends a complete narrative over the source-string limit without parsing its quoted story commands", async () => {
    const { story, project } = fixture();
    const narrative =
      " A long complete paragraph.\n".repeat(900) +
      ' The note said "<page: next>".';
    expect(narrative.length).toBeGreaterThan(20000);
    project.settings.maxOutputTokens = 12000;
    fetchProvider(story, envelope(narrative));
    const result = await generateGame(
      project,
      story,
      { [credentialId(story.connection)]: "fake-key" },
      {},
      new AbortController().signal,
    );
    expect(result.project.pages).toHaveLength(1);
    expect(result.project.pages[0].text).toBe(
      project.pages[0].text + narrative,
    );
    expect(result.project.history.at(-1)?.origin).toBe("ai");
  });
  it("reprobes provider capacity after a failed credential check", async () => {
    const { story } = fixture();
    const info = vi
      .spyOn(providers.openrouter, "info")
      .mockRejectedValueOnce(new Error("Invalid key"))
      .mockResolvedValueOnce({ model: story.connection.model, context: 32768 });
    expect(await gameProviderLimit(story, "invalid-test-key")).toBeUndefined();
    expect(await gameProviderLimit(story, "correct-test-key")).toBe(32768);
    expect(info).toHaveBeenCalledTimes(2);
  });
  it("cancels a hanging capability lookup promptly without generating or committing", async () => {
    const { story, project } = fixture(),
      before = structuredClone(project);
    let started!: () => void;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    vi.spyOn(providers.openrouter, "info").mockImplementation(() => {
      started();
      return new Promise(() => {});
    });
    const generate = vi.spyOn(providers.openrouter, "generate");
    const controller = new AbortController();
    const pending = generateGame(
      project,
      story,
      { [credentialId(story.connection)]: "fake-key" },
      {},
      controller.signal,
    );
    const rejection = expect(pending).rejects.toThrow();
    await ready;
    controller.abort();
    await rejection;
    expect(generate).not.toHaveBeenCalled();
    expect(project).toEqual(before);
  });
  it("uses existing writing credentials and separate Game limits; JSON is never locally prose-truncated", async () => {
    const { story, project } = fixture();
    project.settings.maxOutputTokens = 150;
    project.settings.thinking = true;
    project.settings.thinkingLevel = "medium";
    project.settings.thinkingMaxTokens = 256;
    const narrative = " A complete paragraph.".repeat(35),
      raw = envelope(narrative);
    expect(tokenEstimate(raw)).toBeGreaterThan(150);
    const calls = fetchProvider(
      story,
      "<think>Tagged private reasoning.</think>" + raw,
    );
    const onReasoning = vi.fn(),
      settingsBefore = structuredClone(story.settings);
    const result = await generateGame(
      project,
      story,
      { [credentialId(story.connection)]: "fake-writing-key" },
      {},
      new AbortController().signal,
      { onReasoning },
    );
    const sent = calls.find((call) => call.body)?.body;
    expect(sent.max_tokens).toBe(150 + 256);
    expect(sent.reasoning).toMatchObject({ effort: "medium" });
    expect(sent.stream).toBe(false);
    expect(sent.messages[0].content).toContain("Vgame");
    expect(
      new Headers(calls.find((call) => call.body)?.init?.headers).get(
        "Authorization",
      ),
    ).toBe("Bearer fake-writing-key");
    expect(result.project.pages[0].text).toBe(
      project.pages[0].text + narrative,
    );
    expect(result.project.proposals).toHaveLength(0);
    expect(onReasoning.mock.calls.flat().join("")).toContain(
      "private reasoning",
    );
    expect(result.project.pages[0].text).not.toContain("private reasoning");
    expect(story.settings).toEqual(settingsBefore);
  });
  it("quoted commands in generated narrative stay inert and invalid proposals only enter failed audit", async () => {
    const { story, project } = fixture();
    const narrative = ' The placard said "<page: next>"; she stayed put.';
    fetchProvider(
      story,
      envelope(narrative, [
        {
          id: "bad-source",
          reason: "Forbidden command",
          vhtml: '<script: src: "https://evil.invalid">',
        },
      ]),
    );
    const result = await generateGame(
      project,
      story,
      { [credentialId(story.connection)]: "fake-key" },
      {},
      new AbortController().signal,
    );
    expect(result.project.pages).toHaveLength(1);
    expect(result.project.activePageId).toBe(project.activePageId);
    expect(result.project.pages[0].text).toBe(
      project.pages[0].text + narrative,
    );
    expect(result.project.proposals[0]).toMatchObject({
      id: "bad-source",
      status: "failed",
    });
    expect(result.project.objects).toEqual([]);
  });
  it.each([
    '{"narrative":"unfinished","proposals":[',
    envelope("Not committed."),
  ])(
    "invalid transport/provider-length results leave the project untouched",
    async (raw) => {
      const { story, project } = fixture(),
        before = structuredClone(project);
      fetchProvider(story, raw, 64000, raw.endsWith("[") ? "stop" : "length");
      await expect(
        generateGame(
          project,
          story,
          { [credentialId(story.connection)]: "fake-key" },
          {},
          new AbortController().signal,
        ),
      ).rejects.toThrow();
      expect(project).toEqual(before);
    },
  );
  it("cancels before a provider generation and applies no output", async () => {
    const { story, project } = fixture(),
      before = structuredClone(project);
    const calls = fetchProvider(story, envelope("Never committed."));
    const controller = new AbortController();
    controller.abort();
    await expect(
      generateGame(
        project,
        story,
        { [credentialId(story.connection)]: "fake-key" },
        {},
        controller.signal,
      ),
    ).rejects.toThrow();
    expect(calls.some((call) => call.body)).toBe(false);
    expect(project).toEqual(before);
  });
});
