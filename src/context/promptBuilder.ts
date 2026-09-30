import { DEFAULT_PROMPT_TEMPLATE, type Story, type Lore } from "../types";
export const estimate = (s: string) =>
  Math.ceil(new TextEncoder().encode(s).length / 3.5);
const keys = (s: string) =>
  s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
export function activateLore(story: Story) {
  let budget = story.loreBudget;
  return [...story.lore]
    .sort((a, b) => b.priority - a.priority)
    .map((entry) => {
      const recent =
        entry.scanDepth > 0
          ? story.text.split("\n\n").slice(-entry.scanDepth).join("\n\n")
          : "";
      const has = (key: string) =>
        entry.caseSensitive
          ? recent.includes(key)
          : recent.toLowerCase().includes(key.toLowerCase());
      let reason = !entry.enabled
        ? "Disabled"
        : entry.constant
          ? "Always active"
          : keys(entry.keywords).some(has)
            ? "Keyword match"
            : "No matching keyword";
      let active =
        entry.enabled && (entry.constant || keys(entry.keywords).some(has));
      if (
        active &&
        !entry.constant &&
        keys(entry.secondary).length &&
        !keys(entry.secondary).some(has)
      ) {
        active = false;
        reason = "Secondary keyword missing";
      } // Stable roll keeps preview identical to generation.
      const hash = [...(story.text + entry.id)].reduce(
        (h, c) => (Math.imul(31, h) + c.charCodeAt(0)) | 0,
        0,
      );
      if (active && Math.abs(hash) % 100 >= entry.probability) {
        active = false;
        reason = "Probability";
      }
      const tokens = estimate(entry.content);
      if (
        active &&
        ((entry.budget > 0 && tokens > entry.budget) || tokens > budget)
      ) {
        active = false;
        reason = "Token budget";
      }
      if (active) budget -= tokens;
      return { entry, active, reason, tokens };
    });
}
export interface Section {
  name: string;
  text: string;
}
const block = (name: string, content: string) =>
  content ? `[${name}]\n${content}\n[/${name}]` : "";
export function buildPrompt(story: Story) {
  const lore = activateLore(story);
  const template = story.promptTemplate ?? DEFAULT_PROMPT_TEMPLATE;
  const invalidTemplate =
    !template.includes("{{context}}") || !template.includes("{{story}}");
  const notes = story.notes.filter(
    (n) =>
      n.enabled &&
      n.include &&
      (!keys(n.keywords).length ||
        keys(n.keywords).some((k) =>
          story.text.slice(-6000).toLowerCase().includes(k.toLowerCase()),
        )),
  );
  const assemble = (text: string): Section[] => {
    const before: Section[] = [];
    const after: Section[] = [];
    if (story.memory.enabled && story.memory.content)
      (story.memory.position === "before" ? before : after).push({
        name: "Memory",
        text: block("MEMORY", story.memory.content),
      });
    before.push({
      name: "World Info",
      text: block(
        "WORLD INFO",
        lore
          .filter((x) => x.active)
          .map((x) => x.entry.content)
          .join("\n\n"),
      ),
    });
    for (const note of notes)
      (note.position === "before" ? before : after).push({
        name: "Notes",
        text: block(
          "CURRENT STATE — factual continuity information",
          `${note.title}\n${note.content}`,
        ),
      });
    const paras = text.split("\n\n");
    const depth =
      story.author.position === "before"
        ? paras.length
        : Math.min(Math.max(1, story.author.depth), paras.length);
    const split = paras.length - depth;
    const middle: Section[] = [
      { name: "Story", text: paras.slice(0, split).join("\n\n") },
    ];
    if (story.author.enabled && story.author.content)
      middle.push({
        name: "Author's Note",
        text: block("AUTHOR NOTE", story.author.content),
      });
    const tail = paras.slice(split).join("\n\n");
    const context = [...before, ...middle, ...after].filter((x) => x.text);
    return template
      .split(/(\{\{context\}\}|\{\{story\}\})/g)
      .flatMap((part): Section[] => {
        if (part === "{{context}}") return context;
        if (part === "{{story}}")
          return [{ name: "Continuation point", text: tail }];
        return part ? [{ name: "Template", text: part }] : [];
      });
  };
  let text = story.text;
  let sections = assemble(text);
  const total = () => estimate(sections.map((x) => x.text).join("\n\n"));
  const budget = Math.max(
    0,
    Math.min(
      story.settings.inputTokens ?? story.settings.context,
      story.settings.context - story.settings.maxTokens,
    ),
  );
  while (total() > budget && text.length) {
    const cut = Math.max(1, Math.ceil((total() - budget) * 3.5));
    text = text.slice(cut);
    sections = assemble(text);
  }
  const prompt = sections.map((x) => x.text).join("\n\n");
  return {
    prompt,
    sections,
    lore,
    total: estimate(prompt),
    budget,
    trimmed: story.text.length - text.length,
    overflow: estimate(prompt) > budget,
    invalidTemplate,
    breakdown: sections.reduce<Record<string, number>>((a, x) => {
      a[x.name] = (a[x.name] || 0) + estimate(x.text);
      return a;
    }, {}),
  };
}
