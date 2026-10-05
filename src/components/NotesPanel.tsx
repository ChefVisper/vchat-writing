import { useState } from "react";
import { Plus, Trash2, LockKeyhole, NotebookPen, History } from "lucide-react";
import { newNote, uid, type Story, type Note } from "../types";
import { Field, Toggle, Position } from "./Fields";
import type { Update } from "../generation/stateUpdater";
export function NotesPanel({
  story,
  patch,
  pending,
  accept,
  reject,
}: {
  story: Story;
  patch: (p: Partial<Story>) => void;
  pending: Update[];
  accept: (id?: string) => void;
  reject: () => void;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const change = (id: string, p: Partial<Note>) =>
    patch({
      notes: story.notes.map((n) => (n.id === id ? { ...n, ...p } : n)),
    });
  return (
    <>
      <div className="panel-heading">
        <div>
          <h2>Notes</h2>
        </div>
        <button
          className="icon"
          aria-label="Add note"
          onClick={() => {
            const n = newNote();
            patch({ notes: [...story.notes, n] });
            setExpanded(n.id);
          }}
        >
          <Plus size={18} />
        </button>
      </div>
      <Toggle
        label="Creative notes"
        value={story.settings.creativeNotes}
        onChange={(creativeNotes) =>
          patch({ settings: { ...story.settings, creativeNotes } })
        }
      />
      <p className="help">
        Allow fictional details and fill blank notes even when absent from the
        manuscript. Locks and Review / Auto modes still apply.
      </p>

      {pending.length > 0 && (
        <section className="review">
          <h3>Review suggested changes</h3>
          {pending.map((u) => (
            <div key={u.noteId}>
              <strong>
                {story.notes.find((n) => n.id === u.noteId)?.title}
              </strong>
              <del>{u.oldContent}</del>
              <ins>{u.newContent}</ins>
              <button onClick={() => accept(u.noteId)}>Accept change</button>
            </div>
          ))}
          <div className="row">
            <button onClick={() => accept()}>Accept all</button>
            <button onClick={reject}>Reject all</button>
          </div>
        </section>
      )}
      {story.notes.map((n) => (
        <section className="note-card" key={n.id}>
          <div className="row">
            <input
              className="note-title"
              aria-label="Note title"
              value={n.title}
              onChange={(e) => change(n.id, { title: e.target.value })}
            />
            {n.locked && <LockKeyhole size={14} />}
            <button
              className="icon"
              aria-label="Delete note"
              onClick={() =>
                patch({ notes: story.notes.filter((x) => x.id !== n.id) })
              }
            >
              <Trash2 size={15} />
            </button>
          </div>
          <textarea
            aria-label={n.title + " content"}
            value={n.content}
            placeholder="Note content"
            onFocus={() => {
              change(n.id, {
                revisions: [
                  ...n.revisions,
                  {
                    id: uid(),
                    content: n.content,
                    at: Date.now(),
                    source: "Manual edit",
                  },
                ],
              });
            }}
            onChange={(e) => change(n.id, { content: e.target.value })}
          />
          <div className="note-footer">
            <span className="tag">
              {n.locked
                ? "Locked"
                : n.aiEditable
                  ? "AI editable"
                  : "Manual only"}
            </span>
            <button
              className="text-button"
              onClick={() => setExpanded(expanded === n.id ? null : n.id)}
            >
              {" "}
              {expanded === n.id ? "Less" : "Options"}{" "}
            </button>
          </div>
          {expanded === n.id && (
            <div className="note-options">
              <Toggle
                label="Enabled"
                value={n.enabled}
                onChange={(enabled) => change(n.id, { enabled })}
              />
              <Toggle
                label="Include in context"
                value={n.include}
                onChange={(include) => change(n.id, { include })}
              />
              <Toggle
                label="AI editable"
                value={n.aiEditable}
                onChange={(aiEditable) => change(n.id, { aiEditable })}
              />
              <Toggle
                label="Lock AI changes"
                value={n.locked}
                onChange={(locked) => change(n.id, { locked })}
              />
              <Position
                value={n.position}
                onChange={(position) => change(n.id, { position })}
              />
              <Field label="Activation keywords (optional)">
                <input
                  value={n.keywords}
                  onChange={(e) => change(n.id, { keywords: e.target.value })}
                />
              </Field>
              <Field label="After each continuation">
                <select
                  value={n.mode}
                  onChange={(e) =>
                    change(n.id, { mode: e.target.value as Note["mode"] })
                  }
                >
                  <option value="off">No automatic updates</option>
                  <option value="review">Review changes</option>
                  <option value="auto">Auto apply</option>
                </select>
              </Field>
              <details>
                <summary>
                  <History size={14} /> Revision history · {n.revisions.length}
                </summary>
                {[...n.revisions].reverse().map((r) => (
                  <div className="revision" key={r.id}>
                    <small>
                      {r.source} · {new Date(r.at).toLocaleString()}
                    </small>
                    <pre>{r.content}</pre>
                    <button
                      onClick={() =>
                        change(n.id, {
                          content: r.content,
                          revisions: [
                            ...n.revisions,
                            {
                              id: uid(),
                              content: n.content,
                              at: Date.now(),
                              source: "Before restore",
                            },
                          ],
                        })
                      }
                    >
                      Restore
                    </button>
                  </div>
                ))}
              </details>
            </div>
          )}
        </section>
      ))}
      {!story.notes.length && (
        <p className="empty">No notes. Use + to add one.</p>
      )}
    </>
  );
}
