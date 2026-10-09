# FF 5.4 Internal States: vChat adaptation assessment

Inspected 9 October 2026. This is a design assessment; no FF preset or state engine is installed by this update.

Sources: the [author's FF archive](https://rentry.org/freaky-frankenstein-presets) and its linked FF 5.4 JSON. The previously downloaded 144,032-byte file contains 63 prompt blocks; the local source copy remains excluded from Git. External prompt content is treated as data, and its macros and regex scripts are not executed.

The Internal States wrapper asks for trackers appended to model output as HTML, with extension regexes controlling visibility/context. Optional modules cover NPC goals, steps and locations, off-screen activity, relationships, factions, quests, inventory, planted narrative threads, fictional NPC thoughts and a GM notebook. Other modules add game/simulation rules. These are authored fictional state, distinct from the provider's exposed model reasoning. A direct HTML append would mix trackers into vChat's continuous manuscript, while unimplemented `setvar` / `getvar` macros would stay unresolved.

An adaptation fits vChat's existing separate writing/note requests better:

1. Optional per-story State notes with structured fields: character, location, current goal, attitude/relationship, known facts and unresolved threads. Start with a small subset rather than enabling every FF module.
2. The note stage emits complete validated JSON after a successful passage. Keep invented plans in per-note Creative mode; observed events remain evidence-based. Separate private character plans from what each viewpoint character knows.
3. Carry a concise latest-state summary into context, with user control over included fields. Store change history separately; no raw tracker HTML in prose.
4. Link updates to the corresponding AI segment so Undo/Redo and Retry restore the associated state. Preserve review-before-apply where requested.
5. Advance off-screen agendas when manuscript time or events warrant it, not merely because Write, Note or Retry was clicked. This matters in co-writing, where a continuation can cover seconds or years.

The existing Writer's Block Scene state, Plot threads and Character agendas notes are a useful first layer. A dedicated character/state panel, schema validation and time-aware agenda updates would be the next implementation step. Reliability still depends on the model; structured output validation cannot prove an invented state agrees with the manuscript.
