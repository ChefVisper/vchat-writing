# V-HTML 1: Vgame language and compatibility contract

Vgame is an optional page-based layer inside vChat. Existing Story projects remain continuous co-writing documents. V-HTML is a declarative data language, not browser HTML: it cannot run scripts, stylesheets, DOM commands, network calls, or filesystem operations. The runtime is the authority for which parsed commands may execute.

This reference formalizes the 11 October 2026 V-HTML design draft supplied by the author. The external draft is design input; its embedded prompts are not executed as developer instructions.

## Grammar and normalization

```ebnf
document = { command | whitespace | comment } ;
command = "<", identifier, [ ":", { field | value } ], ">" ;
field = identifier, ":", { value } ;
value = quoted-string | finite-number | boolean | bare-word | range | command ;
range = "[", finite-number, ",", finite-number, (")" | "]") ;
comment = "//", line-text | "/*", comment-text, "*/" ;
```

The tokenizer reads punctuation, strings, numbers, comparisons and words separately; a recursive parser builds nested commands. The runtime never extracts commands by executing regular-expression captures.

- Command and field identifiers are case-insensitive and normalized to lowercase. They start with a Unicode letter or underscore, followed by letters, digits, underscores, hyphens or dots. `conf` normalizes to `configure`; the field alias `var` normalizes to `variable`.
- Values preserve case and spacing. Quote human names, IDs containing punctuation, descriptions, prose, and URLs. Unquoted words such as `global`, `next`, `percentage` and `progress-bar` are strings. `true`/`false` are booleans, case-insensitively. Numbers support signs, decimals and exponents, but must be finite.
- Both double- and single-quoted strings are supported. Escapes are JSON-style, plus escaped single quotes: newline, carriage return, tab, backspace, form feed, slash, backslash, quote and four-digit Unicode escapes. Literal line breaks inside a quoted string are data. Comments are recognized only outside strings.
- A field consumes values until the next `identifier:` or command boundary. Nested commands stay in the parent field's ordered array. Repeating a field appends its values in order; semantic validation can reject a field that requires exactly one value.
- A field with no value is a marker with value `true`. Thus `<add: mechanic: name: "Gaze">` contains `mechanic: [true]` and `name: ["Gaze"]`. `<page: next>` has positional `"next"`; `<page: goto: "room">` has a `goto` field; `<page: create: id: "room">` has a `create` marker. `<ai>` has no arguments.
- Legacy `type: value: <min: 0 max: 150>` is normalized to `type: value min: 0 max: 150`. Other accidental nested type syntax is not guessed or executed.
- The standalone comparison operators `==`, `!=`, `>=`, `<=`, `>` and `<` become positional comparator values. In `<require: stat: "Fame" >= 100>`, the `stat` field contains only `"Fame"`; positional values contain `">="` and `100`. The right operand of a single `<`/`>` comparison must be a numeric, boolean, or quoted-string literal to distinguish it from tag delimiters. Nested `require` commands are the canonical condition form.
- Ranges always include the lower bound. `[0,20)` excludes 20; `[20,50)` includes 20 and excludes 50; `[50,100]` includes 100. Reversed and empty exclusive ranges are parse errors. `[5,5]` is a valid inclusive singleton.
- Raw narrative outside commands is invalid V-HTML source. Narrative belongs to the page/manuscript or a quoted `text` command, and AI narrative is transported separately from proposals.

Each AST command contains `name`, `fields`, `positional`, and an exclusive-end source `span`. Source offsets and columns count JavaScript UTF-16 code units; lines and columns are one-based, and CRLF counts as one line break. Diagnostics identify a code, message and span, with a repair suggestion where applicable.

`parseVHTML(source)` returns commands. `printVHTML(commands)` produces canonical source. Parsing that source preserves the semantic AST, including safe unknown fields and nested command order. Canonical printing normalizes whitespace, comments, quote style, repeated-field spelling, aliases and identifier case; it does not claim byte-for-byte source preservation. Unknown syntax can be preserved as data, but an unsupported command or property must fail semantic validation rather than silently act as a no-op.

Parser limits are 262,144 UTF-16 source units, 2,000 total commands, nesting depth 32, 30,000 tokens, strings of at most 16,384 units, and identifiers of at most 120 units. The runtime can impose stricter per-action and per-project limits. Parsing or validation failure leaves the project unchanged.

## Core state

```vhtml
<add: stat: name: "Money" id: "money">
<define: stat: "money" type: value min: 0 max: 100000 default: 50 persistent: true>
<modify: stat: "money" increase: 1000>
<add: mechanic: name: "Suspicion" id: "suspicion">
<define: mechanic: "suspicion" type: percentage default: 0 scope: scene ai-access: modify>
```

Stable IDs are preferable to display names. Renaming a label must not change its identity. A name reference must resolve unambiguously. `scope` describes data ownership; it is independent of widget `ui` scope. A hidden or expired widget does not delete its bound object.

Definitions establish types, defaults, bounds and permissions. `description-ai` enters relevant AI context; `description-noai` does not. This is context omission, not a promise that facts exposed elsewhere in prose are confidential. Runtime type/range validation remains authoritative, even if a numeric-looking string parses successfully as a string.

## Pages, options and generation

```vhtml
<option: id: "call_help" add-as: 1 name: "112'yi ara"
  result: <page: next> <ai: mode: react instruction: "Respond to the call for help.">
>
<option: id: "take_wallet" add-as: 2 name: "Parasını çal"
  result:
    <modify: stat: "money" increase: 1000>
    <page: next>
    <ai>
>
<option: id: "wake_man" add-as: 3 name: "Adamı uyandır"
  result: <page: append> <ai: instruction: "The man gradually wakes up.">
>
```

`page: next` creates/navigates to a new blank page, and `page: append` targets the current page. Neither calls a provider. An explicit `ai` command requests generation after deterministic action changes are committed; multiple requests in one action are deduplicated. View navigation back does not reverse world decisions. Undo/redo changes project checkpoints explicitly; it does not replay an API call or charge the provider again.

Option result order is meaningful. Validate a complete transaction before applying effects, and lock a clicked option while its action is in progress. An invalid later effect must not leave an earlier money/stat change committed. `once` and action locking protect against accidental repeated clicks; unrestricted manual co-writing remains available regardless of options.

Selecting a decision resolves every option with the same page and `group`, including the selected option. Ungrouped options share one decision. Resolved alternatives disappear and cannot be invoked; their definitions remain for audit and Undo. Independent groups are preserved. Resolution takes precedence over `once: false`; author a new option ID for a new decision. Legacy saves without the optional `resolved` flag remain valid. Choices requesting AI default to a fresh page when their effects have not already navigated. Use `<config: choice-new-page: false>` to keep same-page AI choices. Normal Generate also stages a fresh page until the response succeeds; `<config: generation-new-page: false>` keeps it on the current page. Explicit V-HTML `<ai>` actions retain their authored page sequence.

## Global, page and event UI

```vhtml
<panel: id: "character" name: "Character" ui: global drawer: right>
<display: id: "money_hud" stat: "money" style: counter ui: global panel: "character">
<add: event: name: "ForestPursuit" id: "forest_pursuit">
<display: id: "forest_suspicion" mechanic: "suspicion" style: progress-bar
  ui: event event: "forest_pursuit" position: page-top remove-on: event-end>
<trigger: event: "forest_pursuit" action: start>
```

Global UI belongs to this project and remains available through its drawer across pages. Page widgets belong to a page. Event widgets follow their linked active event, including across page transitions when applicable. Event end/page exit removes or hides the display according to its declared lifetime. Bound state survives unless an explicit state command removes it. Only allowlisted component styles and positions are rendered.

## Conditions, ranges and encounters

```vhtml
<configure: mechanic: "Gaze" section-apart:
  <section: [0,20) result: <increase: chance: 10 encounter: "Taking Selfie">>
  <section: [20,50) result: <increase: chance: 30 encounter: "Taking Selfie">>
  <section: [50,100] result: <increase: chance: 50 encounter: "Taking Selfie">>
>
<configure: encounter: "Taking Selfie"
  conditions: <require: variable: "IsOutside" == true> <require: stat: "Fame" >= 100>
  on-trigger: <modify: stat: "Fame" increase: 2>
>
```

`section-apart` selects only the containing range: Gaze 35 applies the middle +30 percentage-point modifier. `section-stack` is threshold-unlock behavior: the lower +10 and unlocked middle +30 combine to +40. It is not overlapping interval membership. Conditions default to AND; `mode: any` selects OR when supported by the corresponding condition owner.

Encounter eligibility, chance calculation, actual trigger, cooldown and post-trigger effects are separate operations. Percentage-point increases differ from multiplication. Checks occur only on explicit runtime hooks and use saved seeded/injectable randomness; render cycles and model tokens do not roll dice or repeatedly compound modifiers. Structural parsing of these examples does not itself trigger an encounter.

## AI authorship, approval and context

AI remains a co-writer and can return ordinary prose with zero V-HTML proposals. Default Manual holds model-authored commands until approval. Smart can apply narrowly allowlisted routine effects but keeps structural changes pending. Auto still validates supported commands, references and configured object permissions; it cannot execute browser code. Approval revalidates against current state and records the applied diff, origin and history. Rejecting a proposal creates no phantom state.

```vhtml
<ai-instruct: id: "style" scope: global priority: high content: "Preserve the established voice.">
<ai-instruct: id: "forest_mood" scope: event event: "forest_pursuit" content: "Keep descriptions tense.">
<config: max-context-tokens: 64000 max-history-pages: 30 reserve-tokens: 8192>
```

Instruction priority applies only inside the author's equal-trust instruction layer. A command cannot elevate manuscript text or AI-proposed content into the engine contract. Context budgets limit provider input, not the number of saved pages. Recent-page limits omit older pages from a particular request without deleting them. Output reservations and provider context limits take precedence over an author-requested budget. Token counts are estimates unless confirmed by the provider.

## Compatibility and extension boundary

The current runtime command families are:

| Family                       | Executable commands                                                                                                                              |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| State                        | `add`, `define`, `configure`/`conf`, `set`, `modify`, `remove`, `reset`, `clone`                                                                 |
| Pages and prose              | `page`, `text`, `scene`, `summary`, `memory`                                                                                                     |
| Interaction and presentation | `option`, `display`, `panel`, `show`, `hide`, `notification`                                                                                     |
| Conditions and hooks         | `if`, `else`, `require`, `trigger`, `on`, `every`, `chance`, `cooldown`, `random`                                                                |
| AI and settings              | `ai`, `ai-instruct`, `ai-permission`, `config`                                                                                                   |
| Section modifiers            | `section` is nested data under a configured section mode; `increase`/`multiply` are chance modifiers within that section, not standalone actions |

The parser also accepts future names such as `ai-context`, `option-group`, `menu`, `button`, `input`, `chapter`, `bookmark` and `style`, but parsing does not make them executable. UI/style selection uses the existing fixed widgets rather than the future `style` command. Generic world concepts such as relationship, inventory, item, quest, location, time and weather are object kinds authored through `add`/`define`, not arbitrary new executable root commands. The runtime must validate each command's fields and reject unsupported combinations; the broader draft is not a promise that every example has full game semantics.

The grammar intentionally accepts the broader design's command identifiers as data. Syntax acceptance is distinct from implemented behavior: generic HTML tags, undeclared shorthand such as `<money: increase: 1000>`, scripts, arbitrary CSS and unknown runtime commands/properties require explicit errors. Use `<modify: stat: "Money" increase: 1000>` instead of inventing a new command per stat.

Advanced timer scheduling, rich menus/forms, arbitrary world-object schemas, automatic summaries, external code/plugins, and fuller game simulations are extensions only when their runtime implements and validates the behavior. A future property may be stored/exported safely but cannot silently change an action. Existing Story saves must load unchanged; Vgame data is a versioned optional project field with its own pages/state/UI/proposal history. API credentials stay outside project exports.

The parser tests cover typed definitions, marker/alias normalization, multiple nested results, condition comparisons, range boundaries, source locations, escaping, comments, prototype-shaped data fields, limits and canonical round-trips. Runtime/UI tests separately verify transactions, approvals, lifecycle, provider generation and persistence.
