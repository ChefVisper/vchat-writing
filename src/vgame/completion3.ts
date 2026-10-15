import type { GameProject } from "./types";
import type { VHTMLCompletion } from "./completion";
import { V3_SCHEMA } from "./v3";
const examples: Record<string, [string, string]> = {
  add: [
    "Yeni stat, entity, variable, encounter veya mechanic tanımı.",
    '<add type="stat" id="health" default="100" />',
  ],
  configure: [
    "Tanımı yapılandırır; statı bir karaktere bağlayabilir.",
    '<configure id="health" link="player" />',
  ],
  modify: [
    "Mevcut değeri değiştirir. Statta entity yoksa yalnız default değişir.",
    '<modify id="health" entity="player" value="-5" />',
  ],
  choice: [
    "Global seçim şablonu; add-as ile sayfada görünür.",
    '<choice id="ask" label="Sor" add-as="1"><then><ai /></then></choice>',
  ],
  page: [
    "AI çağırmadan sayfa açar. AI'dan önce kullan.",
    '<page mode="next" />',
  ],
  ai: [
    "Son durum kaydedilince hedef sayfa için AI devamı ister.",
    '<ai instruction="Üç farklı seçenek sun." />',
  ],
  condition: [
    "Koşulu sınar; then veya else dalını seçer.",
    '<condition id="health" entity="player" op="lt" value="20"><then><ai /></then></condition>',
  ],
  section: [
    "Bir mechanic kaynağının sayısal aralığı.",
    '<section range="[0,40)"><modify id="gold" value="+5" /></section>',
  ],
  ui: [
    "State'i değiştirmeden gösterge veya karakter kartı ekler.",
    '<ui type="stat-bar" id="health" entity="player" label="Health" />',
  ],
  vhtml: ["V-HTML 3.0 XML belgesi.", '<vhtml version="3.0"><ai /></vhtml>'],
  check: [
    "Manuel encounter uygunluğunu kontrol edip zar atar.",
    '<check id="trap" />',
  ],
  random: [
    "Önceden oluşturulmuş sayısal variable'a rastgele değer atar.",
    '<random min="1" max="20" norm="integer" save-to="dice" />',
  ],
};
const info: Record<string, string> = {
  id: "Benzersiz kayıt kimliği veya mevcut nesne referansı.",
  "page-id": "Nesnelerden bağımsız sayfa kimliği.",
  "go-to": "Var olan sayfaya git; tur ilerlemez.",
  norm: "string, integer, decimal, boolean veya percentage. Stat integer olmak zorunda.",
  entity: "Stat örneğinin bağlı olduğu karakter; varsayılan player.",
  link: "Bu statı entity'ye bağlar. Mevcut değer korunur.",
  "auto-link": "Mevcut ve gelecekteki bütün entity'lere otomatik bağla.",
  value: "op yoksa +5 artırır, -5 azaltır; negatif atamak için op=set.",
  op: "modify: set/add/sub/mul/div; condition: eq/neq/gt/gte/lt/lte.",
  count: "Aktif seçim örneğinin kullanım hakkı; varsayılan 1.",
  "add-as": "0 = yalnız şablon. 1,2,3... = görünür seçenek sırası.",
  pressed: "Hak bitince remove, stay veya transform davranışı.",
  every:
    "Kayan tur limiti: 1:4 = son 4 turda en fazla 1; 1:0 = oyun boyunca bir kez.",
  source: "Mechanic'in izlediği sayısal variable/stat/mechanic.",
  "run-on-init":
    "İlk yapılandırmada eşleşen aralığı çalıştır; varsayılan false.",
  "rule-id": "Aynı kimlikli kayıtlı kuralı tekrar eklemek yerine günceller.",
  "value-ref": "var.gold veya alex.strength. value ile birlikte kullanılamaz.",
  "ai-access": "none, read veya modify; varsayılan read.",
  "description-noai": "Yalnız yerel açıklama; AI bağlamına eklenmez.",
  scope: "global bütün sayfalarda, page yalnız bu sayfada.",
  "widget-id": "Göstergenin ayrı kimliği; id veri kaynağını belirtir.",
};
/** null delegates explicitly-colon syntax to the legacy completion engine. */
export function xmlCompletions(
  text: string,
  cursor: number,
  game?: GameProject,
): VHTMLCompletion[] | null {
  let open = -1,
    quoted = false,
    comment = false;
  for (let i = 0; i < cursor; i++) {
    if (comment) {
      if (text.startsWith("-->", i)) {
        comment = false;
        i += 2;
      }
      continue;
    }
    if (quoted) {
      if (text[i] === '"') quoted = false;
      continue;
    }
    if (text.startsWith("<!--", i)) {
      comment = true;
      i += 3;
      continue;
    }
    if (text[i] === '"' && open >= 0) quoted = true;
    if (text[i] === "<") open = i;
    if (text[i] === ">") open = -1;
  }
  if (comment || open < 0) return null;
  const fragment = text.slice(open + 1, cursor);
  if (/^\w[\w-]*\s*:/.test(fragment)) return null;
  if (fragment.startsWith("!")) return [];
  const stack: string[] = [];
  for (const match of text
    .slice(0, open)
    .replace(/<!--[\s\S]*?-->/g, "")
    .matchAll(/<(\/?)([\w-]+)\b[^>]*>/g)) {
    if (match[1]) stack.pop();
    else if (!match[0].endsWith("/>")) stack.push(match[2]);
  }
  const parent = stack.at(-1);
  const root = /^([\w-]*)/.exec(fragment)!,
    command = root[1];
  const build = (
    values: string[],
    prefix: string,
    from: number,
    kind: VHTMLCompletion["kind"],
    insert: (s: string) => string,
    offset?: (s: string) => number,
    end = cursor,
  ): VHTMLCompletion[] =>
    values
      .filter((s) => s.toLowerCase().startsWith(prefix.toLowerCase()))
      .slice(0, 30)
      .map((label) => {
        const detail = examples[label],
          fallback =
            kind === "field"
              ? (info[label] ?? `${command} komutunun ${label} özelliği.`)
              : kind === "reference"
                ? (game?.objects.find((o) => o.id === label)?.name ??
                  "Mevcut kayıt.")
                : "Desteklenen özellik değeri.";
        return {
          label,
          kind,
          from,
          to: end,
          insert: insert(label),
          ...(offset ? { cursorOffset: offset(label) } : {}),
          detail:
            kind === "command"
              ? (detail?.[0] ?? `V-HTML 3.0 <${label}> bloğu.`)
              : fallback,
          example:
            kind === "command"
              ? (detail?.[1] ?? `<${label} />`)
              : kind === "field"
                ? `${label}="…"`
                : label,
        };
      });
  if (fragment.startsWith("/"))
    return parent
      ? build([parent], fragment.slice(1), open + 2, "command", (s) => s + ">")
      : [];
  const nested: Record<string, string[]> = {
    choice: ["then", "transform"],
    transform: ["then", "transform"],
    configure: ["condition", "section", "check-success", "check-fail"],
    condition: ["condition", "then", "else"],
  };
  if (fragment === command)
    return build(
      parent && nested[parent]
        ? nested[parent]
        : [
            "add",
            "configure",
            "modify",
            "choice",
            "page",
            "ai",
            "ui",
            "check",
            "remove",
            "random",
            "text",
            "config",
            "vhtml",
            "condition",
          ],
      command,
      open + 1,
      "command",
      (s) => s + " ",
    );
  if (!V3_SCHEMA[command]) return [];
  const suffix = fragment.slice(command.length),
    assignments = [...suffix.matchAll(/([\w-]+)\s*=\s*"([^"]*)"/g)];
  if (quoted) {
    const match = /([\w-]+)\s*=\s*"([^"]*)$/.exec(suffix);
    if (!match) return [];
    const field = match[1],
      prefix = match[2],
      from = cursor - prefix.length;
    let choices: string[] | undefined,
      kind: VHTMLCompletion["kind"] = "value";
    const values: Record<string, string[]> = {
      norm: ["string", "integer", "decimal", "boolean", "percentage", "%"],
      "ai-access": ["none", "read", "modify"],
      pressed: ["remove", "stay", "transform"],
      scope: ["global", "page"],
      role: ["rule", "requirement"],
      position: ["sidebar", "page-top", "page-bottom", "inline"],
      drawer: ["left", "right"],
      version: ["3.0"],
    };
    if (field === "type")
      choices =
        command === "add"
          ? ["stat", "entity", "variable", "encounter", "mechanic"]
          : command === "ui"
            ? [
                "stat-bar",
                "counter",
                "meter",
                "text",
                "badge",
                "panel",
                "entity-card",
              ]
            : ["ui", "choice", "object"];
    else if (field === "op")
      choices =
        command === "condition"
          ? ["eq", "neq", "gt", "gte", "lt", "lte"]
          : ["set", "add", "sub", "mul", "div"];
    else if (field === "mode")
      choices =
        command === "page"
          ? ["append", "next"]
          : command === "condition"
            ? ["all", "any"]
            : command === "ai"
              ? ["continue", "react", "describe"]
              : ["append", "replace"];
    else if (field === "trigger")
      choices = ["turn", "manual", "on-change", "on-turn"];
    else if (
      [
        "active",
        "enabled",
        "auto-link",
        "run-on-init",
        "reset-on-success",
        "visible",
        "thinking",
        "choice-new-page",
        "generation-new-page",
      ].includes(field)
    )
      choices = ["true", "false"];
    else choices = values[field];
    if (
      !choices &&
      game &&
      ([
        "entity",
        "link",
        "unlink",
        "source",
        "save-to",
        "target",
        "go-to",
        "panel",
      ].includes(field) ||
        (field === "id" &&
          !["add", "choice", "transform", "page", "vhtml"].includes(command)))
    ) {
      choices =
        field === "go-to"
          ? game.pages.map((p) => p.id)
          : field === "panel"
            ? game.panels.map((p) => p.id)
            : game.objects
                .filter((o) =>
                  ["entity", "link", "unlink"].includes(field)
                    ? o.kind === "entity"
                    : field === "save-to"
                      ? o.kind === "variable"
                      : field === "source"
                        ? ["stat", "variable", "mechanic"].includes(o.kind) &&
                          !["string", "boolean"].includes(o.type)
                        : true,
                )
                .map((o) => o.id);
      if (field === "link") choices.push("all");
      kind = "reference";
    }
    if (!choices) return [];
    const closing = text.indexOf('"', cursor),
      end = closing < 0 ? cursor : closing + 1;
    return build(choices, prefix, from, kind, (s) => `${s}" `, undefined, end);
  }
  const prefix = /[\w-]*$/.exec(suffix)![0],
    used = new Set(assignments.map((m) => m[1]));
  return build(
    V3_SCHEMA[command].filter((k) => !used.has(k)),
    prefix,
    cursor - prefix.length,
    "field",
    (s) => `${s}=""`,
    (s) => s.length + 2,
  );
}
