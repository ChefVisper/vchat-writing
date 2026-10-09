import { Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
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
export function LoreEntriesEditor({
  story,
  patch,
}: {
  story: Story;
  patch: (p: Partial<Story>) => void;
}) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const entries = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q
      ? story.lore.filter((l) =>
          `${l.title}\n${l.keywords}\n${l.content}`.toLowerCase().includes(q),
        )
      : story.lore;
  }, [query, story.lore]);
  const pages = Math.max(1, Math.ceil(entries.length / 20));
  const currentPage = Math.min(page, pages - 1);
  return (
    <>
      <div className="panel-heading">
        <div>
          <h2>Lorebook</h2>
        </div>
        <button
          className="icon"
          aria-label="Add lore entry"
          disabled={story.lore.length >= 2000}
          onClick={() => {
            setQuery("");
            setPage(Math.floor(story.lore.length / 20));
            patch({ lore: [...story.lore, newLore()] });
          }}
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
      {(story.lore.length > 20 || query) && (
        <>
          <Field label="Search lore entries">
            <input
              type="search"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(0);
              }}
              placeholder="Title, keywords or content"
            />
          </Field>
          <div className="row">
            <button
              aria-label="Previous lore entries"
              disabled={!currentPage}
              onClick={() => setPage(currentPage - 1)}
            >
              Previous
            </button>
            <small>
              {entries.length} entries · {currentPage + 1}/{pages}
            </small>
            <button
              aria-label="Next lore entries"
              disabled={currentPage >= pages - 1}
              onClick={() => setPage(currentPage + 1)}
            >
              Next
            </button>
          </div>
        </>
      )}
      {entries.slice(currentPage * 20, (currentPage + 1) * 20).map((l) => {
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
                maxLength={150}
                value={l.title}
                onChange={(e) => update({ title: e.target.value })}
              />
            </Field>
            <Field label="Content">
              <textarea
                maxLength={100000}
                value={l.content}
                onChange={(e) => update({ content: e.target.value })}
              />
            </Field>
            <Field label="Keywords (comma-separated)">
              <input
                value={l.keywords}
                onChange={(e) =>
                  update({ keywords: e.target.value, primaryKeys: undefined })
                }
              />
            </Field>
            <Field label="Secondary keywords (comma-separated)">
              <input
                value={l.secondary}
                onChange={(e) =>
                  update({
                    secondary: e.target.value,
                    secondaryKeys: undefined,
                  })
                }
              />
            </Field>
            {(
              [
                ["enabled", "Enabled"],
                ["constant", "Always active"],
                ["caseSensitive", "Case sensitive"],
                ["matchWholeWords", "Whole-word matching"],
              ] as const
            ).map(([key, label]) => (
              <Toggle
                key={key}
                label={label}
                value={l[key] ?? false}
                onChange={(v) => update({ [key]: v })}
              />
            ))}
            <Field label="Secondary keyword logic">
              <select
                value={l.selectiveLogic ?? "and-any"}
                onChange={(e) =>
                  update({
                    selectiveLogic: e.target.value as typeof l.selectiveLogic,
                  })
                }
              >
                <option value="and-any">AND ANY</option>
                <option value="and-all">AND ALL</option>
                <option value="not-any">NOT ANY</option>
                <option value="not-all">NOT ALL</option>
              </select>
            </Field>
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
                  max={
                    key === "probability"
                      ? 100
                      : key === "scanDepth"
                        ? 10000
                        : key === "priority"
                          ? 100000
                          : 262144
                  }
                  value={l[key]}
                  onChange={(e) =>
                    update({
                      [key]: Math.min(
                        key === "probability"
                          ? 100
                          : key === "scanDepth"
                            ? 10000
                            : key === "priority"
                              ? 100000
                              : 262144,
                        Math.max(0, +e.target.value),
                      ),
                    })
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
      {!!story.lore.length && !entries.length && (
        <p className="help">No matching entries.</p>
      )}
    </>
  );
}
