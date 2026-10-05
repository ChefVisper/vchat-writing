import type { Story } from "../types";
import { Field, Toggle } from "./Fields";
import {
  addWriterBlockNotes,
  newWriterBlockConfig,
  wbGroups,
  wbModules,
  wbNoteTitles,
  wbTones,
  writerBlockConfig,
  WRITERS_BLOCK_SOURCE,
  type WBGroup,
  type WriterBlockConfig,
  type WritingPreset,
} from "../presets/writersBlock";
import license from "../presets/writers-block.LICENSE?raw";

export function WritingPresetSettings({
  story,
  patch,
}: {
  story: Story;
  patch: (value: Partial<Story>) => void;
}) {
  const c = writerBlockConfig(story);
  const update = (value: Partial<WriterBlockConfig>) =>
    patch({ writersBlock: { ...c, ...value } });
  const missingNotes = wbNoteTitles.some(
    (title) =>
      !story.notes.some(
        (n) => n.title.trim().toLowerCase() === title.toLowerCase(),
      ),
  );
  return (
    <section className="writing-preset" aria-label="Writing preset settings">
      <Field label="Writing preset">
        <select
          value={story.writingPreset ?? "default"}
          onChange={(e) =>
            patch({ writingPreset: e.target.value as WritingPreset })
          }
        >
          <option value="default">Default</option>
          <option value="writers-block">Writer's Block</option>
        </select>
      </Field>
      <p className="help">
        Saved with this story. Both presets keep their own prompt; connection
        and generation settings stay as configured.
      </p>
      {story.writingPreset === "writers-block" && (
        <>
          <p className="help">
            Co-writing adaptation of{" "}
            <a href={WRITERS_BLOCK_SOURCE} target="_blank" rel="noreferrer">
              Writer's Block Unlimited V2
            </a>{" "}
            by deiomo. Edit its template in Prompt. Scene directions take
            priority over style defaults.
          </p>
          {["Narrative", "Prose style", "Dialogue & characters"].map(
            (section) => (
              <details
                key={section}
                className="settings-details"
                open={section === "Narrative"}
              >
                <summary>{section}</summary>
                {Object.entries(wbGroups)
                  .filter(([, group]) => group.section === section)
                  .map(([key, group]) => (
                    <Field key={key} label={group.label}>
                      <select
                        value={c.choices[key as WBGroup]}
                        onChange={(e) =>
                          update({
                            choices: { ...c.choices, [key]: e.target.value },
                          })
                        }
                      >
                        {group.options.map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </Field>
                  ))}
                {section === "Narrative" && (
                  <details>
                    <summary>Narrator tones ({c.tones.length}/6)</summary>
                    <div className="preset-tones">
                      {wbTones.map((tone) => (
                        <label
                          key={tone.id}
                          className="preset-tone"
                          title={tone.rule}
                        >
                          <input
                            type="checkbox"
                            checked={c.tones.includes(tone.id)}
                            disabled={
                              c.tones.length >= 6 && !c.tones.includes(tone.id)
                            }
                            onChange={(e) =>
                              update({
                                tones: e.target.checked
                                  ? tone.id === "neutral"
                                    ? ["neutral"]
                                    : [
                                        ...c.tones.filter(
                                          (id) => id !== "neutral",
                                        ),
                                        tone.id,
                                      ]
                                  : c.tones.filter((id) => id !== tone.id),
                              })
                            }
                          />
                          <span>{tone.label}</span>
                        </label>
                      ))}
                    </div>
                    <p className="help">
                      Blend up to six. No selection adds no tonal filter. Use
                      Neutral on its own.
                    </p>
                  </details>
                )}
              </details>
            ),
          )}
          <details className="settings-details">
            <summary>Writing modules</summary>
            {wbModules.map((module) => (
              <Toggle
                key={module.id}
                label={module.label}
                value={c.modules.includes(module.id)}
                onChange={(enabled) =>
                  update({
                    modules: enabled
                      ? [...c.modules, module.id]
                      : c.modules.filter((id) => id !== module.id),
                  })
                }
              />
            ))}
            <Toggle
              label="Continuity check when Thinking is on"
              value={c.planning}
              onChange={(planning) => update({ planning })}
            />
            <p className="help">
              Uses Writing Thinking and its existing output allowance. No extra
              request or visible planning block.
            </p>
          </details>
          <Field label="Writer's Block extra direction">
            <textarea
              maxLength={5000}
              value={c.extraInstructions}
              placeholder="Additional style or scene guidance"
              onChange={(e) => update({ extraInstructions: e.target.value })}
            />
          </Field>
          <div className="preset-actions">
            <button onClick={() => update(newWriterBlockConfig())}>
              Reset Writer's Block options
            </button>
            <button
              disabled={!missingNotes}
              onClick={() => patch({ notes: addWriterBlockNotes(story.notes) })}
            >
              Add tracking notes
            </button>
          </div>
          <p className="help">
            Tracking adds empty Scene state, Plot threads and Character agendas
            notes in review mode. Existing notes are kept. Note/Continue fills
            them from prose; creative permission stays per note.
          </p>
          <details>
            <summary>Source & license</summary>
            <p className="help">
              Adapted modules and controls, rather than a full SillyTavern
              import.{" "}
              <a href={WRITERS_BLOCK_SOURCE} target="_blank" rel="noreferrer">
                Original preset
              </a>
            </p>
            <pre className="prompt">{license}</pre>
          </details>
        </>
      )}
    </section>
  );
}
