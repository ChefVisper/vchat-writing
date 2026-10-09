import { useEffect, useRef, useState } from "react";
import { noteConnection, type Story } from "../types";
import { ff54Config, ff54Modules } from "../presets/ff54";
import {
  appendStateRecord,
  currentState,
  makeStateRecord,
  stateFingerprint,
  type InternalStateRecord,
} from "../generation/internalStates";
import { download } from "../storage/transfer";
import { Field } from "./Fields";
import "./internal-states.css";

const labelFor = (id: string) =>
  ff54Modules.find((module) => module.id === id)?.label ?? id;

function StateHistoryRecord({
  record,
  current,
}: {
  record: InternalStateRecord;
  current: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <details
      className="internal-state-record"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        {new Date(record.at).toLocaleString()} ·{" "}
        {record.source === "manual"
          ? "Manual"
          : record.model || record.provider}
        {current ? " · Current" : ""}
      </summary>
      {open &&
        record.blocks.map((block) => (
          <div key={block.module}>
            <h3>{labelFor(block.module)}</h3>
            <pre>{block.content}</pre>
          </div>
        ))}
    </details>
  );
}

export function InternalStatesPanel({
  story,
  patch,
  busy,
  onUpdate,
  onStop,
}: {
  story: Story;
  patch: (value: Partial<Story>) => void;
  busy: boolean;
  onUpdate: () => void;
  onStop?: () => void;
}) {
  const config = ff54Config(story);
  const record = currentState(story);
  const stableBasis = useRef<{ text: string; fingerprint: string } | null>(
    null,
  );
  if (
    !stableBasis.current ||
    (!busy && stableBasis.current.text !== story.text)
  )
    stableBasis.current = {
      text: story.text,
      fingerprint: stateFingerprint(story.text),
    };
  const fingerprint = stableBasis.current.fingerprint;
  const changedWhileBusy = busy && stableBasis.current.text !== story.text;
  const [base, setBase] = useState<{
    storyId: string;
    record: InternalStateRecord | null;
    basis: string;
  }>({
    storyId: story.id,
    record: record ?? null,
    basis: record?.basis ?? fingerprint,
  });
  const [draft, setDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      record?.blocks.map((block) => [block.module, block.content]) ?? [],
    ),
  );
  const [dirty, setDirty] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [historyLimit, setHistoryLimit] = useState(10);
  const records = story.internalStates?.records ?? [];
  const sourceChanged =
    base.storyId !== story.id || base.record?.id !== record?.id;
  const stale = changedWhileBusy || base.basis !== fingerprint;
  const conflict = dirty && sourceChanged;

  const loadCurrent = () => {
    setBase({
      storyId: story.id,
      record: record ?? null,
      basis: record?.basis ?? fingerprint,
    });
    setDraft(
      Object.fromEntries(
        record?.blocks.map((block) => [block.module, block.content]) ?? [],
      ),
    );
    setDirty(false);
    setSaveError("");
  };

  useEffect(() => {
    if (base.storyId !== story.id) {
      loadCurrent();
      setHistoryLimit(10);
    } else if (!dirty) {
      loadCurrent();
    }
    // Keep a dirty draft intact when a generated snapshot arrives. Saving is
    // blocked until the user explicitly loads the new source snapshot.
  }, [story.id, record?.id, fingerprint, busy]);

  const modules = ff54Modules.filter(
    (module) => config.modules.includes(module.id) || module.id in draft,
  );
  const history = [...records].reverse().slice(0, historyLimit);
  const displayedRecord = base.record;
  return (
    <section
      className="internal-states-panel"
      aria-label="Internal States panel"
    >
      <h2>Internal States</h2>
      <p className="help">
        Fictional character and world continuity, separate from the model's
        reasoning. Options are under Settings → FF 5.4. Records never enter the
        manuscript.
      </p>
      {!config.enabled && (
        <p className="internal-states-notice">
          Internal States is off. Saved records remain available; enable it in
          Settings → FF 5.4 to generate states or use them in context.
        </p>
      )}
      {config.enabled && !config.modules.length && (
        <p className="internal-states-notice">
          Choose at least one module in FF 5.4 settings.
        </p>
      )}
      <div className="internal-states-actions">
        <button
          disabled={busy || dirty || !config.enabled || !config.modules.length}
          onClick={onUpdate}
        >
          Refresh states
        </button>
        {busy && onStop && <button onClick={onStop}>Stop states</button>}
        {displayedRecord && (
          <button
            onClick={() =>
              download(
                `${story.title.replace(/[\\/:*?"<>|]/g, "_") || "story"}-internal-states.json`,
                JSON.stringify(
                  {
                    format: "vchat-internal-states",
                    version: 1,
                    record: displayedRecord,
                  },
                  null,
                  2,
                ),
                "application/json",
              )
            }
          >
            Export current states
          </button>
        )}
      </div>
      {displayedRecord && (
        <div className="internal-states-meta">
          <span>{displayedRecord.model || displayedRecord.provider}</span>
          <span>
            {displayedRecord.source === "manual" ? "Manual edit" : "AI update"}
          </span>
          <time dateTime={new Date(displayedRecord.at).toISOString()}>
            {new Date(displayedRecord.at).toLocaleString()}
          </time>
        </div>
      )}
      {conflict && (
        <p className="internal-states-notice" role="alert">
          A newer state record arrived while you were editing. Your draft is
          still here. Load the latest states before saving.
        </p>
      )}
      {stale && (
        <p className="internal-states-notice" role="status">
          Stale states: the manuscript changed. This record is excluded from
          writing context. Refresh states before editing and saving it.
        </p>
      )}
      {!displayedRecord && !dirty && (
        <p className="help">
          No current snapshot. Refresh states to build one, or enter a manual
          state below. Other saved snapshots remain in history.
        </p>
      )}
      {modules.map((module) => {
        const savedBlock = displayedRecord?.blocks.find(
          (block) => block.module === module.id,
        );
        const needsRefresh =
          !busy &&
          config.modules.includes(module.id) &&
          savedBlock &&
          (savedBlock.basis ?? displayedRecord?.basis) !== fingerprint;
        return (
          <div className="internal-state-block" key={module.id}>
            <Field label={`${module.label} state`}>
              <textarea
                disabled={busy || stale || sourceChanged}
                maxLength={4000}
                value={draft[module.id] ?? ""}
                placeholder={module.description}
                onChange={(event) => {
                  setDraft({ ...draft, [module.id]: event.target.value });
                  setDirty(true);
                  setSaveError("");
                }}
              />
            </Field>
            {!config.modules.includes(module.id) && (
              <span className="internal-state-status">
                Module disabled · retained in this record
              </span>
            )}
            {needsRefresh && (
              <span className="internal-state-status">
                Needs refresh · this module was not updated for the current
                manuscript.
              </span>
            )}
          </div>
        );
      })}
      <div className="internal-states-actions">
        <button
          disabled={busy || !dirty || stale || sourceChanged}
          onClick={() => {
            if (busy || stale || sourceChanged || !dirty) return;
            try {
              const next = makeStateRecord(
                story,
                Object.entries(draft)
                  .filter(([, content]) => content.trim())
                  .map(([module, content]) => {
                    const original = displayedRecord?.blocks.find(
                      (block) => block.module === module,
                    );
                    const unchanged =
                      original && original.content.trim() === content.trim();
                    return {
                      module,
                      content: content.trim(),
                      ...(unchanged && displayedRecord
                        ? { basis: original.basis ?? displayedRecord.basis }
                        : {}),
                    };
                  }),
                noteConnection(story),
                "manual",
              );
              const last = story.segments.at(-1);
              patch({
                internalStates: appendStateRecord(story, next),
                ...(last?.after === story.text
                  ? {
                      segments: story.segments.map((segment, index) =>
                        index === story.segments.length - 1
                          ? { ...segment, statesAfter: next.id }
                          : segment,
                      ),
                    }
                  : {}),
              });
              setBase({ storyId: story.id, record: next, basis: next.basis });
              setDirty(false);
              setSaveError("");
            } catch (error) {
              setSaveError(
                error instanceof Error
                  ? error.message
                  : "State edits could not be saved.",
              );
            }
          }}
        >
          Save state edits
        </button>
        {dirty && (
          <button disabled={busy} onClick={loadCurrent}>
            {conflict ? "Load latest states" : "Discard state edits"}
          </button>
        )}
      </div>
      {dirty && !conflict && (
        <p className="help">
          Unsaved state edits. Save or discard them before refreshing.
        </p>
      )}
      {saveError && (
        <p className="error" role="alert">
          {saveError}
        </p>
      )}
      <details className="internal-states-history">
        <summary>State history ({records.length})</summary>
        <p className="help">
          Previous snapshots are kept separately from prose. Undo and redo
          restore the corresponding snapshot when available.
        </p>
        {history.map((item) => (
          <StateHistoryRecord
            key={item.id}
            record={item}
            current={item.id === record?.id}
          />
        ))}
        {historyLimit < records.length && (
          <button onClick={() => setHistoryLimit((limit) => limit + 10)}>
            Load more state history
          </button>
        )}
      </details>
    </section>
  );
}
