# Preset JSON inspection — 5 October 2026

Downloaded and parsed these public JSON files locally. Copies and `inspection.json` remain in this directory and are excluded from Git. Writer's Block now has a separate, opt-in co-writing adaptation; see [implementation notes](../../src/presets/README.md). External regex scripts and SillyTavern macros are not executed.

| Preset | Local file | Size | Prompt blocks |
| --- | --- | ---: | ---: |
| Freaky Frankenstein 5.4 Internal States | `Freaky Frankenstein 5.4.json` | 144,032 bytes | 63 |
| Megumin Suite V10 Universal | `Megumin V10 Universal.json` | 34,508 bytes | 25 |
| Megumin Engine | `Megumin Engine.json` | 10,920 bytes | 14 |
| Writer's Block Unlimited V2 | `Writers Block Unlimited V2.json` | 269,936 bytes | 258 |

Sources:

- [FF author's archive](https://rentry.org/freaky-frankenstein-presets), linking the [5.4 JSON download](https://www.mediafire.com/file/9f70q840092j5lr/Freaky_Frankenstein_5.4_Internal_States_%25282%2529.json/file).
- [Megumin author's repository / Presets](https://github.com/Arif-salah/Megumin-Suite/tree/main/Presets).
- [Writer's Block author's repository](https://github.com/deiomo/Writer-s-Block-Unlimited), linked from the [author's r/SillyTavernAI release post](https://www.reddit.com/r/SillyTavernAI/comments/1wwkoxh/update_writers_block_unlimited_v2_an_extremely/).

These are structured SillyTavern chat-completion presets, rather than a single prose prompt or a universal sampling configuration. Each includes `prompts`, `prompt_order`, and `extensions.regex_scripts`. The block counts above include inactive blocks and markers, so they are not runtime token counts. `inspection.json` records file hashes, field names, sampling values, and static enabled-block counts without reproducing prompt contents.

FF 5.4 uses stateful macros such as `setvar`, `getvar`, `addvar`, `incvar` and `roll`, plus context/response-size placeholders. This particular 5.4 file has no top-level sampling settings. Megumin's Universal and Engine files contain sampling fields and separate prompt orders; the author's full Suite also injects extension-managed rules. Writer's Block includes many optional modules and macros including `random`, `trim`, role names and comments.

A faithful vChat importer would need a prompt-block/order UI, supported macro expansion, role/persona substitution, and explicit handling of extension/regex behavior. Copying all blocks into the current writing prompt would include disabled instructions and unresolved macros, and may ask for output formats that the manuscript/notes parsers do not support. That importer is not part of the character-link and greetings update.
