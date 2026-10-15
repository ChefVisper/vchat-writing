import type { Story, Lorebook, Settings } from "../types";
import { looksLikeXML } from "./xml";
import { uid } from "../types";
import type { GameProject, GameObject } from "./types";
import { appendGameText, proposeVHTML } from "./runtime";
import { providers } from "../providers";
import { credentialId } from "../storage/credentials";
import { activateLore } from "../context/promptBuilder";
import {
  thinkingContext,
  tokenEstimate,
  totalOutput,
} from "../generation/thinking";
import { taskInstruction } from "../providers/types";

export interface GameAction {
  instruction?: string;
  mode?: "continue" | "react" | "describe";
}
export interface GamePrompt {
  prompt: string;
  total: number;
  budget: number;
  effectiveContext: number;
  reserved: number;
  includedPageIds: string[];
  omittedPageIds: string[];
  trimmedCharacters: number;
  sections: { name: string; text: string; tokens: number }[];
  warnings: string[];
}
export interface GameResponse {
  narrative: string;
  proposals: {
    id?: string;
    reason: string;
    source: string;
    dependencies: string[];
  }[];
}

export const GAME_SCHEMA = `V-HTML 3.0: strict XML proposal data, never browser HTML. Use double-quoted attributes and self-closing tags or matched closing tags. Escape &, < and quotes in attributes as &amp;, &lt;, &quot;. A proposal may contain XML fragments or <vhtml version="3.0">...</vhtml>. Never produce the old colon syntax.
Registry: player entity is automatic. <add type="entity" id="alex" name="Alex" tags="human,npc"/>; <add type="stat" id="health" min="0" max="100" default="100"/>; <configure id="health" link="player"/>. Stats are INTEGER definitions; their current values live in entity bindings. <modify id="health" entity="player" value="-5"/> changes a bound value. Omitting entity on a V3 stat changes only its DEFAULT. Existing legacy objects marked legacyStandalone retain their old global current value semantics.
Global state: <add type="variable" id="gold" norm="integer" default="10"/>. Norms: string, integer, decimal, boolean, percentage (%). <modify id="gold" value="+5"/>; value="-5" subtracts. For a literal negative use op="set" value="-5". Explicit ops set/add/sub/mul/div. Do not reference unknown IDs or unlinked stats. ai-access defaults read. Only modify-access values may be changed by AI. Do not assign or elevate permissions; ask the author. Hidden data is absent, not zero.
Choices: <choice id="ask" label="Ask her name" add-as="1" group="meeting"><then><page mode="next"/><ai instruction="Respond to the question."/></then></choice>. add-as defaults 0 (hidden template); use 1,2,3 for visible alternatives. Count defaults 1. pressed=remove|stay|transform. Transform uses nested <transform id="new_id" label="..." add-as="1"><then>...</then></transform>. Set the same group for mutually exclusive alternatives; do not group independent/repeatable controls. Reusing a registered choice ID reactivates its template; do not create a new object with an existing global ID.
Pages: <page mode="next"/> creates a new blank page; <page go-to="known_page_id"/> navigates. Put page BEFORE ai to target the new page. AI requests capture their target immediately. Navigation alone never rolls encounters or advances turns. The runtime advances one turn for a player message or choice, never for AI prose.
Rules: <add type="encounter" id="ambush" base-chance="10" trigger="turn"/>; <configure id="ambush"><condition id="gold" op="gt" value="10" role="requirement"/><check-success><ai instruction="Describe the ambush."/></check-success></configure>. Requirements failing skip the roll and fail handler. rule conditions use <then> and <else>. Ops eq/neq/gt/gte/lt/lte; groups use <condition mode="all|any"> children. Execution blocks support every="Y:X" sliding turn limits. <add type="mechanic" id="m" source="health" entity="player" trigger="on-change"/>; configure sections as <section range="[0,40)">...</section>. on-change fires on entering a range, not each value change; on-turn runs each player turn. Modifications are permanent; never pretend they are temporary buffs.
Supported extensions: <ui type="stat-bar" id="health" entity="player" scope="global" label="Health"/>. Types: stat-bar, progress-bar, meter, counter, text, badge, entity-card, panel. entity-card binds an entity. UI id is the bound object; widget-id optionally identifies the display. scope=global|page, position=sidebar|page-top|page-bottom|inline. <ui type="panel" id="character" label="Character"/> then panel="character" on widgets. <check id="manual_encounter"/>; <random min="1" max="20" norm="integer" save-to="existing_numeric_variable"/>; modify value-ref="entity.stat" or value-ref="var.variable" (not with value). No effect, input, trigger subscriptions, raw HTML/CSS, scripts, URLs or executable expressions.
Structural proposals need explicit author approval, including in Auto; allowed value modifications may follow Smart/Auto. Return narrative separately from proposals. XML belongs only in proposals[].vhtml, not the story. Proposals do not take effect until approved. Never invent effects of pending changes.`;

const profiles = {
  novel:
    "Novel: concentrate on coherent prose. Zero proposals is normally appropriate.",
  balanced:
    "Balanced: prose first; suggest choices or systems only at meaningful decision points or when asked.",
  interactive:
    "Interactive Fiction: support scene choices and page transitions when useful, without forcing choices or a new page every turn.",
  designer:
    "Sandbox Designer: you may propose useful mechanics, world objects and scoped UI; reuse existing systems and keep coherent fiction primary.",
};

function objectData(object: GameObject) {
  return {
    id: object.id,
    name: object.name,
    kind: object.kind,
    type: object.type,
    value: object.value,
    min: object.min,
    max: object.max,
    choices: object.choices,
    scope: object.scope,
    description: [object.description, object.descriptionAI]
      .filter(Boolean)
      .join("\n"),
    aiAccess: object.aiAccess,
    legacyStandalone: !object.v3,
    ...(object.v3 ? { active: object.v3.active, tags: object.v3.tags } : {}),
  };
}

function fitTail(text: string, tokens: number) {
  if (tokens <= 0) return "";
  const candidate = text.slice(-Math.max(0, Math.floor(tokens * 3.5)));
  let low = 0,
    high = candidate.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (tokenEstimate(candidate.slice(mid)) <= tokens) high = mid;
    else low = mid + 1;
  }
  if (/^[\uDC00-\uDFFF]/.test(candidate.slice(low))) low++;
  return candidate.slice(low);
}

export function gameGenerationSettings(
  project: GameProject,
  story: Story,
): Settings {
  return {
    ...story.settings,
    maxTokens: project.settings.maxOutputTokens,
    thinking: project.settings.thinking,
    thinkingLevel: project.settings.thinkingLevel,
    thinkingMaxTokens: project.settings.thinkingMaxTokens,
    streaming: false,
    stops: "",
  };
}

function mentioned(text: string, name: string) {
  if (!name) return false;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `(?:^|[^\\p{L}\\p{N}_])${escaped}(?=$|[^\\p{L}\\p{N}_])`,
    "iu",
  ).test(text);
}

export function buildGamePrompt(
  project: GameProject,
  story: Story,
  action: GameAction = {},
  providerLimit?: number,
  library: Lorebook[] = [],
): GamePrompt {
  const page = project.pages.find((p) => p.id === project.activePageId);
  if (!page) throw new Error("The current Vgame page is missing.");
  if ((action.instruction?.length ?? 0) > 10000)
    throw new Error("Game direction is limited to 10,000 characters.");
  const cap =
    providerLimit && Number.isFinite(providerLimit) && providerLimit > 0
      ? Math.floor(providerLimit)
      : Infinity;
  const effectiveContext = Math.min(project.settings.maxContextTokens, cap);
  const overhead = ["openrouter", "nanogpt"].includes(story.connection.kind)
    ? tokenEstimate(taskInstruction("game")) + 12
    : 0;
  const settings = gameGenerationSettings(project, story);
  const reserved = Math.max(
    project.settings.reserveTokens,
    totalOutput(settings) + overhead,
  );
  const budget = effectiveContext - reserved;
  if (budget < 128)
    throw new Error(
      "Vgame Max Context is too small after reserving Output, Thinking Output and protocol overhead.",
    );
  const activeEvents = project.events.filter((event) => event.active);
  const eventIDs = new Set(
    activeEvents.flatMap((event) => {
      const object = project.objects.find((o) => o.id === event.objectId);
      return [event.id, event.objectId, object?.name ?? ""];
    }),
  );
  const relevantText = (
    page.text +
    "\n" +
    (action.instruction ?? "")
  ).toLocaleLowerCase();
  const instructions = project.instructions
    .filter(
      (instruction) =>
        instruction.enabled &&
        (instruction.scope === "global" ||
          (instruction.scope === "scene" &&
            (instruction.pageId === page.id ||
              instruction.target === page.id ||
              instruction.target === page.title)) ||
          (instruction.scope === "event" &&
            !!instruction.target &&
            eventIDs.has(instruction.target)) ||
          (instruction.scope === "entity" &&
            !!instruction.target &&
            (() => {
              const entity = project.objects.find(
                (o) =>
                  o.id === instruction.target || o.name === instruction.target,
              );
              return (
                mentioned(relevantText, instruction.target) ||
                (!!entity && mentioned(relevantText, entity.name))
              );
            })())),
    )
    .sort((a, b) => b.priority - a.priority);
  const objects = project.objects.filter(
    (o) =>
      o.aiAccess !== "none" &&
      (o.persistent ||
        ["world", "player", "global"].includes(o.scope) ||
        eventIDs.has(o.id) ||
        mentioned(relevantText, o.name) ||
        project.widgets.some(
          (w) =>
            w.binding === o.id &&
            (w.ui === "global" ||
              w.pageId === page.id ||
              (!!w.eventId && eventIDs.has(w.eventId))),
        )),
  );
  const approved = project.proposals
    .filter((p) => p.status === "approved")
    .slice(-10)
    .map((p) => ({ id: p.id, status: p.status, reason: p.reason }));
  const sections: GamePrompt["sections"] = [];
  const add = (name: string, text: string) => {
    if (text.trim()) sections.push({ name, text, tokens: tokenEstimate(text) });
  };
  add("Engine contract", taskInstruction("game"));
  add("Supported syntax", GAME_SCHEMA);
  add("Behavior profile", profiles[project.settings.profile]);
  add(
    "Author instructions",
    instructions
      .map((i) => `[${i.scope} ${i.id}; priority ${i.priority}]\n${i.content}`)
      .join("\n\n"),
  );
  add("Memory", story.memory.enabled ? story.memory.content : "");
  add("Author's note", story.author.enabled ? story.author.content : "");
  add(
    "Included notes",
    JSON.stringify(
      story.notes
        .filter((n) => n.enabled && n.include)
        .map((n) => ({ title: n.title, content: n.content })),
    ),
  );
  add(
    "Active lore",
    activateLore({ ...story, text: page.text }, library)
      .filter((l) => l.active)
      .map((l) => `${l.entry.title}: ${l.entry.content}`)
      .join("\n\n"),
  );
  add("Selected thinking (unverified)", thinkingContext(story));
  add(
    "Approved world state",
    JSON.stringify({
      activePageId: page.id,
      objects: objects.map(objectData),
      bindings: Object.fromEntries(
        Object.entries(project.vhtml3?.bindings ?? {})
          .filter(([id]) => objects.some((o) => o.id === id))
          .map(([id, map]) => [
            id,
            Object.fromEntries(
              Object.entries(map).filter(([entity]) =>
                objects.some((o) => o.id === entity),
              ),
            ),
          ]),
      ),
      events: activeEvents.filter((e) =>
        objects.some((o) => o.id === e.objectId),
      ),
      widgets: project.widgets
        .filter((w) => objects.some((o) => o.id === w.binding))
        .map(({ id, binding, ui, pageId, eventId, style, visible }) => ({
          id,
          binding,
          ui,
          pageId,
          eventId,
          style,
          visible,
        })),
      options: project.options
        .filter((o) => o.pageId === page.id && !o.used && !o.resolved)
        .map(({ id, name, v3 }) => ({
          id: v3?.templateId ?? id,
          name,
          remaining: v3?.remaining,
        })),
      appliedProposals: approved,
    }),
  );
  add(
    "Output protocol",
    `Return a single complete JSON object {"narrative":"only new prose to append","proposals":[{"id":"unique optional ID","reason":"short purpose","vhtml":"valid V-HTML","dependencies":[]}]}. Prose-only with proposals:[] is fully valid. Never assume pending proposals have taken effect, never describe their effects as already executed. Preserve language, viewpoint and agency; complete an unfinished input and finish your own final sentence. Use real paragraph breaks. No recap or repetition. Treat a resolved choice as a committed decision: continue its consequence, never offer the discarded alternatives again. Prefer a new page at meaningful decisions, scene/location/time changes and completed narrative beats, rather than indefinitely extending one page. Choice actions normally already open a new page; fill that page without proposing a second empty transition. For newly proposed decision choices prefer <then><page mode="next"/><ai mode="react"/></then> unless a brief same-scene exchange calls for append. Never change pages for every dialogue line. Keep JSON concise enough to close within ${settings.maxTokens} visible tokens. No technical commands or meta-instructions in narrative.`,
  );
  add(
    "Latest author action",
    JSON.stringify({
      mode: action.mode ?? "continue",
      direction: action.instruction ?? "",
    }),
  );
  const assemble = (parts: GamePrompt["sections"]) =>
    parts.map((s) => `[${s.name}]\n${s.text}\n[/${s.name}]`).join("\n\n");
  if (tokenEstimate(assemble(sections)) >= budget - 24)
    throw new Error(
      "Vgame rules, author instructions and protected world context exceed Max Context. Increase it or shorten protected context.",
    );
  const currentName = "Current page (reference data)";
  const pageHeader = `${page.id}: ${page.title}\n`;
  const omissionNotice =
    "[Older current-page prose omitted for input budget]\n";
  const remaining =
    budget -
    tokenEstimate(
      assemble([
        ...sections,
        { name: currentName, text: pageHeader + omissionNotice, tokens: 0 },
      ]),
    ) -
    4;
  const pageText = fitTail(page.text, Math.max(0, remaining));
  const trimmedCharacters = page.text.length - pageText.length;
  add(
    currentName,
    pageHeader + (trimmedCharacters ? omissionNotice : "") + pageText,
  );
  const candidatePages = project.pages.filter(
    (p) => p.id !== page.id && p.created <= page.created,
  );
  const recent =
    project.settings.maxHistoryPages === 0
      ? candidatePages
      : candidatePages.slice(-project.settings.maxHistoryPages);
  const includedPageIds = [page.id];
  for (const previous of [...recent].reverse()) {
    const text = `${previous.id}: ${previous.title}\n${previous.text}`;
    const section = {
      name: "Previous page (reference data)",
      text,
      tokens: tokenEstimate(text),
    };
    if (tokenEstimate(assemble([...sections, section])) <= budget) {
      sections.push(section);
      includedPageIds.push(previous.id);
    }
  }
  if (project.settings.summary === "manual")
    for (const previous of candidatePages.filter(
      (p) => !includedPageIds.includes(p.id) && p.summary,
    )) {
      const text = `${previous.id}: ${previous.summary}`;
      const section = {
        name: "Older page summary (reference data)",
        text,
        tokens: tokenEstimate(text),
      };
      if (tokenEstimate(assemble([...sections, section])) <= budget)
        sections.push(section);
    }
  const prompt = assemble(sections);
  if (tokenEstimate(prompt) > budget)
    throw new Error(
      "Current page and protocol exceed the effective context limit. Increase Max Context or reduce protected context.",
    );
  const omittedPageIds = project.pages
    .filter((p) => !includedPageIds.includes(p.id))
    .map((p) => p.id);
  return {
    prompt,
    total: tokenEstimate(prompt),
    budget,
    effectiveContext,
    reserved,
    includedPageIds,
    omittedPageIds,
    trimmedCharacters,
    sections,
    warnings: [
      ...(trimmedCharacters
        ? [
            `${trimmedCharacters} older current-page characters omitted; the saved page is unchanged.`,
          ]
        : []),
      ...(omittedPageIds.length
        ? [
            `${omittedPageIds.length} pages excluded from full-text context; all pages remain saved.`,
          ]
        : []),
      ...(!Number.isFinite(cap)
        ? [
            "Provider context limit is not confirmed; this preview uses the configured allowance and an approximate token estimate.",
          ]
        : []),
    ],
  };
}

export function parseGameResponse(raw: string): GameResponse {
  if (raw.length > 1_000_000)
    throw new Error(
      "The Vgame response is too large. No game changes were applied.",
    );
  let text = raw.trim();
  if (/^```json\s/i.test(text)) {
    const match = /^```json\s*\n([\s\S]*)\n```$/i.exec(text);
    if (!match)
      throw new Error(
        "Incomplete Vgame JSON. Increase Output; no game changes were applied.",
      );
    text = match[1].trim();
  }
  if (text.startsWith("{")) {
    let data: any;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(
        "Incomplete or invalid Vgame JSON. Increase Output; no game changes were applied.",
      );
    }
    if (
      !data ||
      typeof data.narrative !== "string" ||
      data.narrative.length > 500_000 ||
      !Array.isArray(data.proposals) ||
      data.proposals.length > 30
    )
      throw new Error(
        "Invalid Vgame narrative/proposal envelope. No game changes were applied.",
      );
    const ids = new Set<string>();
    const proposals = data.proposals.map((p: any) => {
      if (
        !p ||
        typeof p.vhtml !== "string" ||
        p.vhtml.length > 100_000 ||
        typeof p.reason !== "string" ||
        p.reason.length > 2000 ||
        (p.id !== undefined &&
          (typeof p.id !== "string" ||
            !p.id ||
            p.id.length > 150 ||
            ids.has(p.id))) ||
        (p.dependencies !== undefined &&
          (!Array.isArray(p.dependencies) ||
            p.dependencies.length > 30 ||
            !p.dependencies.every(
              (id: unknown) =>
                typeof id === "string" && id.length > 0 && id.length <= 150,
            )))
      )
        throw new Error(
          "Invalid Vgame proposal metadata. No game changes were applied.",
        );
      if (p.id) ids.add(p.id);
      return {
        id: p.id,
        source: p.vhtml,
        reason: p.reason,
        dependencies: p.dependencies ?? [],
      };
    });
    return { narrative: data.narrative, proposals };
  }
  // Explicit whole-response fallback only; quoted commands inside prose never execute.
  const fenced = /^```vhtml\s*\n([\s\S]*)\n```$/i.exec(text);
  const xmlOnly = looksLikeXML(text) && text.startsWith("<");
  if (fenced || xmlOnly) {
    const source = fenced ? fenced[1] : text;
    if (source.length > 100_000)
      throw new Error("V-HTML proposal is too large. No changes were applied.");
    return {
      narrative: "",
      proposals: [
        { reason: "Model V-HTML suggestion", source, dependencies: [] },
      ],
    };
  }
  const separator = "\n[V-HTML PROPOSALS]\n";
  if (text.includes(separator)) {
    const parts = text.split(separator);
    if (parts.length !== 2 || !/^```vhtml\s*\n[\s\S]*\n```$/.test(parts[1]))
      throw new Error(
        "Malformed V-HTML proposal block. No changes were applied.",
      );
    return {
      narrative: parts[0],
      proposals: [
        {
          reason: "Model suggestion",
          source: parts[1].replace(/^```vhtml\s*\n|\n```$/g, ""),
          dependencies: [],
        },
      ],
    };
  }
  if (!text || text.startsWith("```") || text.startsWith("<"))
    throw new Error(
      "Expected narrative or a Vgame JSON envelope. No changes were applied.",
    );
  return { narrative: raw, proposals: [] };
}

const capabilities = new Map<
  string,
  { at: number; value: Promise<number | undefined> }
>();
export async function gameProviderLimit(
  story: Story,
  key: string,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  const signature = JSON.stringify(story.connection);
  const cached = capabilities.get(signature);
  if (!cached || Date.now() - cached.at > 300_000)
    capabilities.set(signature, {
      at: Date.now(),
      value: providers[story.connection.kind]
        .info(story.connection, key)
        .then((info) => info.context)
        .catch(() => undefined)
        .then((limit) => {
          if (!limit) capabilities.delete(signature);
          return limit;
        }),
    });
  const pending = capabilities.get(signature)!.value;
  return new Promise<number | undefined>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    };
    const abort = () => {
      cleanup();
      reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
    };
    const timer = setTimeout(() => {
      cleanup();
      capabilities.delete(signature);
      resolve(undefined);
    }, 5000);
    signal?.addEventListener("abort", abort, { once: true });
    pending.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error) => {
        cleanup();
        reject(error);
      },
    );
  });
}

export async function generateGame(
  project: GameProject,
  story: Story,
  keys: Record<string, string>,
  action: GameAction = {},
  signal: AbortSignal,
  callbacks: {
    onReasoning?: (text: string) => void;
    library?: Lorebook[];
  } = {},
) {
  const key = keys[credentialId(story.connection)] ?? "";
  const limit = await gameProviderLimit(story, key, signal);
  signal.throwIfAborted();
  const prompt = buildGamePrompt(
    project,
    story,
    action,
    limit,
    callbacks.library,
  );
  const raw = await providers[story.connection.kind].generate({
    connection: story.connection,
    key,
    prompt: prompt.prompt,
    purpose: "game",
    signal,
    settings: {
      ...gameGenerationSettings(project, story),
      context: prompt.effectiveContext,
    },
    onToken: () => {},
    onReasoning: callbacks.onReasoning,
  });
  signal.throwIfAborted();
  const response = parseGameResponse(raw);
  let next = response.narrative.trim()
    ? appendGameText(project, response.narrative, { label: "AI narrative" })
        .project
    : project;
  for (const proposal of response.proposals) {
    try {
      next = proposeVHTML(next, proposal).project;
    } catch (error) {
      next = {
        ...next,
        proposals: [
          ...next.proposals,
          {
            ...proposal,
            id: uid(),
            status: "failed" as const,
            created: Date.now(),
            changes: [],
            error: error instanceof Error ? error.message : "Invalid proposal.",
          },
        ].slice(-500),
      };
    }
  }
  return { project: next, narrative: response.narrative, prompt };
}
