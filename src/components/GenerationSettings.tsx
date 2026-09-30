import { useEffect, useState } from "react";
import type { Story, Settings, Connection } from "../types";
import { Field, Toggle } from "./Fields";
import { providers } from "../providers";
import { storage } from "../storage/stories";
export function ConnectionPanel({
  story,
  patch,
  apiKey,
  setKey,
  onStatus,
}: {
  story: Story;
  patch: (p: Partial<Story>) => void;
  apiKey: string;
  setKey: (s: string) => void;
  onStatus: (s: string) => void;
}) {
  const [testing, setTesting] = useState(false);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [modelError, setModelError] = useState("");
  const c = story.connection;
  return (
    <>
      <h2>Connection</h2>

      <Field label="Provider">
        <select
          value={c.kind}
          onChange={(e) => {
            const kind = e.target.value as Connection["kind"];
            patch({
              connection: {
                kind,
                url:
                  kind === "kobold"
                    ? "http://localhost:5001"
                    : kind === "openai"
                      ? "http://localhost:1234/v1"
                      : kind === "openrouter"
                        ? "https://openrouter.ai/api/v1"
                        : "https://aihorde.net",
                model: "",
              },
            });
            setKey("");
            setModels([]);
            setModelError("");
            onStatus("Not connected");
          }}
        >
          <option value="kobold">KoboldCpp · local</option>
          <option value="openai">OpenAI-compatible completions</option>
          <option value="horde">AI Horde</option>
          <option value="openrouter">OpenRouter</option>
        </select>
      </Field>
      <Field
        label={
          c.kind === "openai" ? "API base URL (including /v1)" : "Server URL"
        }
      >
        <input
          type="url"
          value={c.url}
          onChange={(e) => {
            patch({ connection: { ...c, url: e.target.value } });
            onStatus("Not connected");
          }}
        />
      </Field>
      <Field label="Model">
        <input
          placeholder={
            c.kind === "kobold"
              ? "Detected on connection"
              : c.kind === "openrouter"
                ? "provider/model-id"
                : "Model identifier"
          }
          value={c.model}
          onChange={(e) =>
            patch({ connection: { ...c, model: e.target.value } })
          }
        />
      </Field>
      {c.kind !== "kobold" && (
        <Field label="API key · this session only">
          <input
            type="password"
            autoComplete="off"
            value={apiKey}
            onChange={(e) => setKey(e.target.value)}
          />
        </Field>
      )}
      <div className="model-fetch">
        <button
          disabled={fetchingModels}
          onClick={async () => {
            setFetchingModels(true);
            setModelError("");
            try {
              const found = await providers[c.kind].listModels(c, apiKey);
              setModels(found);
              if (found.length === 1)
                patch({ connection: { ...c, model: found[0] } });
            } catch (error) {
              setModelError(
                error instanceof Error
                  ? error.message
                  : "Could not fetch models.",
              );
            } finally {
              setFetchingModels(false);
            }
          }}
        >
          {fetchingModels ? "Fetching…" : "Fetch models"}
        </button>
        {models.length > 0 && <small>{models.length} available</small>}
      </div>
      {models.length > 0 && (
        <Field label="Fetched models">
          <select
            value={models.includes(c.model) ? c.model : ""}
            onChange={(e) =>
              patch({ connection: { ...c, model: e.target.value } })
            }
          >
            <option value="">Choose a model</option>
            {models.map((model) => (
              <option value={model} key={model}>
                {model}
              </option>
            ))}
          </select>
        </Field>
      )}
      {modelError && (
        <p className="error" role="alert">
          {modelError}
        </p>
      )}
      <button
        className="primary full"
        disabled={testing}
        onClick={async () => {
          setTesting(true);
          try {
            const result = await providers[c.kind].info(c, apiKey);
            patch({
              connection: { ...c, model: result.model },
            });
            onStatus(
              "Connected · " +
                result.model +
                (result.context
                  ? ` · model context ${result.context.toLocaleString()}`
                  : ""),
            );
          } catch (error) {
            onStatus(
              error instanceof Error ? error.message : "Connection failed.",
            );
          } finally {
            setTesting(false);
          }
        }}
      >
        {testing ? "Connecting…" : "Test connection"}
      </button>
      <p className="help">
        {c.kind === "openrouter"
          ? "Enter an OpenRouter API key and a model ID. Requests are sent to OpenRouter."
          : c.kind === "horde"
            ? "Horde uses a shared generation queue and returns completed text. Anonymous access is supported."
            : "Requests go directly from your browser to this endpoint. Your server must allow this app’s origin through CORS."}
      </p>
      <p className="help">
        API keys remain in memory and are excluded from saved projects.
      </p>
    </>
  );
}
export function GenerationSettings({
  story,
  patch,
}: {
  story: Story;
  patch: (p: Partial<Story>) => void;
}) {
  const [presets, setPresets] = useState<
    { name: string; settings: Settings }[]
  >([]);
  const [name, setName] = useState("");
  useEffect(() => {
    storage
      .pref("presets")
      .then((p) => setPresets(p || []))
      .catch(() => {});
  }, []);
  const s = story.settings;
  const limits: [keyof Settings, string, number, number][] = [
    ["inputTokens", "Input limit (tokens)", 1, 262144],
    ["maxTokens", "Output limit (tokens)", 1, 8192],
    ["context", "Max context (tokens)", 256, 262144],
  ];
  const native = ["kobold", "horde"].includes(story.connection.kind);
  const fields: [keyof Settings, string, number, number, number][] = [
    ["temperature", "Temperature", 0, 2, 0.05],
    ["top_p", "Top P", 0, 1, 0.01],
    ...(native
      ? ([
          ["top_k", "Top K", 0, 200, 1],
          ["min_p", "Min P", 0, 1, 0.01],
          ["typical", "Typical P", 0, 1, 0.01],
          ["rep_pen", "Repetition penalty", 1, 2, 0.05],
          ["rep_pen_range", "Repetition range", 0, 32768, 1],
        ] as [keyof Settings, string, number, number, number][])
      : []),
    ["seed", "Seed (-1 = random)", -1, 2147483647, 1],
  ];
  return (
    <>
      <h2>Settings</h2>
      <div className="token-limits">
        {limits.map(([key, label, min, max]) => (
          <Field key={key} label={label}>
            <input
              type="number"
              min={min}
              max={max}
              step="1"
              value={s[key] as number}
              onChange={(e) => {
                if (e.target.value)
                  patch({
                    settings: {
                      ...s,
                      [key]: Math.max(
                        min,
                        Math.min(max, Math.round(+e.target.value)),
                      ),
                    },
                  });
              }}
            />
          </Field>
        ))}
        <p className="help">
          Input is capped by max context minus output. Older story text is
          trimmed first.
        </p>
      </div>

      <Field label="Load preset">
        <select
          defaultValue=""
          onChange={(e) => {
            const p = presets.find((x) => x.name === e.target.value);
            if (p)
              patch({
                settings: {
                  ...s,
                  ...p.settings,
                  inputTokens: p.settings.inputTokens ?? s.inputTokens,
                },
              });
          }}
        >
          <option value="" disabled>
            Choose a preset
          </option>
          {presets.map((p) => (
            <option key={p.name}>{p.name}</option>
          ))}
        </select>
      </Field>
      <div className="row">
        <input
          aria-label="Preset name"
          placeholder="Preset name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button
          disabled={!name.trim()}
          onClick={() => {
            const next = [
              ...presets.filter((p) => p.name !== name),
              { name, settings: { ...s } },
            ];
            setPresets(next);
            void storage.setPref("presets", next);
            setName("");
          }}
        >
          Save
        </button>
      </div>
      <details open className="settings-details">
        <summary>Generation settings</summary>
        {fields.map(([key, label, min, max, step]) => (
          <Field key={key} label={label}>
            <input
              type="number"
              min={min}
              max={max}
              step={step}
              value={s[key] as number}
              onChange={(e) =>
                patch({
                  settings: {
                    ...s,
                    [key]: Math.min(max, Math.max(min, +e.target.value)),
                  },
                })
              }
            />
          </Field>
        ))}
        <Field label="Stop sequences (one per line)">
          <textarea
            value={s.stops}
            onChange={(e) =>
              patch({ settings: { ...s, stops: e.target.value } })
            }
          />
        </Field>
        {story.connection.kind !== "horde" && (
          <Toggle
            label="Stream as the model writes"
            value={s.streaming}
            onChange={(streaming) => patch({ settings: { ...s, streaming } })}
          />
        )}
      </details>
      <p className="help">
        Only parameters supported by this provider are sent. Token counts are
        estimates until checked with KoboldCpp.
      </p>
    </>
  );
}
