import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("../src/storage/stories", () => ({
  storage: { save: vi.fn(async () => {}) },
}));
import { useStore } from "../src/store";
import { newStory, type Story } from "../src/types";
import { newFF54Config } from "../src/presets/ff54";
import {
  appendStateRecord,
  internalStateContext,
  makeStateRecord,
} from "../src/generation/internalStates";
import { statePointer, statesForText } from "../src/generation/stateHistory";
import { greetingStory, newGreeting } from "../src/generation/greetings";
import { creationStory } from "../src/generation/creation";
import { exportProject, importProject } from "../src/storage/transfer";
import { separate } from "../src/providers/separate";
import { providers } from "../src/providers";

function checkpoint(story: Story, text: string, content: string) {
  story.text = text;
  const record = makeStateRecord(
    story,
    [{ module: "locations", content }],
    story.connection,
  );
  story.internalStates = appendStateRecord(story, record);
  return record.id;
}
function fixture() {
  const story = newStory();
  story.ff54 = { ...newFF54Config(), enabled: true, modules: ["locations"] };
  const before = "Mira waited at home.";
  const after = before + " She walked to the station.";
  const first = checkpoint(story, before, "Mira: home.");
  const second = checkpoint(story, after, "Mira: station.");
  story.past = [before];
  story.segments = [
    {
      id: "passage",
      at: 1,
      before,
      after,
      statesBefore: first,
      statesAfter: second,
    },
  ];
  useStore.setState({ stories: [story], current: story.id });
  return { story, first, second, before, after };
}
afterEach(async () => {
  await useStore.getState().flush();
  vi.unstubAllGlobals();
});

describe("state checkpoints across document history", () => {
  it("restores the passage's exact record instead of another snapshot of identical prose", () => {
    const { story, first, second, before, after } = fixture();
    const other = checkpoint(
      story,
      before,
      "Mira: different manual interpretation.",
    );
    story.text = after;
    story.internalStates!.currentId = second;
    useStore.setState({ stories: [story] });
    useStore.getState().undo();
    expect(statePointer(useStore.getState().stories[0])).toBe(first);
    expect(statePointer(useStore.getState().stories[0])).not.toBe(other);
    expect(internalStateContext(useStore.getState().stories[0])).toContain(
      "Mira: home.",
    );
    useStore.getState().redo();
    expect(useStore.getState().stories[0].text).toBe(after);
    expect(statePointer(useStore.getState().stories[0])).toBe(second);
  });
  it("preserves an explicit empty checkpoint rather than borrowing a future branch record", () => {
    const { story, first, before, after } = fixture();
    story.segments[0].statesAfter = null;
    useStore.setState({ stories: [story] });
    useStore.getState().undo();
    expect(statePointer(useStore.getState().stories[0])).toBe(first);
    useStore.getState().redo();
    expect(useStore.getState().stories[0].text).toBe(after);
    expect(statePointer(useStore.getState().stories[0])).toBeNull();
    expect(internalStateContext(useStore.getState().stories[0])).toBe("");
    expect(statesForText(story, before, first).internalStates?.currentId).toBe(
      first,
    );
    expect(
      statesForText(story, after, first).internalStates?.currentId,
    ).toBeNull();
  });
  it("undoes a retry back to the replaced passage's state and keeps manual changes stale", () => {
    const { story, first, second, before, after } = fixture();
    const replacement = before + " She remained indoors.";
    const third = checkpoint(story, replacement, "Mira: indoors.");
    story.past = [before, after];
    story.segments = [
      {
        id: "retry",
        at: 2,
        before,
        after: replacement,
        statesBefore: first,
        statesAfter: third,
      },
    ];
    useStore.setState({ stories: [story] });
    useStore.getState().undo();
    expect(useStore.getState().stories[0].text).toBe(after);
    expect(statePointer(useStore.getState().stories[0])).toBe(second);
    useStore.getState().redo();
    expect(statePointer(useStore.getState().stories[0])).toBe(third);
    useStore.getState().replace(replacement + " Her phone rang.");
    expect(internalStateContext(useStore.getState().stories[0])).toBe("");
    useStore.getState().undo();
    expect(statePointer(useStore.getState().stories[0])).toBe(third);
  });
});

describe("portable state history", () => {
  it("round-trips options, checkpoint IDs and state reasoning without copying manuscript into records", () => {
    const { story, first, before } = fixture();
    story.snapshots = [
      {
        id: "snapshot",
        at: 1,
        title: "Before",
        text: before,
        notes: [],
        stateId: first,
      },
    ];
    story.thoughts = [
      {
        id: "thought",
        at: 1,
        model: "test",
        provider: "openrouter",
        purpose: "states",
        text: "Exposed provider reasoning",
        selected: false,
      },
    ];
    const raw = exportProject(story);
    const restored = importProject(raw);
    expect(restored).toEqual(story);
    expect(raw).not.toContain("fake-key");
    expect(JSON.stringify(restored.internalStates)).not.toContain(before);
    expect(
      statesForText(restored, before, restored.snapshots[0].stateId)
        .internalStates?.currentId,
    ).toBe(first);
  });
  it("rejects invalid state data and checkpoint shapes while older projects still import", () => {
    const { story } = fixture();
    for (const mutate of [
      (s: any) => {
        s.ff54.modules = ["unknown"];
      },
      (s: any) => {
        s.internalStates.currentId = "missing";
      },
      (s: any) => {
        s.internalStates.records[0].blocks[0].content = "<script>bad</script>";
      },
      (s: any) => {
        s.internalStates.records[0].at = 8640000000000001;
      },
      (s: any) => {
        s.segments[0].statesBefore = {};
      },
      (s: any) => {
        s.snapshots = [
          {
            id: "bad",
            title: "Bad",
            at: 1,
            text: "x",
            notes: [],
            stateId: 123,
          },
        ];
      },
    ]) {
      const copy = structuredClone(story);
      mutate(copy);
      expect(() =>
        importProject(
          JSON.stringify({ format: "margin-project", version: 1, story: copy }),
        ),
      ).toThrow();
    }
    delete story.ff54;
    delete story.internalStates;
    delete story.segments[0].statesBefore;
    delete story.segments[0].statesAfter;
    expect(importProject(exportProject(story))).toEqual(story);
  });
  it("copies FF settings but starts fresh states for greetings and created stories", () => {
    const { story } = fixture();
    const greeting = greetingStory(story, newGreeting("Another opening."));
    const created = creationStory(
      {
        title: "New",
        memory: "Mira lives nearby.",
        startingText: "Mira arrived.",
      },
      story,
      "",
      story.connection,
    );
    for (const copy of [greeting, created]) {
      expect(copy.ff54).toEqual(story.ff54);
      expect(copy.ff54).not.toBe(story.ff54);
      expect(copy.internalStates).toBeUndefined();
      expect(copy.segments).toEqual([]);
    }
  });
});

describe("state response transport", () => {
  it("keeps complete JSON past a prose estimate while filtering exposed thinking", async () => {
    const { story } = fixture();
    const raw = JSON.stringify({
      states: [{ module: "locations", content: "Mira: station. ".repeat(80) }],
    });
    const output: string[] = [],
      thoughts: string[] = [];
    const transport = separate({
      generate: async (r) => {
        r.onToken("<think>Private provider response.</think>" + raw);
        return raw;
      },
      listModels: async () => [],
      info: async () => ({ model: "test" }),
    });
    expect(
      await transport.generate({
        prompt: "State task",
        connection: story.connection,
        key: "",
        settings: { ...story.settings, maxTokens: 64, thinkingMaxTokens: 100 },
        purpose: "states",
        signal: new AbortController().signal,
        onToken: (s) => output.push(s),
        onReasoning: (s) => thoughts.push(s),
      }),
    ).toBe(raw);
    expect(output.join("")).toBe(raw);
    expect(thoughts.join("")).toBe("Private provider response.");
  });
  it.each(["openrouter", "nanogpt"] as const)(
    "reports truncated %s state output before JSON validation",
    async (kind) => {
      const { story } = fixture();
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          Response.json({
            choices: [
              {
                message: { content: '{"states":[' },
                finish_reason: "length",
              },
            ],
          }),
        ),
      );
      await expect(
        providers[kind].generate({
          prompt: "State task",
          connection: { kind, url: "https://example.com/v1", model: "test" },
          key: "fake-key",
          settings: { ...story.settings, streaming: false },
          purpose: "states",
          signal: new AbortController().signal,
          onToken: () => {},
        }),
      ).rejects.toThrow("Internal States output was cut off");
    },
  );
});
