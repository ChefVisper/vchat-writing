import { describe, expect, it, vi } from "vitest";
vi.mock("../src/storage/stories", () => ({
  storage: { save: vi.fn(async () => {}) },
}));
import { useStore } from "../src/store";
import { newStory, uid } from "../src/types";
import { storage } from "../src/storage/stories";

describe("editor undo groups", () => {
  it("coalesces rapid edits into one saved document", async () => {
    await useStore.getState().flush();
    vi.mocked(storage.save).mockClear();
    const s = newStory();
    useStore.setState({ stories: [s], current: s.id });
    for (let i = 1; i <= 100; i++) useStore.getState().edit("x".repeat(i));
    expect(storage.save).not.toHaveBeenCalled();
    await useStore.getState().flush();
    expect(storage.save).toHaveBeenCalledTimes(1);
    expect(vi.mocked(storage.save).mock.calls[0][0].text).toBe("x".repeat(100));
  });
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
