import { useState } from "react";
import { DEFAULT_PROMPT_TEMPLATE, type Story } from "../types";
import { buildPrompt } from "../context/promptBuilder";
import { providers } from "../providers";
export function PromptInspector({
  story,
  lastPrompt,
  patch,
}: {
  story: Story;
  lastPrompt: string;
  patch: (value: Partial<Story>) => void;
}) {
  const p = buildPrompt(story);
  const [exact, setExact] = useState<string>("");
  return (
    <>
      <h2>Prompt</h2>
      <label className="field">
        <span>Prompt template</span>
        <textarea
          className="prompt-template"
          value={story.promptTemplate ?? DEFAULT_PROMPT_TEMPLATE}
          onChange={(e) => patch({ promptTemplate: e.target.value })}
          spellCheck={false}
        />
      </label>
      <p className="help">
        Use {"{{context}}"} for memory, notes, lore, and earlier text;
        {" {{story}}"} for the continuation point. Both are required. Changes
        are saved with this story and used on the next Continue.
      </p>
      <button
        onClick={() => patch({ promptTemplate: DEFAULT_PROMPT_TEMPLATE })}
        disabled={
          (story.promptTemplate ?? DEFAULT_PROMPT_TEMPLATE) ===
          DEFAULT_PROMPT_TEMPLATE
        }
      >
        Reset prompt
      </button>
      {p.invalidTemplate && (
        <p className="error" role="alert">
          Add both {"{{context}}"} and {"{{story}}"} before continuing.
        </p>
      )}

      <div className="budget">
        <strong>
          {p.total.toLocaleString()} <span>/ {p.budget.toLocaleString()}</span>
        </strong>
        <small>
          input limit {story.settings.inputTokens.toLocaleString()} · output{" "}
          {story.settings.maxTokens.toLocaleString()} · max context{" "}
          {story.settings.context.toLocaleString()}
        </small>
        <meter value={p.total} max={Math.max(1, p.budget)} />
      </div>
      {Object.entries(p.breakdown).map(([name, tokens]) => (
        <div className="token-row" key={name}>
          <span>{name}</span>
          <span>{tokens}</span>
        </div>
      ))}
      {p.trimmed > 0 && (
        <p className="callout">
          {p.trimmed} characters trimmed from the oldest story text.
        </p>
      )}
      {p.overflow && (
        <p className="error">
          Protected context exceeds the budget. Increase context size or shorten
          your notes before generating.
        </p>
      )}
      {story.connection.kind === "kobold" && (
        <button
          onClick={async () => {
            try {
              setExact(
                `${await providers.kobold.count!(story.connection, p.prompt)} tokens (model tokenizer)`,
              );
            } catch {
              setExact("Tokenizer unavailable.");
            }
          }}
        >
          Count with model
        </button>
      )}
      <p className="help">{exact}</p>
      <h3>Lore activation</h3>
      {p.lore.length ? (
        p.lore.map((x) => (
          <div className="token-row" key={x.entry.id}>
            <span>{x.entry.title}</span>
            <span>
              {x.active ? "Included · " : ""}
              {x.reason}
            </span>
          </div>
        ))
      ) : (
        <p className="help">No lore entries yet.</p>
      )}
      <details open>
        <summary>Exact assembled prompt</summary>
        <pre className="prompt">{p.prompt}</pre>
      </details>
      <details>
        <summary>Prompt sections</summary>
        {p.sections.map((s, i) => (
          <div key={i}>
            <h4>{s.name}</h4>
            <pre className="prompt">{s.text}</pre>
          </div>
        ))}
      </details>
      {lastPrompt && (
        <details>
          <summary>Last sent story prompt</summary>
          <pre className="prompt">{lastPrompt}</pre>
        </details>
      )}
    </>
  );
}
