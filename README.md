# Margin

A local-first, continuous-prose writing desk built with React, TypeScript, and Vite. Your document is one editable manuscript; AI continuations are tracked separately for retry and branching.

## Run locally

Requires Node.js 22.12+ (tested with Node 24).

```sh
npm install
npm run dev
```

Open http://127.0.0.1:5173. Keep using the same origin and browser profile to access your IndexedDB library. No account, backend database, analytics, or cloud sync is used. The interface uses system fonts. Start the local server to use the app; this version is not an installable offline PWA.

```sh
npm run build
npm test
npx playwright install chromium
# With npm run dev running in another terminal:
npx playwright test
```

## Connect a model

Open **Connection** (plug icon), choose a provider, and test the connection.

- **KoboldCpp:** defaults to `http://localhost:5001`. Supports native completion, SSE streaming, abort, model discovery, context discovery, and token counting. Run your KoboldCpp server with browser access/CORS permitted for the app origin.
- **OpenAI-compatible:** supply a base URL ending in `/v1`, such as `http://localhost:1234/v1`, and a text-completion model identifier. Uses `/completions`, not a chat endpoint. Sends common completion parameters plus Top K, Min P and Repetition penalty extensions; the server must support them.
- **AI Horde:** defaults to `https://aihorde.net`. Uses asynchronous text generation, polls for completed text, and cancels queued work when stopped. Horde does not stream individual tokens. Optional model identifier and API key; an empty key uses anonymous access.
- **OpenRouter:** chat completions, fetched model capabilities and exposed reasoning; defaults to `https://openrouter.ai/api/v1`.
- **NanoGPT:** chat completions, model discovery and exposed reasoning; defaults to `https://api.nano-gpt.com/api/v1`.

Keys are saved in this browser's local storage, separately from the manuscript database, and are excluded from project exports and repository files. They survive reloads and mobile tab suspension. Use Forget API key to remove a saved key; clearing browser data also removes keys. Notes and manuscript context are sent to the provider you select. A remote provider therefore receives that context; use a local model for an entirely local workflow. Do not put credentials in endpoint URLs.

## Writing workflow

Type directly into any part of the manuscript. **Continue** appends model output; **Stop** preserves received text. **Retry** replaces only the latest unedited continuation and restores its pre-generation notes. After manual edits, retry is disabled to avoid deleting those edits. Create a branch from the history panel to explore older continuations.

- `Ctrl/Cmd+Enter`: continue
- `Escape`: stop, or leave focus mode
- `Ctrl/Cmd+Z` and `Ctrl/Cmd+Shift+Z`: manuscript undo / redo
- `Ctrl/Cmd+S`: flush local saves

Other text fields retain normal editing shortcuts. Focus mode hides the surrounding tools. Settings include font size, page width, generation presets, and provider-appropriate sampling controls. Light and dark appearances persist locally.

The library supports creating, duplicating, renaming (edit the manuscript title), importing, and deleting stories. History provides snapshots, branch creation, and text/project export. Branches are numbered within their story family: `Story · Branch 1`, `Story · Branch 2`, etc. Full JSON projects preserve memory, lore, notes and revisions, settings, pending note reviews, generation records, snapshots, and document undo history (latest 100 edits).

## Context and continuity

**Memory** holds lasting facts. **Author's note** holds scene guidance, with a paragraph-based injection depth. **Lorebook** uses comma-separated literal keywords, optional secondary keywords (ANY), case sensitivity, enabled/constant flags, priority, paragraph scan depth, entry and global budgets, and probability. Higher priorities consume the lore budget first. Oversized entries are skipped rather than cut in half. Probability uses a deterministic roll based on document content and entry ID so prompt inspection and generation agree. Recursive lore and regex matching are intentionally not implemented.

The prompt inspector shows the exact prompt, section token estimates, activation reasons, trimmed character count, and last sent story prompt. Input budget reserves space for the requested output. Old prose is trimmed first; memory and active notes are never silently removed. Generation is blocked if protected context alone exceeds the budget. Estimates use UTF-8 byte length / 3.5, not a tokenizer; **Count with model** provides native KoboldCpp counts. Estimates may differ substantially for some languages/models.

## AI-editable notes

Notes are arbitrary text, not character sheets. Each has enabled, included, AI-editable, locked, injection position, keyword, and update-mode controls. Automatic updates are off for notes whose mode is Off, which are locked, disabled, or not AI-editable.

After a successful Continue/Retry, eligible notes trigger a second request using the configured notes connection. The updater receives current notes and new prose and must return:

```json
{
  "updates": [
    { "noteId": "existing-id", "newContent": "complete replacement content" }
  ]
}
```

Validation rejects the entire response on malformed JSON, unknown IDs, duplicate operations, oversized values, or attempts to touch ineligible notes. Applying a patch checks the old content again to avoid overwriting manual edits. Auto mode applies valid updates; Review mode presents old and new content with individual/all accept and reject controls. Pending reviews survive refresh and must be resolved before the next continuation. Every applied change keeps a restorable revision. Snapshots capture both manuscript and notes.

The model is instructed to preserve unchanged facts and only infer changes supported by the prose. This instruction cannot guarantee factual accuracy; review mode is the default. The updater uses its own configurable Note Output budget (2,048 tokens by default). It trims older prose to Max Context while preserving note content and instructions; it reports when trimming occurred. Incomplete JSON and truncated responses leave notes unchanged. In Continue mode, Stop writing preserves the partial passage and advances to note generation with a new cancellation signal. Stop notes cancels that stage. Failed requests preserve received prose and show an error.

## Modules

- `src/providers`: provider interface and five adapters; streaming parser and reasoning separation
- `src/context`: prompt assembly, lore activation, token estimates and trimming
- `src/generation`: note update validation, retry safety, continuation cleanup
- `src/storage`: IndexedDB and versioned project transfer
- `src/store.ts`: centralized document/library state and persistence queue
- `src/components`: notebook, memory/lore, connection/settings, prompt inspection
- `src/App.tsx`: writing workspace and generation orchestration

## Verification and limits

Unit tests cover prompt assembly, overflow, trimming, lore, locked notes, malformed and stale updates, retry checks, project transfer, SSE parsing, supported provider parameters, native abort, and Horde polling. Browser tests use controlled provider responses for the write/stream/retry/edit/note-update/refresh flow, stopping, and desktop/mobile appearance. This repository does not include model weights or API credentials. Live compatibility with a running KoboldCpp, OpenAI-compatible server, or Horde has not been verified in this environment.

Story storage is device-local, not a backup. Use full project export to move browsers or protect important work. Review changes are whole-note comparisons; granular line patches, recursive lore, collaborative multi-user editing, and KoboldAI-format imports are extension points.

## Behavioral references

Clean implementation informed by official documentation; no upstream source or UI copied:

- [KoboldAI Lite / KoboldCpp endpoints](https://koboldai.com/KoboldAILite/)
- [KoboldCpp API reference](https://lite.koboldai.net/koboldcpp_api)
- [SillyTavern World Info](https://docs.sillytavern.app/usage/core-concepts/worldinfo/)
- [SillyTavern Author's Note](https://docs.sillytavern.app/usage/core-concepts/authors-note/)
- [AI Horde API](https://aihorde.net/api/)

## Compact interface and OpenRouter

The editor defaults to dark blue/charcoal with system fonts. The document starts directly below the toolbar; its name is a small field in the top bar. Notes and other panels start closed. Settings has one Max Context limit and separate Writing Output and Note Output budgets. Each request's effective input budget is Max Context minus that request's output budget. These settings persist per story and in project exports.

Open AI, select OpenRouter, enter your API key and a provider/model-id, then test the connection. The default base URL is https://openrouter.ai/api/v1. Connection testing validates the key and retrieves the selected model's context window without generating text. Keys persist in this browser's local storage.

If OpenRouter rejects a request with HTTP 403, Margin shows the provider's returned reason. OpenRouter can use 403 for model access, account limits, privacy settings, and guardrails. A provider restriction must be changed in OpenRouter; Margin cannot override it. API keys are redacted from displayed error text.

The fourth provider adapter uses chat completions for streaming prose and non-streaming note updates. Reasoning fields are excluded from the manuscript. Live OpenRouter access has not been tested with a real key; automated tests use controlled API responses.

Reference: [OpenRouter chat completion API](https://openrouter.ai/docs/api/api-reference/chat/create-a-chat-completion).

## Android with Termux

Clone into Termux's home directory (not shared `/sdcard` storage):

```sh
pkg update
pkg install git nodejs-lts
cd ~
git clone https://github.com/ChefVisper/vchat-writing.git
cd vchat-writing
npm ci
npm run dev
```

Open `http://127.0.0.1:5173/` in a browser on the same phone. Vite listens on all interfaces, so another device on the same network can use the phone's LAN address and port 5173. Keep the phone and Termux running while you write. Your library is stored in that browser's IndexedDB; export a project JSON to move stories between devices. API keys survive a reload on the same browser and origin; they are not synced across devices.

OpenRouter and AI Horde work through the phone's internet connection. If KoboldCpp runs on a different device, replace `localhost` in Connection with that device's LAN address, ensure its server listens on the network, and enable browser access/CORS. On a phone, `localhost:5001` refers to the phone itself.

The model picker in Connection can fetch available model IDs for the selected provider. OpenRouter responses containing reasoning but no visible prose now show a specific error; increasing **Writing Output** in Settings or choosing another model can resolve it. Continuous typing is grouped into an undo step, while each AI continuation remains a separate step.

The manuscript editor scrolls within its own writing area and follows new AI prose to the bottom. In **Prompt**, edit the per-story prompt template. `{{context}}` inserts the selected memory, lore, notes, and earlier story text; `{{story}}` inserts the continuation point. Both placeholders are required. The exact assembled prompt is previewed below the editor, and the template is saved in local projects and JSON exports.

## Writing and notes controls

- **Continue** writes a passage and then checks notes. **Retry** replaces the latest unchanged passage and checks notes.
- **Write** generates prose only. **Note** checks the current manuscript against editable notes without adding prose.
- **Stop writing** moves Continue/Retry to the note stage; in Write-only mode it finishes the run. **Stop notes** cancels note generation without applying partial JSON.
- In Connection, switch between Writing connection and Notes connection. Notes can share the same API and model, use the same API/key with a different model, or use a separate provider, endpoint, model and key.
- Settings provides Writing Output, Note Output, Thinking Output, Note Thinking Output and Max Context. Writing and note reasoning have independent on/off and effort controls for OpenRouter and NanoGPT. Support varies by model; some require thinking. Each request reserves both its visible and thinking budgets in Max Context.
- Both writing and note prompts can be edited in Prompt. Custom prompts survive updates. Old unmodified default writing prompts are upgraded automatically.
- Click inside the latest unchanged AI passage to tint its text a subtle blue. Click elsewhere or edit the text to clear the tint. The caret remains usable.
- Status remains visible in portrait mobile mode.

The CodeMirror editor renders the visible portion of the manuscript. Streaming UI updates are batched, database writes are coalesced, and prompt previews are computed only while open. This avoids rendering the whole document or saving a full project per token.

Local database records and version 2 project exports use shared manuscript references and text deltas for undo/redo, AI passages and snapshots. Note snapshots and revisions are also deduplicated. Earlier versions stored the entire manuscript many times; a modest story could therefore have a 50 MB export. Version 1 JSON files still import with their history intact. Existing local stories use the compact format on their next save; re-export an old project to get the smaller file. Large collections of genuinely different snapshots can still take substantial space. Editor updates apply changed spans without reading the whole document back, and word counts are debounced while typing.

Select a passage anywhere in the manuscript, then press **Rewrite selection** (feather icon). Enter an editing instruction, generate a replacement, and review or edit its preview. **Apply replacement** changes only the selected range as one undo step; **Discard** keeps the manuscript. The writing model, Writing Output, scene guidance and nearby prose are used. If the manuscript changes after selection, applying is blocked until you select again. Notes remain unchanged; press **Note** afterward to check continuity. On mobile the panel includes its own Stop rewrite control.

Settings includes **Trim incomplete sentences** (off by default). It removes an unfinished final sentence only from finished AI continuations or rewrites. It never trims existing manuscript text and manual Stop preserves partial output. Sentence-boundary detection is approximate, especially for abbreviations; ellipsis endings are treated as unfinished. A response with no complete sentence is not appended.

OpenRouter settings include **Top K**, **Min P** and **Repetition penalty**, using the API's `top_k`, `min_p` and `repetition_penalty` fields. Parameters absent from a fetched model's supported-parameter list are omitted. Support also depends on the upstream provider; KoboldCpp's repetition range and Typical P are not sent. See [OpenRouter parameters](https://openrouter.ai/docs/api/reference/parameters). OpenRouter requests now have a task-specific system instruction in addition to the editable prompt. The tighter default writing prompt upgrades previous unmodified defaults without overwriting custom templates.

Enter and Shift+Enter insert line breaks, including Android soft-keyboard Enter events. AI paragraph breaks are preserved in the manuscript. The default writing prompt asks the model to finish an author's incomplete sentence, use paragraph breaks, and end its own passage on a complete sentence. Existing unmodified defaults are upgraded; custom prompts remain unchanged. A provider's hard output limit can still cut a sentence short, so increase Writing Output if this persists.

Note parsing accepts complete JSON wrapped in Markdown or explanatory text and ignores explicit thinking blocks. It still rejects unknown/locked note IDs, duplicate operations and incomplete content. OpenRouter JSON mode is used when the fetched model catalog advertises support. This improves compatibility but cannot guarantee a model's factual accuracy. Real provider behavior should still be reviewed.

To update an existing Termux installation, stop the server with Ctrl+C, then:

```sh
cd ~/vchat-writing
git pull --ff-only
npm ci
npm run dev
```

Keep using the same browser and origin (for example, http://127.0.0.1:5173) to retain access to local stories and saved keys.

API references: [OpenRouter reasoning controls](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens), [OpenRouter structured outputs](https://openrouter.ai/docs/guides/features/structured-outputs).

## NanoGPT and Thinking

Select **NanoGPT** in AI/Connection, enter your key, and use **Fetch models**. The default base URL is `https://api.nano-gpt.com/api/v1`. Writing and notes can use separate NanoGPT models or different providers. NanoGPT requests use chat completions with `reasoning.effort` (`none` when disabled). Its normal endpoint returns exposed thoughts in `reasoning` or `reasoning_content`; both are supported. A model can still reason when disabled, or expose no readable thoughts. See [NanoGPT introduction](https://docs.nano-gpt.com/introduction), [chat completions](https://docs.nano-gpt.com/api-reference/endpoint/chat-completion) and [extended thinking](https://docs.nano-gpt.com/api-reference/miscellaneous/extended-thinking).

The brain button in the editor toolbar opens **Thinking**. Exposed reasoning from writing, rewriting and note updates is stored separately, including reasoning received before a Stop/error. It never enters the manuscript, word count or default context. Check individual records and enable **Include selected thinking in context** to use only those records as unverified reference in writing, rewrite and note prompts. Switching it off retains your selections. Records persist in local storage and project exports; delete unwanted records in the panel. Undo/redo now sit at the bottom left and continue to operate on manuscript changes rather than thinking records.

**Thinking Output** and **Note Thinking Output** bound the stored reasoning using the app's UTF-8 token estimate. Writing/rewrite visible text has a separate estimated Writing Output cap. For example, Writing Output 150 and Thinking Output 2,048 request a combined API budget of 2,198, so reasoning does not simply consume the original 150-token allowance. The app stops visible generation at its estimated writing cap. Exact counts depend on the model tokenizer, and a provider can still exhaust its combined budget before producing an answer. Valid note JSON is never cut with the local prose estimate: Note Output is enforced by the provider and the result must pass complete-JSON validation.

OpenRouter receives a reasoning `max_tokens` budget only when its fetched model catalog advertises that capability; otherwise it receives an effort level. Models may impose minimum thinking budgets (for example, Anthropic's 1,024-token minimum). Fetch models before choosing a budget. NanoGPT documents effort controls but no separate hard reasoning-token cap. On effort-only or local servers, Thinking Output limits **captured text and the reserved allowance**, not server-side reasoning computation or billing. Local completion servers use their own thinking controls. Encrypted or unexposed reasoning cannot be displayed. These API limitations prevent a universal exact split between answer and reasoning tokens. See [OpenRouter reasoning controls](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens).

Both budgets are reserved even with Thinking off, for models that think anyway; set Thinking Output to 0 to reserve/store none. Settings also lets you edit **Thinking prefix** and **Thinking suffix**, defaulting to `<think>` / `</think>`. Both custom tags and default tags are filtered incrementally, even when split across network chunks. Unclosed tagged thoughts remain private. **Server prefills thinking prefix** is for completion servers that omit the opening tag because it is already in their prompt. Do not enable it for normal separate-field chat responses. Untagged reasoning mixed indistinguishably with answer prose cannot be reliably detected; use a model exposing separate reasoning fields or its correct tags.

Top K, Min P and Repetition penalty sliders are available for all five providers. KoboldCpp/Horde use native sampler names; NanoGPT/OpenRouter/OpenAI-compatible completions use `top_k`, `min_p`, `repetition_penalty`. Explicitly unsupported catalog parameters are omitted for NanoGPT/OpenRouter. Generic OpenAI-compatible completion servers must implement these extensions; official OpenAI endpoints and some servers can reject them. See [NanoGPT chat parameters](https://docs.nano-gpt.com/api-reference/endpoint/chat-completion) and [OpenRouter parameters](https://openrouter.ai/docs/api/reference/parameters).

Automated tests exercise controlled NanoGPT and OpenRouter responses, fragmented tags, forced reasoning, independent budgets, selective context, persistence, samplers and portrait mobile controls. Live paid generation has not been tested with a real NanoGPT key.
