import { useEffect, useRef, useState } from "react";
import { type Story, type Lorebook } from "../types";
import { LoreEntriesEditor } from "./ContextPanel";
import { Field, Toggle } from "./Fields";
import { newLorebook } from "../lore/library";
import {
  fetchLorebook,
  MAX_LOREBOOK_BYTES,
  parseLorebookJSON,
} from "../lore/import";
import { download } from "../storage/transfer";

export function LorebookPanel({
  story,
  books,
  patch,
  setBooks,
}: {
  story: Story;
  books: Lorebook[];
  patch: (p: Partial<Story>) => void;
  setBooks: (b: Lorebook[]) => void;
}) {
  const [selected, select] = useState("");
  const [link, setLink] = useState("");
  const [pending, setPending] = useState<Lorebook[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const book = books.find((b) => b.id === selected) || books[0];
  const active = story.activeLorebooks || [];
  const toggle = (id: string, enabled: boolean) =>
    patch({
      activeLorebooks: enabled
        ? [...new Set([...active, id])]
        : active.filter((x) => x !== id),
    });
  const update = (value: Partial<Lorebook>) => {
    if (book)
      setBooks(
        books.map((b) =>
          b.id === book.id ? { ...b, ...value, modified: Date.now() } : b,
        ),
      );
  };
  const add = (added: Lorebook[]) => {
    setBooks([...books, ...added]);
    patch({
      activeLorebooks: [...new Set([...active, ...added.map((b) => b.id)])],
    });
    select(added[0]?.id || "");
  };
  return (
    <>
      <p className="help">
        Shared on this device. Edits apply wherever a lorebook is used; active
        selections are saved separately for each story.
      </p>
      <div className="row">
        <button onClick={() => add([newLorebook()])}>New lorebook</button>
        <button
          disabled={!books.length}
          onClick={() =>
            download(
              "lorebook-library.json",
              JSON.stringify({
                format: "vchat-lorebook-library",
                version: 1,
                books,
              }),
              "application/json",
            )
          }
        >
          Export library
        </button>
      </div>
      <details className="context-card">
        <summary>Import lorebook</summary>
        <Field label="Lorebook JSON">
          <input
            type="file"
            accept=".json,application/json"
            disabled={busy}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              setError("");
              setPending([]);
              try {
                if (file.size > MAX_LOREBOOK_BYTES)
                  throw new Error("Choose lorebook JSON smaller than 8 MB.");
                setPending(parseLorebookJSON(await file.text(), file.name));
              } catch (err) {
                setError(
                  err instanceof Error
                    ? err.message
                    : "Lorebook import failed.",
                );
              }
            }}
          />
        </Field>
        <Field label="Lorebook link">
          <input
            value={link}
            onChange={(e) => setLink(e.target.value)}
            disabled={busy}
            placeholder="chub.ai/lorebooks/author/name or direct .json URL"
          />
        </Field>
        <button
          disabled={busy || !link.trim()}
          onClick={async () => {
            const c = new AbortController();
            controller.current = c;
            setBusy(true);
            setError("");
            setPending([]);
            const timer = setTimeout(() => c.abort(), 30000);
            try {
              setPending([await fetchLorebook(link, c.signal)]);
            } catch (err) {
              setError(
                c.signal.aborted
                  ? "Download cancelled or timed out. Try the exported JSON file."
                  : err instanceof Error
                    ? err.message
                    : "Lorebook download failed.",
              );
            } finally {
              clearTimeout(timer);
              controller.current = null;
              setBusy(false);
            }
          }}
        >
          {busy ? "Fetching…" : "Fetch lorebook"}
        </button>
        {busy && (
          <button onClick={() => controller.current?.abort()}>
            Cancel download
          </button>
        )}
        <p className="help">
          Supports Chub / CharacterHub links, direct JSON URLs, SillyTavern
          World Info and character-book JSON. Other websites need a downloadable
          JSON file.
        </p>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {!!pending.length && (
          <section
            className="lore-import-preview"
            aria-label="Lorebook import preview"
          >
            {pending.map((b) => (
              <div key={b.id}>
                <strong>{b.title}</strong>
                <small> · {b.entries.length} entries</small>
                {b.warnings?.map((w) => (
                  <p className="help" key={w}>
                    {w}
                  </p>
                ))}
              </div>
            ))}
            <button
              onClick={() => {
                add(pending);
                setPending([]);
              }}
            >
              Add to library
            </button>
            <button onClick={() => setPending([])}>Discard import</button>
          </section>
        )}
      </details>
      {!!books.length && (
        <>
          <Field label="Lorebook to edit">
            <select value={book.id} onChange={(e) => select(e.target.value)}>
              {books.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.title}
                </option>
              ))}
            </select>
          </Field>
          <Toggle
            label="Active for this story"
            value={active.includes(book.id)}
            onChange={(value) => toggle(book.id, value)}
          />
          <details>
            <summary>
              Active lorebooks (
              {books.filter((b) => active.includes(b.id)).length})
            </summary>
            {books.map((b) => (
              <Toggle
                key={b.id}
                label={b.title}
                value={active.includes(b.id)}
                onChange={(value) => toggle(b.id, value)}
              />
            ))}
          </details>
          <Field label="Lorebook name">
            <input
              maxLength={150}
              value={book.title}
              onChange={(e) => update({ title: e.target.value })}
            />
          </Field>
          {book.source && <p className="help">Source: {book.source}</p>}
          {!!book.warnings?.length && (
            <details>
              <summary>Import notes</summary>
              {book.warnings.map((w) => (
                <p className="help" key={w}>
                  {w}
                </p>
              ))}
            </details>
          )}
          <div className="row">
            <button
              onClick={() =>
                download(
                  `${book.title || "lorebook"}.json`,
                  JSON.stringify({
                    format: "vchat-lorebook",
                    version: 1,
                    ...book,
                  }),
                  "application/json",
                )
              }
            >
              Export lorebook
            </button>
            <button
              onClick={() => {
                if (
                  confirm(
                    `Delete “${book.title}” from the shared library? It will stop being used by every story. Export it first if you need a backup.`,
                  )
                ) {
                  setBooks(books.filter((b) => b.id !== book.id));
                  select("");
                  toggle(book.id, false);
                }
              }}
            >
              Delete lorebook
            </button>
          </div>
        </>
      )}
      <LoreEntriesEditor
        key={book?.id || "empty"}
        story={{ ...story, lore: book?.entries || [] }}
        patch={(p) => {
          if (p.lore) {
            if (book) update({ entries: p.lore });
            else add([newLorebook("Untitled lorebook", p.lore)]);
          } else patch(p);
        }}
      />
    </>
  );
}
