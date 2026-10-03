import { useState } from "react";
import type { Story } from "../types";
import { uid } from "../types";
import { BodyFigure } from "../body/BodyFigure";
import {
  bodyControls,
  newBody,
  defaultMeasurements,
  type BodyProfile,
} from "../body/model";
import { Field } from "./Fields";
const initial = newBody("default-body");
export function BodyPanel({
  story,
  patch,
}: {
  story: Story;
  patch: (p: Partial<Story>) => void;
}) {
  const profiles = story.bodies?.length ? story.bodies : [initial];
  const [selected, setSelected] = useState(profiles[0].id);
  const [view, setView] = useState<"front" | "back">("front");
  const profile = profiles.find((p) => p.id === selected) ?? profiles[0];
  const update = (p: Partial<BodyProfile>) =>
    patch({
      bodies: profiles.map((b) => (b.id === profile.id ? { ...b, ...p } : b)),
    });
  return (
    <div className="body-panel">
      <h2>Body</h2>
      <div className="body-profile-row">
        <Field label="Character">
          <select
            value={profile.id}
            onChange={(e) => setSelected(e.target.value)}
          >
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
        <button
          onClick={() => {
            const next = newBody(uid(), `Character ${profiles.length + 1}`);
            patch({ bodies: [...profiles, next] });
            setSelected(next.id);
          }}
        >
          Add
        </button>
      </div>
      <div className="body-view-controls" role="group" aria-label="Body view">
        {(["front", "back"] as const).map((v) => (
          <button key={v} aria-pressed={view === v} onClick={() => setView(v)}>
            {v === "front" ? "Front" : "Back"}
          </button>
        ))}
        <select
          aria-label="Body material"
          value={profile.material}
          onChange={(e) =>
            update({ material: e.target.value as BodyProfile["material"] })
          }
        >
          <option value="mesh">Navy mesh</option>
          <option value="skin">Skin</option>
        </select>
      </div>
      <div className="body-preview">
        <BodyFigure profile={profile} view={view} />
        <span className="body-scale">
          {profile.measurements.height} cm · {view}
        </span>
      </div>
      <Field label="Character name">
        <input
          value={profile.name}
          maxLength={100}
          onChange={(e) => update({ name: e.target.value })}
        />
      </Field>
      <div className="body-sliders">
        {bodyControls.map((c) => (
          <label key={c.key} className="body-slider">
            <span>
              {c.label}
              <output>
                {c.key === "height"
                  ? `${profile.measurements[c.key]} cm`
                  : `${Math.round(profile.measurements[c.key] * 100)}%`}
              </output>
            </span>
            <input
              type="range"
              aria-label={c.label}
              min={c.min}
              max={c.max}
              step={c.step}
              value={profile.measurements[c.key]}
              onChange={(e) =>
                update({
                  measurements: {
                    ...profile.measurements,
                    [c.key]: +e.target.value,
                  },
                })
              }
            />
          </label>
        ))}
      </div>
      <button
        onClick={() => update({ measurements: { ...defaultMeasurements } })}
      >
        Reset proportions
      </button>
      <p className="help">
        Stylized adult mannequin. Proportions are artistic controls, not
        anatomical measurements. Saved with this story; not sent to AI.
      </p>
    </div>
  );
}
