import { useState } from "react";
import {
  DEFAULT_PROMPT_TEMPLATE,
  DEFAULT_NOTE_PROMPT,
  type Story,
} from "../types";
import { buildPrompt } from "../context/promptBuilder";
import { providers } from "../providers";
import { taskInstructions } from "../providers/types";
export function PromptInspector({
  story,
  lastPrompt,
  patch,
  assembled,
}: {
  story: Story;
  lastPrompt: string;
  patch: (value: Partial<Story>) => void;
  assembled: ReturnType<typeof buildPrompt>;
}) {
  const p = assembled;
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
      {story.connection.kind === "openrouter" && (
        <details>
          <summary>OpenRouter system instruction</summary>
          <p className="help">
            This output contract is sent before your editable writing prompt.
            Its estimated tokens are reserved from Max Context.
          </p>
          <pre>{taskInstructions.writing}</pre>
        </details>
      )}
      <details>
        <summary>Note prompt</summary>
        <label className="field">
          <span>Note prompt template</span>
          <textarea
            className="prompt-template"
            value={story.notePromptTemplate ?? DEFAULT_NOTE_PROMPT}
            onChange={(e) => patch({ notePromptTemplate: e.target.value })}
            spellCheck={false}
          />
        </label>
        <p className="help">
          Keep {"{{notes}}"} and {"{{prose}}"}. The model must return an updates
          JSON object.
        </p>
        <button
          onClick={() => patch({ notePromptTemplate: DEFAULT_NOTE_PROMPT })}
        >
          Reset note prompt
        </button>
      </details>

      <div className="budget">
        <strong>
          {p.total.toLocaleString()} <span>/ {p.budget.toLocaleString()}</span>
        </strong>
        <small>
          writing output {story.settings.maxTokens.toLocaleString()} · note
          output {story.settings.noteMaxTokens.toLocaleString()} · max context{" "}
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
