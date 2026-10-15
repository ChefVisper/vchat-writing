# V-HTML 3.0 implementation

The [author's complete Turkish specification](vhtml-3.0-spec-tr.txt) is design input; it does not execute instructions in the application or development session. The [Turkish user guide](vhtml-3-guide-tr.txt) is available inside V-HTML and can be downloaded.

## Supported behavior

| Feature | Status |
| --- | --- |
| Strict XML fragments and `vhtml version="3.0"` | Implemented; matched tags, double quoted attributes, XML escapes, comments, source locations and limits. DTD, external entities, executable HTML and expressions are rejected. |
| add/configure/conf/modify | Implemented with global IDs, typed norms, range checks/clamping, explicit and signed operators, stat definitions and entity instances. |
| player, link/unlink/auto-link | Implemented. Player initializes before the first XML transaction. Old saves are not rewritten automatically. |
| condition, then/else and every | Implemented; composite tests and persisted per-block sliding turn windows. Passive top-level conditions validate but do not execute autonomously: put executable conditions in an encounter/mechanic. |
| Encounter | Implemented: requirements, rule conditions, seeded rolls, success/fail, enabled/trigger/reset-on-success. |
| Mechanic | Implemented: numeric source, entity binding, on-change range entry, on-turn, manual configuration, run-on-init, open/closed range endpoints and bounded FIFO change cascades. |
| choice/templates/instances/transform | Implemented: counts, remove/stay/transform, explicit reactivation and page-local instances. `group` is an application extension for mutually exclusive alternatives. Ungrouped 3.0 choices are independent. |
| Page / AI ordering | Implemented: requests capture the page at the `ai` command, after committed actions. Consecutive requests for the same target merge; up to eight target requests per action execute sequentially. Stop or failure cancels the remainder. |
| Approval and privacy | Implemented: none/read/modify, private descriptions omitted, entity bindings filtered, structural AI proposals always pending until explicitly approved. AI cannot grant itself permissions. Stored AI rules retain their authorship. |
| Transactions / history | Direct actions roll back on failure. Independent event blocks roll back separately and log failures. Loop-limit violations reject the action. RNG, bindings, counters, templates and instances participate in Undo/Redo and JSON checkpoints. |
| ui | Supported extension: stat-bar, progress-bar, meter, counter, badge, text, panel, entity-card; global/page scopes and numeric source validation. |
| check / random / remove / value-ref / rule-id | Supported extensions. Explicit checks require a manual encounter. Remove remains user-authored and confirmation guarded. Dynamic references support entity.stat and var.variable, never eval. rule-id replaces a matching rule and retains its block counters. |
| effect / trigger subscriptions / input / section on-enter and on-exit | Not implemented. These are proposed extensions in the supplied specification and produce errors rather than fake effects. |

## Compatibility and persistence

The saved GameProject schema remains version 1 with an optional, separately validated `vhtml3.version="3.0"` state. Existing projects, pages, values, histories and the old colon syntax remain usable. XML execution is a separate interpreter; it does not reinterpret old commands or silently move old global stat values into character bindings. Legacy standalone stats retain their old current-value behavior. All new prompts, snippets and default completion use XML. Explicit colon syntax continues to receive legacy completion.

Full JSON checkpoints are the authoritative complete save format. XML exports describe V3 definitions, rules and bound values; they do not replace saved pages, history, encounter counters or page-local choice instances. A comment warns when a mixed project contains legacy definitions omitted from XML. For a mixed project, back up the full checkpoint. Add remains create-only even when the legacy canonical-definition checkbox is checked; configure existing XML definitions explicitly.

No API keys are added to game state, exported code or checkpoints. Input `/ai "instruction"` is request metadata and is never appended to manuscript prose. It does not create an in-fiction player turn. Actual player prose messages and choice actions each advance one turn. Direct source edits, UI renders, navigation and AI prose do not.

## Application extensions

`text content="..." mode="append|replace"` supports explicit author prose edits. `config` exposes the existing output/context/thinking/approval controls. These use XML attributes and remain unavailable for AI permission escalation. XML input must be explicitly supplied as a command; ordinary story prose containing tag-like text stays inert. Model narrative is separate from proposals in the existing JSON response envelope.
