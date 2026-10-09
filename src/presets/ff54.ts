import type { Story } from "../types";

// Original module concepts from Freaky Frankenstein 5.4. This adaptation uses
// separate, validated state updates instead of the source's HTML/macros.
export const FF54_SOURCE = "https://rentry.org/freaky-frankenstein-presets";
export interface FF54Config {
  enabled: boolean;
  modules: string[];
  autoUpdate: boolean;
  includeContext: boolean;
  creative: boolean;
  maxTokens: number;
  thinking: boolean;
  thinkingLevel: "minimal" | "low" | "medium" | "high";
  thinkingMaxTokens: number;
  contextTokens: number;
  extraInstructions: string;
}

const master = "019f62e8-892f-7027-93ef-159f3d55c410";
const module = (
  id: string,
  label: string,
  description: string,
  rule: string,
  group: string,
  sourceId = master,
) => ({ id, label, description, rule, group, sourceId });

export const ff54Modules = [
  module(
    "agendas",
    "Character agendas",
    "Goals, next steps, knowledge, lies, allies and current condition.",
    "For each relevant named character, record current goal, concrete next step, known secrets, lies told, allies and condition. Keep established progress; change it only when manuscript events or elapsed fictional time support the change. Never advance steps merely because an update was requested. Label invented future plans as Proposed, not completed events.",
    "Characters",
    "019f67b4-7381-7000-bcc4-496b2e6ed920",
  ),
  module(
    "locations",
    "Character locations",
    "Who is where, what they are doing and the scene's time.",
    "Track each relevant named character's last established location and activity, whether on scene, and established story time. Mark unknown location or time as Unknown. Do not teleport characters or imply off-screen travel has already happened without evidence.",
    "Characters",
  ),
  module(
    "relationships",
    "Relationships",
    "Trust, affection and resentment between named character pairs.",
    "Track named character pairs, trust, affection and unresolved resentment with a concise reason grounded in their written interactions. Preserve slow changes and conflicting feelings. Do not tick scores per update, force a relationship milestone or treat a score as permission for intimacy. Distinguish observed behavior from a character's belief.",
    "Characters",
    "019f62e8-892f-7023-825d-9351eca0347f",
  ),
  module(
    "thoughts",
    "Fictional character thoughts",
    "Brief private motives for up to three relevant characters.",
    "For up to three relevant named characters, supply one or two concise lines (10–40 words each) of fictional private thought or immediate motive. These are authored character states, never the AI's reasoning. Label new inferred thoughts Proposed unless already established. Their content is not known to other characters and must not override the narrator's viewpoint.",
    "Characters",
    "019f62e8-892f-7026-92ea-34ff510c244b",
  ),
  module(
    "factions",
    "Factions",
    "Group goals, knowledge, morale and conflicts.",
    "Track established factions, their goals, known intelligence, claims or lies, morale, internal conflicts and relations. Keep faction knowledge separate from an individual character's knowledge. Label compatible new group plans Proposed; do not invent accomplished faction actions.",
    "Plot & setting",
  ),
  module(
    "quests",
    "Objectives & quests",
    "Active goals, dependencies, deadlines and completed objectives.",
    "Track main and side objectives with status, concrete progress, dependencies, established deadlines and promised rewards. Mark completion only when the manuscript establishes it. Preserve unresolved objectives; do not advance them on each update or invent a reward already received.",
    "Plot & setting",
  ),
  module(
    "inventory",
    "Inventory & condition",
    "Possessions, skills, titles and temporary conditions by owner.",
    "Record narrative items with their named owner, relevant skills or earned titles and temporary conditions. Add, consume, transfer or remove items only when the manuscript supports it. Attribute to fictional characters, never the author. Do not award automatic titles or clear an injury without time or action supporting recovery.",
    "Characters",
    "019f62e8-892f-7022-9eb9-e00c2944ebc6",
  ),
  module(
    "seeds",
    "Secrets & narrative seeds",
    "Promises, setups and secrets waiting for a possible payoff.",
    "Keep at most twenty unresolved promises, planted details, secrets or lies. Note their evidence, who knows them, prerequisites and any established time lock. Mark paid off only after a written payoff. No age-per-update ticking, automatic random firing or forced resolution. Label a compatible new future setup Proposed.",
    "Plot & setting",
    "019f62e8-892f-7025-be65-8859e7730ee0",
  ),
  module(
    "notebook",
    "GM notebook",
    "Compact reminders, open threads and continuity checks.",
    "Keep at most twenty concise entries: [R] reminders and knowledge limits, [T] unresolved threads, [D] continuity issues or uncertain facts. Use one or two sentences per entry. Avoid duplicating information already tracked in another enabled module. Retain still-relevant older entries; an omission from the visible excerpt is not evidence of resolution.",
    "Plot & setting",
    "019f67ad-c0b1-7000-aca4-0e2480fa02db",
  ),
  module(
    "rpg",
    "RPG checks",
    "Track fictional skilled actions and their written outcomes.",
    "Track meaningful attempted skilled actions, actor, relevant ability or difficulty, and the outcome actually established by prose. Any proposed numerical DC, modifier or roll is model-authored fiction, not a real random or verified game roll; label it Proposed/model-authored. Never retroactively change a written outcome or decide an unplayed action succeeded. Keep mechanics out of the manuscript.",
    "Game & simulation",
    "019f62e8-892f-7021-97a6-42e1b83eaad3",
  ),
  module(
    "world",
    "Background world",
    "Named characters' off-screen activity and possible world changes.",
    "Track established background activity and plausible next developments involving existing named characters or established setting features. Separate Established events from Proposed future developments. Advance off-screen activity only when manuscript time or events make it plausible, never per button press. Do not force interruptions, teleport characters, claim random events were rolled or interrupt the current scene solely to fill this module.",
    "Game & simulation",
    "019f62e8-892f-7024-a40f-b906fceb58d2",
  ),
  module(
    "physics",
    "Environment & scene geometry",
    "Weather, hazards, setting rules and spatial continuity.",
    "Track established weather, environmental hazards, magic or technology rules, character positioning, relevant distances and lines of sight. Keep compatible with the setting and evidence; mark unknown exact measurements Unknown rather than inventing precision. Preserve spatial constraints until a written action changes them.",
    "Game & simulation",
  ),
];

export function newFF54Config(): FF54Config {
  return {
    enabled: false,
    modules: [
      "agendas",
      "locations",
      "relationships",
      "thoughts",
      "inventory",
      "notebook",
    ],
    autoUpdate: true,
    includeContext: true,
    creative: true,
    maxTokens: 2048,
    thinking: false,
    thinkingLevel: "low",
    thinkingMaxTokens: 512,
    contextTokens: 800,
    extraInstructions: "",
  };
}

export function ff54Config(story: Story): FF54Config {
  const initial = newFF54Config();
  return {
    ...initial,
    ...story.ff54,
    modules: story.ff54?.modules ?? initial.modules,
  };
}

export function isFF54Config(value: unknown): value is FF54Config {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const c = value as FF54Config;
  const integer = (v: unknown, min: number, max: number) =>
    typeof v === "number" && Number.isSafeInteger(v) && v >= min && v <= max;
  return (
    ["enabled", "autoUpdate", "includeContext", "creative", "thinking"].every(
      (key) => typeof c[key as keyof FF54Config] === "boolean",
    ) &&
    Array.isArray(c.modules) &&
    c.modules.length <= ff54Modules.length &&
    new Set(c.modules).size === c.modules.length &&
    c.modules.every((id) => ff54Modules.some((m) => m.id === id)) &&
    integer(c.maxTokens, 64, 131072) &&
    integer(c.thinkingMaxTokens, 0, 131072) &&
    integer(c.contextTokens, 0, 32000) &&
    ["minimal", "low", "medium", "high"].includes(c.thinkingLevel) &&
    typeof c.extraInstructions === "string" &&
    c.extraInstructions.length <= 5000
  );
}
