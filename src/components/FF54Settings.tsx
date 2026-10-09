import type { Story } from "../types";
import {
  ff54Config,
  ff54Modules,
  FF54_SOURCE,
  type FF54Config,
} from "../presets/ff54";
import { Field, Toggle } from "./Fields";
import "./internal-states.css";

export function FF54Settings({
  story,
  patch,
}: {
  story: Story;
  patch: (value: Partial<Story>) => void;
}) {
  const config = ff54Config(story);
  const update = (value: Partial<FF54Config>) =>
    patch({ ff54: { ...config, ...value } });
  const limits: [keyof FF54Config, string, number, number][] = [
    ["maxTokens", "Internal States Output (tokens)", 64, 131072],
    [
      "thinkingMaxTokens",
      "Internal States Thinking Output (tokens)",
      0,
      131072,
    ],
    ["contextTokens", "Internal States Context allowance (tokens)", 0, 32000],
  ];
  return (
    <details className="settings-details ff54-settings">
      <summary>FF 5.4</summary>
      <section aria-label="FF 5.4 settings">
        <Toggle
          label="Enable Internal States"
          value={config.enabled}
          onChange={(enabled) => update({ enabled })}
        />
        <p className="help">
          Track fictional character plans and world continuity in the States
          panel. This works with Default and Writer's Block. Switching it off
          keeps your options and saved records.
        </p>
        <p className="help">
          Adapted from{" "}
          <a href={FF54_SOURCE} target="_blank" rel="noreferrer">
            Freaky Frankenstein 5.4
          </a>{" "}
          module concepts for co-writing.
        </p>
        <Toggle
          label="Update states after writing"
          value={config.autoUpdate}
          onChange={(autoUpdate) => update({ autoUpdate })}
        />
        <Toggle
          label="Include current states in writing context"
          value={config.includeContext}
          onChange={(includeContext) => update({ includeContext })}
        />
        <Toggle
          label="Allow creative character plans"
          value={config.creative}
          onChange={(creative) => update({ creative })}
        />
        <p className="help">
          Creative mode may propose motives, plans and unresolved possibilities.
          It must distinguish them from events established in the manuscript.
          Off-screen plans do not become facts just because another passage was
          generated.
        </p>
        {["Characters", "Plot & setting", "Game & simulation"].map((group) => (
          <details className="ff54-group" key={group}>
            <summary>{group}</summary>
            {ff54Modules
              .filter((module) => module.group === group)
              .map((module) => (
                <div className="ff54-module-setting" key={module.id}>
                  <Toggle
                    label={module.label}
                    value={config.modules.includes(module.id)}
                    onChange={(enabled) =>
                      update({
                        modules: enabled
                          ? [...config.modules, module.id]
                          : config.modules.filter((id) => id !== module.id),
                      })
                    }
                  />
                  <p className="help">{module.description}</p>
                </div>
              ))}
          </details>
        ))}
        <details className="ff54-group">
          <summary>State generation & context</summary>
          {limits.map(([key, label, min, max]) => (
            <Field key={key} label={label}>
              <input
                type="number"
                min={min}
                max={max}
                step="1"
                value={config[key] as number}
                onChange={(event) => {
                  if (event.target.value)
                    update({
                      [key]: Math.max(
                        min,
                        Math.min(max, Math.round(+event.target.value)),
                      ),
                    });
                }}
              />
            </Field>
          ))}
          <Toggle
            label="Internal States Thinking"
            value={config.thinking}
            onChange={(thinking) => update({ thinking })}
          />
          <Field label="Internal States Thinking level">
            <select
              value={config.thinkingLevel}
              onChange={(event) =>
                update({
                  thinkingLevel: event.target
                    .value as FF54Config["thinkingLevel"],
                })
              }
            >
              {["minimal", "low", "medium", "high"].map((level) => (
                <option key={level} value={level}>
                  {level}
                </option>
              ))}
            </select>
          </Field>
          <p className="help">
            States use the Notes API and model, with their own output and
            thinking allowance. Auto-update makes an extra request after new
            prose; Refresh states runs it on its own. The context allowance
            limits states included in writing prompts. Stale records and
            disabled modules are excluded.
          </p>
          <Field label="FF 5.4 extra direction">
            <textarea
              maxLength={5000}
              value={config.extraInstructions}
              placeholder="How to track characters and the world"
              onChange={(event) =>
                update({ extraInstructions: event.target.value })
              }
            />
          </Field>
        </details>
      </section>
    </details>
  );
}
