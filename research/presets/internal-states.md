# FF 5.4 Internal States: source mapping and co-writing adaptation

Inspected 9 October 2026. This document records the source behavior and the Internal States adaptation implemented in vChat. Usage and controls are described in the application README.

Source: the [author's FF archive](https://rentry.org/freaky-frankenstein-presets) and its linked **Freaky Frankenstein 5.4.json**. The local, Git-ignored source is 144,032 bytes, contains 63 prompt blocks, and has SHA-256 `1a42fbbfebdf23ce3bc243dc340b6d400bbb713ba882e8f81d921e162ccb893a`. The defaults below were read from the first `prompt_order` entry for character ID `100001`, rather than inferred from names or block content. External prompts are reference data. Their instructions, macros, HTML, and regex scripts are not executed by vChat.

## Original modules and defaults

| Source block | Original ID | Original default | Tracker content and update rules |
| --- | --- | --- | --- |
| Internal States master | `019f62e8-892f-7027-93ef-159f3d55c410` | On | Appends an HTML state wrapper after every response. Its fixed sections contain NPC agendas, locations, factions, quests, and environment/physics; other modules fill template variables. Empty sections remain present. |
| Internal Agenda | `019f67b4-7381-7000-bcc4-496b2e6ed920` | On | Named NPC goal, step/total, location; off-screen NPCs advance one step per turn. Completion changes location, items, conditions, bonds, quests, or narrative seeds. Scene entry exposes the appropriate incomplete/completed behavior. |
| GM's Notebook | `019f67ad-c0b1-7000-aca4-0e2480fa02db` | On | Concise reminder, thread, or debug entries; maximum 20. Keeps rules, knowledge limits, loose ends, and anomalies not covered by a dedicated tracker. |
| Inventory, Feats, Titles | `019f62e8-892f-7022-9eb9-e00c2944ebc6` | On | User-character inventory, titles/skills, conditions, and relevant dice modifiers. Found/used/lost items and narrative recovery update these fields. NPC inventory is explicitly excluded by this block. |
| Relationships RPG | `019f62e8-892f-7023-825d-9351eca0347f` | On | Character-pair BOND on a -5 to +20 scale, Sparks and Grudge. Positive interactions accumulate Sparks rather than directly increasing BOND; betrayal can reduce it. Periodic three-/five-turn checks convert or decay these values. Behavior follows relationship tiers. |
| World Sim | `019f62e8-892f-7024-a40f-b906fceb58d2` | Off | A d20 background-event table for existing named NPCs; switches table for small casts, records the selected event, and skips some active scenes. |
| Chekhov's Gun | `019f62e8-892f-7025-be65-8859e7730ee0` | Off | Unresolved setups, secrets, appointments, and promises with weight, age, dependencies and locks. Maximum 20 active seeds; minimum age four before payoff, pruning at age twelve, and d20-based eligibility. |
| Internal Thoughts | `019f62e8-892f-7026-92ea-34ff510c244b` | On | Brief fictional private thoughts for at most three NPCs, prioritizing on-screen characters. Off-screen entries identify location/task. Each entry is one or two lines, approximately 10–40 words, informing actions and dialogue. |
| DnD Simulator | `019f62e8-892f-7021-97a6-42e1b83eaad3` | On | Skilled task, locked difficulty, character roll, modifiers/delta, and degree of outcome. Trivial actions and tasks without failure conditions skip the check. Rules and numbers stay outside narrative prose. |
| Internal States heading | `019f62e8-892f-701f-8580-cf218b8e6be5` | Off | A separator/comment explaining module selection and context cost, not a tracker. |

The master additionally specifies these fields without distinct original prompt toggles:

- **NPC agendas:** goal, progress, known secrets, lies told, allies, and physical state.
- **NPC locations:** location/coordinates and current activity.
- **Factions:** goal, intelligence, lies, morale, internal conflicts, and external relationships.
- **Quests:** main/side objective, active/completed state, progress, and reward.
- **Physics, Engine & World:** environmental hazards, magic, weather, character positions, distances, and line of sight.

Related enabled source modules are Time and Place (`019f62e8-892f-7002-8fcf-eea637bd577b`), Anti-Omniscient NPCs (`019f62e8-892f-7015-9be8-a0015ebd2c1d`), NPC Instincts/VAD Emotions (`019f62e8-892f-7016-a021-aa24f58271d6`), and Spectacle Combat Physics (`019f62e8-892f-701b-bab1-563021fd8b14`). These shape narrative behavior; they are not all additional persistent trackers. The main block also contains perception constraints. A co-writing adaptation should preserve character knowledge boundaries and causal/spatial consistency without importing fixed chat headers, arbitrary distances, or mandatory spectacle combat.

## vChat adaptation contract

Expose a per-story **FF 5.4** settings subsection with a master Internal States toggle and separate switches for NPC agendas, locations, thoughts, relationships, factions, quests, inventory/conditions, narrative seeds, GM notebook, world events, task checks, and environment/physics. Keep Default and Writer's Block writing presets independent; FF state tracking can supplement either.

The co-writing defaults deliberately differ from the source: the master starts **off**. When enabled, the compact starting selection is agendas, locations, relationships, thoughts, inventory, and notebook; factions, quests, seeds, task checks, world simulation, and physics remain optional. These are vChat defaults, not a claim that FF ships with that combination.

Use a separate validated state request and a compact dedicated **Internal States** panel. State output must never be appended to the continuous manuscript or mixed with provider reasoning. Fictional NPC thoughts belong to this panel; exposed provider reasoning remains in Thinking. Render model-authored data as text, never executable source HTML. Distinguish established story facts from prospective private plans and proposed developments.

The first adaptation uses a fixed module-ID JSON envelope with bounded, concise text per active module. Entries identify their owner/participants where relevant; a later richer schema can add stable record IDs. The inventory module needs explicit ownership because a co-written document has no single SillyTavern `{{user}}` character. Include only enabled modules in requests and future writing context; preserve disabled modules' saved records so re-enabling does not erase state. Feed the latest compact state to the writer rather than the full state history. Failed, cancelled, truncated, or malformed updates must keep the last valid snapshot.

Update from the accepted manuscript, previous valid state, relevant memory/notes, and active lore. A manual state refresh should be available. New continuations update states after writing; edits/rewrites reconcile existing state. User-created facts remain authoritative. Invented agendas or private thoughts must fit the established cast and setting; they do not grant a character knowledge of off-screen events or overwrite what already happened.

Store state snapshots with the matching history checkpoint so Undo, Redo, Retry, branches, story switching, and project export/import restore the correct state. Repeated refreshes of unchanged manuscript must not advance time, age seeds, accumulate relationship points, or complete tasks merely because a button was clicked.

### Semantic changes required by a continuous manuscript

- **Agendas and world events:** advance when the manuscript establishes elapsed time or a relevant event. Preserve a pending agenda across tiny sentence continuations and refresh it after completion or a change of plans. Off-screen progression is optional.
- **Relationships:** retain bond/fondness/grudge fields if useful, but update from meaningful interactions. Original chat-turn counters and physical intimacy gates are not reliable authorization or relationship logic in a document.
- **Seeds and quests:** track planted facts and prerequisites, then mark payoff only when written. Favor scene/event-based progression over FF's automatic chat-turn aging and forced pruning. Pending plans remain prospective until realized.
- **Notebook:** retain reminder/thread/check categories and the 20-record cap; avoid duplicating dedicated module records or copying large passages.
- **Task checks and world simulation:** if generated by the model, label outcomes as model-authored checks/events. FF's `{{roll::1d20}}` macros require a real host interpreter; passing their text to a provider does not provide genuine random rolls, locked difficulties, or deterministic game rules. A later app-side dice engine would need saved rolls and reproducible history.
- **Environment/physics:** keep positions, access paths, conditions, and established world rules concise. Use setting-specific physics instead of imposing FF's combat style or universal perception distances.

## Source format and caveats

FF depends on SillyTavern `setvar`/`getvar`/`roll` macros and HTML detail blocks inside `GFX_START`/`GFX_END` markers. Its enabled Context Saver regex (`3fbb6c80-ab8f-4a21-8221-62c9f8546306`) removes older state blocks from prompt context from depth two onward. Other regexes repair formatting and style trackers. vChat's structured snapshot replacement serves that purpose without executing the source regex suite.

The JSON also contains separate MAX/BOLT/Micro chain-of-thought modules. Those are outside this Internal States adaptation; NPC thoughts are authored character state, not a request to expose hidden model reasoning. This adaptation rewrites the source ideas for vChat instead of importing FF's full role-play preset, prose rules, jailbreak instructions, graphics, or unrelated modules.

Validation verifies the format and bounds, not whether a model's state interpretation is true. Models can still infer an incorrect motive, miss an event, or contradict established facts; keep the current state inspectable and editable, and preserve the last valid state on failures.
