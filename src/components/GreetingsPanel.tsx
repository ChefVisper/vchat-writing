import { useState } from "react";
import { type Story, type Greeting } from "../types";
import { newGreeting, greetingStory } from "../generation/greetings";
import { Field } from "./Fields";

export function GreetingsPanel({
  story,
  patch,
  onStart,
  busy,
}: {
  story: Story;
  patch: (p: Partial<Story>) => void;
  onStart: (s: Story) => void;
  busy: boolean;
}) {
  const [selected, setSelected] = useState("");
  const greetings = story.greetings || [];
  const current = greetings.find((g) => g.id === selected) || greetings[0];
  const update = (p: Partial<Greeting>) =>
    current &&
    patch({
      greetings: greetings.map((g) =>
        g.id === current.id ? { ...g, ...p } : g,
      ),
    });
  const add = (text = "") => {
    let number = 1;
    while (greetings.some((g) => g.title === `Greeting ${number}`)) number++;
    const g = newGreeting(text, `Greeting ${number}`);
    patch({ greetings: [...greetings, g] });
    setSelected(g.id);
  };
  return (
    <>
      <h2>Greetings</h2>
      <p className="help">
        Alternate openings with the same Memory, notes, lore and settings.
        Starting one creates a new story; this manuscript stays saved. Context
        is copied as it is now.
      </p>
      <fieldset disabled={busy} className="panel-fieldset">
        <div className="row">
          <button onClick={() => add()} disabled={greetings.length >= 100}>
            Add greeting
          </button>
          <button
            onClick={() => add(story.text)}
            disabled={
              !story.text.trim() ||
              story.text.length > 100000 ||
              greetings.length >= 100
            }
          >
            Save current text
          </button>
        </div>
        {current && (
          <>
            <Field label="Choose greeting">
              <select
                value={current.id}
                onChange={(e) => setSelected(e.target.value)}
              >
                {greetings.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.title || "Untitled greeting"}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Greeting title">
              <input
                maxLength={150}
                value={current.title}
                onChange={(e) => update({ title: e.target.value })}
              />
            </Field>
            <Field label="Greeting text">
              <textarea
                rows={12}
                maxLength={100000}
                value={current.text}
                onChange={(e) => update({ text: e.target.value })}
              />
            </Field>
            <div className="row">
              <button
                className="primary"
                disabled={!current.text.trim()}
                onClick={() => onStart(greetingStory(story, current))}
              >
                Start with this greeting
              </button>
              <button
                onClick={() =>
                  patch({
                    greetings: greetings.filter((g) => g.id !== current.id),
                  })
                }
              >
                Delete greeting
              </button>
            </div>
          </>
        )}
      </fieldset>
    </>
  );
}
