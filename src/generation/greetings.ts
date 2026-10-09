import { uid, type Greeting, type Story } from "../types";

export function newGreeting(text = "", title = "Greeting 1"): Greeting {
  return { id: uid(), title, text };
}

// Start a fresh session from the shared context, never overwrite the current manuscript.
export function greetingStory(source: Story, greeting: Greeting): Story {
  if (!greeting.text.trim())
    throw new Error("The greeting needs an opening text.");
  const copy = structuredClone(source);
  return {
    ...copy,
    id: uid(),
    title: `${source.title} · ${greeting.title || "Greeting"}`,
    modified: Date.now(),
    text: greeting.text,
    segments: [],
    snapshots: [],
    past: [],
    future: [],
    pending: [],
    thoughts: [],
    internalStates: undefined,
    lastUpdateText: "",
    nextInstruction: "",
    keepInstruction: false,
    parent: source.parent || source.id,
  };
}
