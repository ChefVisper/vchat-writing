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
- **OpenAI-compatible:** supply a base URL ending in `/v1`, such as `http://localhost:1234/v1`, and a text-completion model identifier. Uses `/completions`, not a chat endpoint. Sends only the common completion parameters; native Kobold sampling settings are not sent.
- **AI Horde:** defaults to `https://aihorde.net`. Uses asynchronous text generation, polls for completed text, and cancels queued work when stopped. Horde does not stream individual tokens. Optional model identifier and API key; an empty key uses anonymous access.

Keys live only in browser memory for the session and are excluded from project exports. Notes and manuscript context are sent to the provider you select. A remote provider therefore receives that context; use a local model for an entirely local workflow. Do not put credentials in endpoint URLs.

## Writing workflow

Type directly into any part of the manuscript. **Continue** appends model output; **Stop** preserves received text. **Retry** replaces only the latest unedited continuation and restores its pre-generation notes. After manual edits, retry is disabled to avoid deleting those edits. Create a branch from the history panel to explore older continuations.

- `Ctrl/Cmd+Enter`: continue
- `Escape`: stop, or leave focus mode
- `Ctrl/Cmd+Z` and `Ctrl/Cmd+Shift+Z`: manuscript undo / redo
- `Ctrl/Cmd+S`: flush local saves

Other text fields retain normal editing shortcuts. Focus mode hides the surrounding tools. Settings include font size, page width, generation presets, and provider-appropriate sampling controls. Light and dark appearances persist locally.

The library supports creating, duplicating, renaming (edit the manuscript title), importing, and deleting stories. History provides snapshots, branch creation, and text/project export. Full JSON projects preserve memory, lore, notes and revisions, settings, pending note reviews, generation records, snapshots, and document undo history (latest 100 edits).

## Context and continuity

**Memory** holds lasting facts. **Author's note** holds scene guidance, with a paragraph-based injection depth. **Lorebook** uses comma-separated literal keywords, optional secondary keywords (ANY), case sensitivity, enabled/constant flags, priority, paragraph scan depth, entry and global budgets, and probability. Higher priorities consume the lore budget first. Oversized entries are skipped rather than cut in half. Probability uses a deterministic roll based on document content and entry ID so prompt inspection and generation agree. Recursive lore and regex matching are intentionally not implemented.

The prompt inspector shows the exact prompt, section token estimates, activation reasons, trimmed character count, and last sent story prompt. Input budget reserves space for the requested output. Old prose is trimmed first; memory and active notes are never silently removed. Generation is blocked if protected context alone exceeds the budget. Estimates use UTF-8 byte length / 3.5, not a tokenizer; **Count with model** provides native KoboldCpp counts. Estimates may differ substantially for some languages/models.

## AI-editable notes

Notes are arbitrary text, not character sheets. Each has enabled, included, AI-editable, locked, injection position, keyword, and update-mode controls. Automatic updates are off for notes whose mode is Off, which are locked, disabled, or not AI-editable.

After a successful story generation, eligible notes trigger a second request using the same provider. The updater receives current notes and new prose and must return:

```json
{
  "updates": [
    { "noteId": "existing-id", "newContent": "complete replacement content" }
  ]
}
```

Validation rejects the entire response on malformed JSON, unknown IDs, duplicate operations, oversized values, or attempts to touch ineligible notes. Applying a patch checks the old content again to avoid overwriting manual edits. Auto mode applies valid updates; Review mode presents old and new content with individual/all accept and reject controls. Pending reviews survive refresh and must be resolved before the next continuation. Every applied change keeps a restorable revision. Snapshots capture both manuscript and notes.

The model is instructed to preserve unchanged facts and only infer changes supported by the prose. This instruction cannot guarantee factual accuracy; review mode is the default. The updater uses a 1,024-token response budget; oversized update prompts are skipped with a visible error, preserving the manuscript and notes. Stopped or failed story requests do not trigger updates.

## Modules

- `src/providers`: provider interface and four adapters; streaming parser
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

The editor defaults to dark blue/charcoal with system fonts. The document starts directly below the toolbar; its name is a small field in the top bar. Notes and other panels start closed. Settings contains separate numeric limits for input tokens, output tokens, and total context. The effective input budget is the smaller of the input limit and total context minus output. These settings persist per story and in project exports.

Open AI, select OpenRouter, enter your API key and a provider/model-id, then test the connection. The default base URL is https://openrouter.ai/api/v1. Connection testing validates the key and retrieves the selected model's context window without generating text. Keys remain session-only.

If OpenRouter rejects a request with HTTP 403, Margin shows the provider's returned reason. OpenRouter can use 403 for model access, account limits, privacy settings, and guardrails. A provider restriction must be changed in OpenRouter; Margin cannot override it. API keys are redacted from displayed error text.

The fourth provider adapter uses chat completions for streaming prose and non-streaming note updates. Reasoning fields are excluded from the manuscript. Live OpenRouter access has not been tested with a real key; automated tests use controlled API responses.

Reference: [OpenRouter chat completion API](https://openrouter.ai/docs/api/api-reference/chat/create-a-chat-completion).

## Android with Termux

Put the project source in Termux's home directory (not shared `/sdcard` storage), then run:

```sh
pkg update
pkg install nodejs-lts
cd ~/margin
npm ci
npm run dev
```

Open `http://127.0.0.1:5173/` in a browser on the same phone. Vite listens on all interfaces, so another device on the same network can use the phone's LAN address and port 5173. Keep the phone and Termux running while you write. Your library is stored in that browser's IndexedDB; export a project JSON to move stories between devices. API keys are session only and must be entered again after a reload.

OpenRouter and AI Horde work through the phone's internet connection. If KoboldCpp runs on a different device, replace `localhost` in Connection with that device's LAN address, ensure its server listens on the network, and enable browser access/CORS. On a phone, `localhost:5001` refers to the phone itself.

The model picker in Connection can fetch available model IDs for the selected provider. OpenRouter responses containing reasoning but no visible prose now show a specific error; increasing **Output limit** in Settings or choosing another model can resolve it. Continuous typing is grouped into an undo step, while each AI continuation remains a separate step.

The manuscript editor scrolls within its own writing area and follows new AI prose to the bottom. In **Prompt**, edit the per-story prompt template. `{{context}}` inserts the selected memory, lore, notes, and earlier story text; `{{story}}` inserts the continuation point. Both placeholders are required. The exact assembled prompt is previewed below the editor, and the template is saved in local projects and JSON exports.
