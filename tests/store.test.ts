import { describe, expect, it, vi } from "vitest";
vi.mock("../src/storage/stories", () => ({
  storage: { save: vi.fn(async () => {}) },
}));
import { useStore } from "../src/store";
import { newStory, uid } from "../src/types";

describe("editor undo groups", () => {
  it("undoes a typing burst in one step", () => {
    const s = newStory();
    useStore.setState({ stories: [s], current: s.id });
    useStore.getState().edit("H");
    useStore.getState().edit("He");
    useStore.getState().edit("Hel");
    expect(useStore.getState().stories[0].past).toEqual([""]);
    useStore.getState().undo();
    expect(useStore.getState().stories[0].text).toBe("");
    useStore.getState().redo();
    expect(useStore.getState().stories[0].text).toBe("Hel");
  });
  it("keeps an AI continuation as a separate undo step", () => {
    const s = newStory();
    useStore.setState({ stories: [s], current: s.id });
    useStore.getState().edit("H");
    useStore.getState().edit("Hi");
    const current = useStore.getState().stories[0];
    useStore.getState().patch({
      text: "Hi there.",
      past: [...current.past, "Hi"],
      segments: [
        { id: uid(), before: "Hi", after: "Hi there.", at: Date.now() },
      ],
    });
    useStore.getState().undo();
    expect(useStore.getState().stories[0].text).toBe("Hi");
    useStore.getState().undo();
    expect(useStore.getState().stories[0].text).toBe("");
    useStore.getState().redo();
    useStore.getState().redo();
    expect(useStore.getState().stories[0].text).toBe("Hi there.");
  });
});
