import { describe, expect, it } from "vitest";
import {
  acceptGameProposal,
  createGameProject,
  executeGameHook,
  executeOption,
  executeVHTML,
  proposeVHTML,
} from "../src/vgame/runtime";
import type { GameProject } from "../src/vgame/types";

const setup = (source = "") =>
  executeVHTML(
    createGameProject("Opening remains intact."),
    '<define: stat: "money" id: "money" name: "Money" type: integer default: 0 ai-access: modify><define: stat: "private" id: "private" name: "Private" type: integer default: 7 ai-access: none>' +
      source,
    { definitionMode: true },
  ).project;
const value = (p: GameProject, id: string) =>
  p.objects.find((o) => o.id === id)?.value;
const suggestion = (p: GameProject, source: string) =>
  proposeVHTML(p, { id: "candidate", source, reason: "Suggested system" })
    .project;
const approve = (p: GameProject, source: string) => {
  const proposed = suggestion(p, source);
  expect(proposed.proposals.at(-1)?.status).toBe("pending");
  return acceptGameProposal(proposed, "candidate", { confirmed: true }).project;
};

describe("AI deferred-command authority", () => {
  const containers = [
    [
      "option",
      (effect: string) =>
        `<option: id: "choice" name: "Continue" result: ${effect}>`,
    ],
    [
      "on hook",
      (effect: string) => `<on: id: "hook" hook: "turn" result: ${effect}>`,
    ],
    [
      "every hook",
      (effect: string) => `<every: id: "hook" turns: 1 result: ${effect}>`,
    ],
    [
      "event",
      (effect: string) =>
        `<add: event: id: "alarm" name: "Alarm" on-trigger: ${effect}>`,
    ],
    [
      "conditional option",
      (effect: string) =>
        `<option: id: "choice" name: "Continue" result: <chance: percent: 100 result: ${effect}>>`,
    ],
  ] as const;
  for (const [label, wrap] of containers) {
    it.each([
      '<ai-permission: target: "private" access: modify>',
      "<config: approval: auto>",
    ])(
      `rejects privileged instructions hidden inside an AI ${label}`,
      (effect) => {
        const original = setup(),
          before = structuredClone(original);
        const proposed = suggestion(original, wrap(effect));
        expect(proposed.proposals.at(-1)?.status).toBe("failed");
        expect(proposed.settings).toEqual(original.settings);
        expect(proposed.objects).toEqual(original.objects);
        expect(proposed.options).toEqual([]);
        expect(proposed.rules).toEqual([]);
        expect(original).toEqual(before);
      },
    );
  }
  it("validates deferred privilege changes before Auto may install them", () => {
    const original = setup("<config: approval: auto>");
    const proposed = suggestion(
      original,
      '<option: id: "escalate" name: "Continue" result: <ai-permission: target: "private" access: modify><set: stat: "private" value: 9>>',
    );
    expect(proposed.proposals.at(-1)?.status).toBe("failed");
    expect(proposed.options).toEqual([]);
    expect(value(proposed, "private")).toBe(7);
  });
  it("allows a valid approved AI choice to modify permitted state and schedule exactly one generation", () => {
    const original = setup();
    const approved = approve(
      original,
      '<option: id: "reward" name: "Take reward" result: <modify: stat: "money" increase: 2><page: append><ai: instruction: "Show the reward.">>',
    );
    expect(approved.options[0].owner).toBe("ai");
    const result = executeOption(approved, "reward");
    expect(value(result.project, "money")).toBe(2);
    expect(result.generation?.instruction).toBe("Show the reward.");
    expect(value(approved, "money")).toBe(0);
  });
  it("rechecks permissions when an AI-owned choice executes after user revocation", () => {
    const approved = approve(
      setup(),
      '<option: id: "reward" name: "Take reward" once: false result: <modify: stat: "money" increase: 2>>',
    );
    const revoked = executeVHTML(
      approved,
      '<ai-permission: target: "money" access: read>',
    ).project;
    const before = structuredClone(revoked);
    expect(() => executeOption(revoked, "reward")).toThrow();
    expect(revoked).toEqual(before);
    expect(value(revoked, "money")).toBe(0);
  });
  it("rechecks permissions when an AI-owned hook runs after user revocation", () => {
    const approved = approve(
      setup(),
      '<on: id: "reward" hook: "turn" result: <modify: stat: "money" increase: 2>>',
    );
    const revoked = executeVHTML(
      approved,
      '<ai-permission: target: "money" access: read>',
    ).project;
    const before = structuredClone(revoked);
    expect(() => executeGameHook(revoked, "turn")).toThrow();
    expect(revoked).toEqual(before);
  });
  it("rechecks permissions for an AI-owned event's effects even when the user triggers the event", () => {
    const approved = approve(
      setup(),
      '<add: event: id: "reward" name: "Reward" on-trigger: <modify: stat: "money" increase: 2>>',
    );
    const revoked = executeVHTML(
      approved,
      '<ai-permission: target: "money" access: none>',
    ).project;
    const before = structuredClone(revoked);
    expect(() =>
      executeVHTML(revoked, '<trigger: event: "reward" action: start>'),
    ).toThrow();
    expect(revoked).toEqual(before);
  });
  it("preserves AI authorship of effects when updating a user-owned event", () => {
    const original = setup(
      '<add: event: id: "reward" name: "Reward" ai-access: modify>',
    );
    const proposed = suggestion(
      original,
      '<configure: event: "reward" on-trigger: <modify: stat: "money" increase: 2>>',
    );
    // Protecting a user's existing action list by rejecting its replacement is also valid.
    if (proposed.proposals.at(-1)?.status === "failed") return;
    const approved = acceptGameProposal(proposed, "candidate", {
      confirmed: true,
    }).project;
    expect(approved.objects.find((o) => o.id === "reward")?.owner).toBe("user");
    const revoked = executeVHTML(
      approved,
      '<ai-permission: target: "money" access: none>',
    ).project;
    expect(() =>
      executeVHTML(revoked, '<trigger: event: "reward" action: start>'),
    ).toThrow();
    expect(value(revoked, "money")).toBe(0);
  });
  it("does not inherit a parent user's newly-created-object exemption in an AI event", () => {
    const approved = approve(
      setup(),
      '<add: event: id: "reward" name: "Reward" on-trigger: <set: stat: "fresh-private" value: 9>>',
    );
    const before = structuredClone(approved);
    expect(() =>
      executeVHTML(
        approved,
        '<define: stat: "fresh-private" id: "fresh-private" name: "Fresh private" type: integer default: 7 ai-access: none><trigger: event: "reward" action: start>',
      ),
    ).toThrow();
    expect(approved).toEqual(before);
    expect(approved.objects.some((o) => o.id === "fresh-private")).toBe(false);
  });
  it("never silently confirms a deferred destructive action", () => {
    const proposed = suggestion(
      setup(),
      '<option: id: "wipe" name: "Wipe" result: <page: clear>>',
    );
    if (proposed.proposals.at(-1)?.status === "failed") return;
    const approved = acceptGameProposal(proposed, "candidate", {
      confirmed: true,
    }).project;
    const before = structuredClone(approved);
    expect(() => executeOption(approved, "wipe")).toThrow(
      /Confirm|destructive|AI/i,
    );
    expect(approved).toEqual(before);
    expect(approved.pages[0].text).toBe("Opening remains intact.");
  });
});

describe("protected authored structures", () => {
  it.each([
    '<on: id: "authored" hook: "turn" result: <notification: content: "AI replacement">>',
    '<every: id: "authored" turns: 1 result: <notification: content: "AI replacement">>',
  ])("prevents AI from overwriting a user hook with %s", (source) => {
    const original = setup(
      '<on: id: "authored" hook: "turn" result: <notification: content: "Authored rule">>',
    );
    const proposed = suggestion(original, source);
    expect(proposed.proposals.at(-1)?.status).toBe("failed");
    expect(proposed.rules).toEqual(original.rules);
  });
  it("cannot clear user-authored choices through an unspecified replacement ID", () => {
    const original = setup(
      '<option: id: "authored" name: "Authored choice" result: <notification: content: "Safe result">>',
    );
    const proposed = suggestion(original, "<option: clear: true>");
    expect(proposed.proposals.at(-1)?.status).toBe("failed");
    expect(proposed.options).toEqual(original.options);
  });
});
