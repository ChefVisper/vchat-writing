import type { Story } from "../types";
import {
  currentState,
  isStateCurrent,
  stateFingerprint,
} from "./internalStates";

export function statePointer(story: Story): string | null {
  const record = currentState(story);
  return record && isStateCurrent(story, record) ? record.id : null;
}

// Explicit checkpoint IDs win. For manual edits/retry undo, find a snapshot
// matching the destination text, without storing another manuscript copy.
export function statesForText(
  story: Story,
  text: string,
  preferred?: string | null,
) {
  if (!story.internalStates) return {};
  const basis = stateFingerprint(text);
  const records = story.internalStates.records;
  const record =
    preferred === null
      ? undefined
      : preferred
        ? records.find((r) => r.id === preferred && r.basis === basis)
        : records.findLast((r) => r.basis === basis);
  return {
    internalStates: { ...story.internalStates, currentId: record?.id ?? null },
  };
}
