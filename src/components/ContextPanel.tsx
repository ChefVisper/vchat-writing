import { Plus, Trash2 } from "lucide-react";
import { type Story, newLore } from "../types";
import { Field, Toggle, Position } from "./Fields";
import { estimate } from "../context/promptBuilder";
export function ContextPanel({
  story,
  patch,
}: {
  story: Story;
  patch: (p: Partial<Story>) => void;
}) {
  return (
    <>
      <h2>Memory</h2>

      {(["memory", "author"] as const).map((key) => (
        <section className="context-card" key={key}>
          <h3>{key === "memory" ? "Permanent memory" : "Author’s note"}</h3>
          <p>
            {key === "memory"
              ? "Included in every generation."
              : "Current writing instructions."}
          </p>
          <Toggle
            label="Enabled"
            value={story[key].enabled}
            onChange={(enabled) => patch({ [key]: { ...story[key], enabled } })}
          />
          <textarea
            aria-label={key === "memory" ? "Permanent memory" : "Author's note"}
            value={story[key].content}
            onChange={(e) =>
              patch({ [key]: { ...story[key], content: e.target.value } })
            }
          />
          <small>≈ {estimate(story[key].content)} tokens</small>
          <Position
            value={story[key].position}
            onChange={(position) =>
              patch({ [key]: { ...story[key], position } })
            }
          />
          {key === "author" && (
            <Field label="Depth (paragraphs from end)">
              <input
                type="number"
                min="0"
                max="100"
                value={story.author.depth}
                onChange={(e) =>
                  patch({
                    author: {
                      ...story.author,
                      depth: Math.max(0, +e.target.value),
                    },
                  })
                }
              />
            </Field>
          )}
        </section>
      ))}
    </>
  );
}
export function LorebookEditor({
  story,
  patch,
}: {
  story: Story;
  patch: (p: Partial<Story>) => void;
}) {
  return (
    <>
      <div className="panel-heading">
        <div>
          <h2>Lorebook</h2>
        </div>
        <button
          className="icon"
          aria-label="Add lore entry"
          onClick={() => patch({ lore: [...story.lore, newLore()] })}
        >
          <Plus size={18} />
        </button>
      </div>
      <Field label="Global lore budget (tokens)">
        <input
          type="number"
          min="0"
          value={story.loreBudget}
          onChange={(e) => patch({ loreBudget: Math.max(0, +e.target.value) })}
        />
      </Field>
      {story.lore.map((l) => {
        const update = (p: Partial<typeof l>) =>
          patch({
            lore: story.lore.map((x) => (x.id === l.id ? { ...l, ...p } : x)),
          });
        return (
          <details className="context-card" key={l.id} open>
            <summary>
              {l.title}
              <button
                aria-label="Delete lore"
                className="icon"
                onClick={() =>
                  patch({ lore: story.lore.filter((x) => x.id !== l.id) })
                }
              >
                <Trash2 size={14} />
              </button>
            </summary>
            <Field label="Title">
              <input
                value={l.title}
                onChange={(e) => update({ title: e.target.value })}
              />
            </Field>
            <Field label="Content">
              <textarea
                value={l.content}
                onChange={(e) => update({ content: e.target.value })}
              />
            </Field>
            <Field label="Keywords (comma-separated)">
              <input
                value={l.keywords}
                onChange={(e) => update({ keywords: e.target.value })}
              />
            </Field>
            <Field label="Secondary keywords (match any)">
              <input
                value={l.secondary}
                onChange={(e) => update({ secondary: e.target.value })}
              />
            </Field>
            {(
              [
                ["enabled", "Enabled"],
                ["constant", "Always active"],
                ["caseSensitive", "Case sensitive"],
              ] as const
            ).map(([key, label]) => (
              <Toggle
                key={key}
                label={label}
                value={l[key]}
                onChange={(v) => update({ [key]: v })}
              />
            ))}
            {(
              [
                ["priority", "Priority"],
                ["scanDepth", "Scan depth (paragraphs)"],
                ["budget", "Entry token budget (0 = unlimited)"],
                ["probability", "Activation probability (%)"],
              ] as const
            ).map(([key, label]) => (
              <Field key={key} label={label}>
                <input
                  type="number"
                  min="0"
                  max={key === "probability" ? 100 : undefined}
                  value={l[key]}
                  onChange={(e) =>
                    update({ [key]: Math.max(0, +e.target.value) })
                  }
                />
              </Field>
            ))}
          </details>
        );
      })}
      {!story.lore.length && (
        <div className="empty">No entries. Use + to add one.</div>
      )}
    </>
  );
}
