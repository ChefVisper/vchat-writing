import { newLore, type Lore, type Lorebook } from "../types";
import { newLorebook } from "./library";
export const MAX_LOREBOOK_BYTES = 8 * 1024 * 1024;
const text = (v: unknown, fallback = "", max = 100000): string => {
  if (v == null) return fallback;
  if (typeof v !== "string" || v.length > max)
    throw new Error("Invalid or oversized lorebook text.");
  return v;
};
const number = (v: unknown, fallback: number, max = 262144): number => {
  if (v == null) return fallback;
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > max)
    throw new Error("Invalid lorebook numeric setting.");
  return v;
};
const keywordList = (v: unknown): string[] => {
  if (v == null) return [];
  if (typeof v === "string")
    return v
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean);
  if (!Array.isArray(v) || v.length > 200)
    throw new Error("Invalid lorebook keyword list.");
  return v.map((k) => text(k, "", 2000)).filter((k) => k.trim());
};
const logic = ["and-any", "not-all", "not-any", "and-all"] as const;
export function validLoreEntry(e: any): e is Lore {
  return (
    !!e &&
    ["id", "title", "content", "keywords", "secondary"].every(
      (k) => typeof e[k] === "string",
    ) &&
    ["enabled", "constant", "caseSensitive"].every(
      (k) => typeof e[k] === "boolean",
    ) &&
    ["priority", "scanDepth", "budget", "probability"].every(
      (k) => typeof e[k] === "number" && Number.isFinite(e[k]) && e[k] >= 0,
    ) &&
    e.scanDepth <= 10000 &&
    e.probability <= 100 &&
    e.content.length <= 100000 &&
    ["primaryKeys", "secondaryKeys"].every(
      (k) =>
        e[k] === undefined ||
        (Array.isArray(e[k]) &&
          e[k].length <= 200 &&
          e[k].every(
            (v: unknown) => typeof v === "string" && v.length <= 2000,
          )),
    ) &&
    (e.selectiveLogic === undefined || logic.includes(e.selectiveLogic)) &&
    (e.matchWholeWords === undefined || typeof e.matchWholeWords === "boolean")
  );
}
export function validLorebook(b: any): b is Lorebook {
  return (
    !!b &&
    typeof b.id === "string" &&
    b.id.length <= 250 &&
    typeof b.title === "string" &&
    b.title.length <= 150 &&
    typeof b.modified === "number" &&
    Number.isFinite(b.modified) &&
    Array.isArray(b.entries) &&
    b.entries.length <= 2000 &&
    b.entries.every(validLoreEntry) &&
    new Set(b.entries.map((e: Lore) => e.id)).size === b.entries.length &&
    (b.source === undefined ||
      (typeof b.source === "string" && b.source.length <= 2000)) &&
    (b.warnings === undefined ||
      (Array.isArray(b.warnings) &&
        b.warnings.length <= 2000 &&
        b.warnings.every(
          (w: unknown) => typeof w === "string" && w.length <= 1000,
        )))
  );
}
export function mapLorebook(
  raw: unknown,
  fallback = "Imported lorebook",
  source = "",
): Lorebook {
  if (!raw || typeof raw !== "object")
    throw new Error("No lorebook data found.");
  const p = raw as any;
  const d = p.data?.character_book || p.character_book || p.data || p;
  if (!d.entries || typeof d.entries !== "object")
    throw new Error(
      "No lorebook entries found. Use a Chub, SillyTavern, character-book or vChat JSON export.",
    );
  const list = Array.isArray(d.entries) ? d.entries : Object.values(d.entries);
  if (list.length > 2000)
    throw new Error("A lorebook can contain at most 2,000 entries.");
  const warnings = new Set<string>(
    p.format === "vchat-lorebook" && validLorebook(p) ? p.warnings || [] : [],
  );
  if (d.recursive_scanning || d.recursiveScanning)
    warnings.add(
      "Recursive entry activation is not executed; vChat scans the manuscript only.",
    );
  const entries: Lore[] = list.map((e: any, index: number) => {
    if (!e || typeof e !== "object") throw new Error("Invalid lorebook entry.");
    if (p.format === "vchat-lorebook" || validLoreEntry(e)) {
      if (!validLoreEntry(e)) throw new Error("Invalid vChat lorebook entry.");
      return { ...e, id: newLore().id };
    }
    const ext = e.extensions || {};
    const primary = keywordList(e.keys ?? e.key);
    const secondary =
      e.selective === false
        ? []
        : keywordList(e.secondary_keys ?? e.keysecondary);
    const regex =
      e.use_regex === true ||
      ext.use_regex === true ||
      primary.concat(secondary).some((k) => /^\/.+\/[a-z]*$/i.test(k));
    if (regex)
      warnings.add(
        "Regex entries were imported disabled. Replace their keys with literal keywords before enabling them.",
      );
    if ((e.position ?? ext.position ?? 0) !== 0)
      warnings.add(
        "Imported insertion positions use vChat's World Info block before the continuation; chat-role/depth positions are not reproduced.",
      );
    if (
      e.sticky ||
      e.cooldown ||
      e.delay ||
      e.group ||
      e.delayUntilRecursion ||
      e.matchPersonaDescription ||
      e.matchCharacterDescription ||
      e.matchCharacterPersonality ||
      e.matchCharacterDepthPrompt ||
      e.matchScenario ||
      e.matchCreatorNotes ||
      e.outletName ||
      e.automationId ||
      e.vectorized ||
      ext.sticky ||
      ext.cooldown ||
      ext.delay ||
      ext.group ||
      ext.vectorized ||
      e.characterFilter?.isExclude ||
      e.characterFilter?.names?.length
    )
      warnings.add(
        "Chat-specific recursion, vector, group, timed or automation options are not executed. Review imported entries.",
      );
    if (e.scanDepth != null || ext.scan_depth != null || d.scan_depth != null)
      warnings.add(
        "Scan depth is measured in manuscript paragraphs in vChat, rather than chat messages.",
      );
    const selective = e.selectiveLogic ?? ext.selectiveLogic;
    if (e.priority != null && (e.order != null || e.insertion_order != null))
      warnings.add(
        "Separate insertion order and activation priority are combined into vChat's priority; original chat ordering is not reproduced.",
      );
    if (selective != null && ![0, 1, 2, 3].includes(selective))
      throw new Error("Unsupported selective keyword logic.");
    const result: Lore = {
      ...newLore(),
      title: text(e.name || e.comment, `Entry ${index + 1}`, 150),
      content: text(e.content),
      keywords: primary.join(", "),
      primaryKeys: primary,
      secondary: secondary.join(", "),
      secondaryKeys: secondary,
      selectiveLogic: logic[selective ?? 0],
      enabled: !regex && e.enabled !== false && e.disable !== true,
      constant: e.constant === true,
      priority: number(e.priority ?? e.order ?? e.insertion_order, 50, 100000),
      caseSensitive:
        (e.caseSensitive ?? e.case_sensitive ?? ext.case_sensitive) === true,
      matchWholeWords:
        (e.matchWholeWords ??
          ext.match_whole_words ??
          /https:\/\/chub\.ai\//.test(source)) === true,
      scanDepth: Math.round(
        number(e.scanDepth ?? ext.scan_depth ?? d.scan_depth, 8, 10000),
      ),
      budget: number(e.budget, 0),
      probability:
        e.useProbability === false
          ? 100
          : number(e.probability ?? ext.probability, 100, 100),
    };
    return result;
  });
  return {
    ...newLorebook(
      text(d.name ?? d.title, fallback.replace(/\.json$/i, ""), 150),
      entries,
    ),
    source: text(
      source || (p.format === "vchat-lorebook" ? p.source : ""),
      "",
      2000,
    ),
    warnings: [...warnings],
  };
}
export function parseLorebookJSON(raw: string, name = "Imported lorebook") {
  if (new TextEncoder().encode(raw).length > MAX_LOREBOOK_BYTES)
    throw new Error("Choose lorebook JSON smaller than 8 MB.");
  let p: any;
  try {
    p = JSON.parse(raw.replace(/^\uFEFF/, ""));
  } catch {
    throw new Error("This file is not valid lorebook JSON.");
  }
  if (p?.format === "vchat-lorebook-library") {
    if (!Array.isArray(p.books) || p.books.length > 100)
      throw new Error(
        "Invalid lorebook library (maximum 100 books per import).",
      );
    return p.books.map((b: unknown) => {
      if (!validLorebook(b)) throw new Error("Invalid saved lorebook.");
      return { ...structuredClone(b), id: newLorebook().id };
    });
  }
  return [mapLorebook(p, name)];
}

export function lorebookLink(link: string) {
  let u: URL;
  try {
    u = new URL(link.includes("://") ? link.trim() : `https://${link.trim()}`);
  } catch {
    throw new Error("Enter a Chub lorebook link or a direct JSON URL.");
  }
  if (!["https:", "http:"].includes(u.protocol) || u.username || u.password)
    throw new Error("Use an HTTP(S) link without credentials.");
  if (
    [
      "chub.ai",
      "www.chub.ai",
      "chat.chub.ai",
      "preview.chub.ai",
      "characterhub.org",
      "www.characterhub.org",
    ].includes(u.hostname.toLowerCase())
  ) {
    const parts = u.pathname.split("/").filter(Boolean);
    if (
      u.port ||
      parts.length !== 3 ||
      parts[0] !== "lorebooks" ||
      parts.slice(1).some((x) => !/^[\w-]{1,200}$/.test(x))
    )
      throw new Error(
        "Use chub.ai/lorebooks/author/name, not a character or profile link.",
      );
    return {
      url: `https://chub.ai/${parts.join("/")}`,
      path: parts.join("/"),
      name: parts[2],
    };
  }
  if (!/\.json$/i.test(u.pathname))
    throw new Error("Other sites need a direct .json download link.");
  return {
    url: u.href,
    path: "",
    name: u.pathname.split("/").pop() || "Imported lorebook",
  };
}
async function readJSON(url: string, signal: AbortSignal) {
  const r = await fetch(url, {
    headers: { Accept: "application/json" },
    credentials: "omit",
    signal,
  });
  if (!r.ok)
    throw new Error(
      r.status === 404
        ? "Lorebook not found. Check the full link."
        : r.status === 401 || r.status === 403
          ? "This lorebook is private or access was denied. Use its exported JSON."
          : `Lorebook server returned HTTP ${r.status}.`,
    );
  const reader = r.body?.getReader();
  if (!reader) throw new Error("Empty lorebook response.");
  const decoder = new TextDecoder();
  let raw = "",
    bytes = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_LOREBOOK_BYTES)
        throw new Error("Lorebook response is larger than 8 MB.");
      raw += decoder.decode(value, { stream: true });
    }
    raw += decoder.decode();
  } finally {
    await reader.cancel().catch(() => {});
  }
  try {
    return JSON.parse(raw.replace(/^\uFEFF/, ""));
  } catch {
    throw new Error(
      "The link did not return lorebook JSON. Import the exported file instead.",
    );
  }
}
export async function fetchLorebook(link: string, signal: AbortSignal) {
  const target = lorebookLink(link);
  let data;
  try {
    if (target.path) {
      const metadata = await readJSON(
        `https://api.chub.ai/api/${target.path}`,
        signal,
      );
      const id = metadata.node?.id;
      if (!Number.isInteger(id) || id <= 0)
        throw new Error("This Chub lorebook is unavailable.");
      data = await readJSON(
        `https://api.chub.ai/api/v4/projects/${id}/repository/files/raw%252Fsillytavern_raw.json/raw`,
        signal,
      );
    } else data = await readJSON(target.url, signal);
  } catch (e) {
    if (e instanceof TypeError)
      throw new Error(
        "The site could not be reached or blocked browser access. Import its downloaded JSON instead.",
      );
    throw e;
  }
  return mapLorebook(data, target.name, target.url);
}
