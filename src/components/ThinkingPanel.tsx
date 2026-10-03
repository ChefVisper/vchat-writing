import type { Story } from "../types";
import { Toggle } from "./Fields";
import { tokenEstimate } from "../generation/thinking";
export function ThinkingPanel({
  story,
  patch,
}: {
  story: Story;
  patch: (p: Partial<Story>) => void;
}) {
  const thoughts = story.thoughts ?? [];
  return (
    <>
      <h2>Thinking</h2>
      <Toggle
        label="Include selected thinking in context"
        value={story.settings.includeThinking}
        onChange={(includeThinking) =>
          patch({ settings: { ...story.settings, includeThinking } })
        }
      />
      <p className="help">
        Thoughts never enter the manuscript or word count. Only checked records
        enter prompts, and only while the switch above is on. They are
        unverified reference material. Some models do not expose reasoning text.
      </p>
      {!thoughts.length && (
        <p className="help">
          Exposed thoughts will appear here as the model runs, even if Thinking
          was switched off.
        </p>
      )}
      {[...thoughts].reverse().map((t) => (
        <details
          className="thinking-record"
          key={t.id}
          open={t.id === thoughts.at(-1)?.id}
        >
          <summary>
            {t.model || t.provider} · {t.purpose} · ~
            {tokenEstimate(t.text).toLocaleString()} tokens
          </summary>
          <small>{new Date(t.at).toLocaleString()}</small>
          <Toggle
            label="Use this thinking in context"
            value={t.selected}
            onChange={(selected) =>
              patch({
                thoughts: thoughts.map((x) =>
                  x.id === t.id ? { ...x, selected } : x,
                ),
              })
            }
          />
          <pre>{t.text}</pre>
          <button
            onClick={() =>
              patch({ thoughts: thoughts.filter((x) => x.id !== t.id) })
            }
          >
            Delete thinking record
          </button>
        </details>
      ))}
    </>
  );
}
