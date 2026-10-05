import { useEffect, useState } from "react";
import {
  noteConnection,
  type Story,
  type Settings,
  type Connection,
} from "../types";
import { credentialId } from "../storage/credentials";
import { Field, Toggle } from "./Fields";
import { providers } from "../providers";
import { storage } from "../storage/stories";
import { WritingPresetSettings } from "./WritingPresetSettings";
export function ConnectionPanel({
  story,
  patch,
  apiKey,
  setKey,
  onStatus,
  modelOnly = false,
}: {
  story: Story;
  patch: (p: Partial<Story>) => void;
  apiKey: string;
  setKey: (s: string) => void;
  onStatus: (s: string) => void;
  modelOnly?: boolean;
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
          disabled={modelOnly}
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
                        : kind === "nanogpt"
                          ? "https://api.nano-gpt.com/api/v1"
                          : "https://aihorde.net",
                model: "",
              },
            });
            setModels([]);
            setModelError("");
            onStatus("Not connected");
          }}
        >
          <option value="kobold">KoboldCpp · local</option>
          <option value="openai">OpenAI-compatible completions</option>
          <option value="horde">AI Horde</option>
          <option value="openrouter">OpenRouter</option>
          <option value="nanogpt">NanoGPT</option>
        </select>
      </Field>
      <Field
        label={
          c.kind === "openai" ? "API base URL (including /v1)" : "Server URL"
        }
      >
        <input
          type="url"
          disabled={modelOnly}
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
      {c.kind !== "kobold" && !modelOnly && (
        <Field label="API key · saved on this device">
          <input
            type="password"
            autoComplete="off"
            value={apiKey}
            onChange={(e) => setKey(e.target.value)}
          />
        </Field>
      )}
      {!modelOnly && apiKey && (
        <button onClick={() => setKey("")}>Forget API key</button>
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
        {c.kind === "nanogpt"
          ? "NanoGPT uses chat completions with separate reasoning fields. Use Fetch models to select an exact model ID."
          : c.kind === "openrouter"
            ? "Enter an OpenRouter API key and a model ID. Requests are sent to OpenRouter."
            : c.kind === "horde"
              ? "Horde uses a shared generation queue and returns completed text. Anonymous access is supported."
              : "Requests go directly from your browser to this endpoint. Your server must allow this app’s origin through CORS."}
      </p>
      <p className="help">
        Keys are saved in this browser's local storage, separately from stories.
        They are excluded from project exports and source files. Clearing
        browser data removes them.
      </p>
    </>
  );
}
export function ConnectionsPanel({
  story,
  patch,
  keys,
  setCredential,
  onStatus,
}: {
  story: Story;
  patch: (p: Partial<Story>) => void;
  keys: Record<string, string>;
  setCredential: (id: string, value: string) => void;
  onStatus: (value: string) => void;
}) {
  const [target, setTarget] = useState("writing");
  const isNote = target === "notes";
  const mode = story.noteConnectionMode ?? "same";
  const c = isNote ? noteConnection(story) : story.connection;
  const id = credentialId(
    c,
    isNote && mode === "separate" ? "notes" : "writing",
  );
  return (
    <>
      <div className="row">
        <button
          className={isNote ? "" : "primary"}
          onClick={() => setTarget("writing")}
        >
          Writing connection
        </button>
        <button
          className={isNote ? "primary" : ""}
          onClick={() => setTarget("notes")}
        >
          Notes connection
        </button>
      </div>
      {isNote && (
        <Field label="Note connection mode">
          <select
            value={mode}
            onChange={(e) =>
              patch({
                noteConnectionMode: e.target
                  .value as Story["noteConnectionMode"],
                noteConnection: story.noteConnection ?? { ...story.connection },
              })
            }
          >
            <option value="same">Same API and model as writing</option>
            <option value="model">Same API and key, different model</option>
            <option value="separate">Separate API, key and model</option>
          </select>
        </Field>
      )}
      {isNote && mode === "same" ? (
        <p className="help">
          Notes use the writing connection and its saved key.
        </p>
      ) : (
        <ConnectionPanel
          key={`${target}:${c.kind}:${mode}`}
          story={{ ...story, connection: c }}
          patch={(p) =>
            p.connection &&
            patch(
              isNote
                ? { noteConnection: p.connection }
                : { connection: p.connection },
            )
          }
          apiKey={keys[id] || ""}
          setKey={(value) => setCredential(id, value)}
          onStatus={onStatus}
          modelOnly={isNote && mode === "model"}
        />
      )}
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
    ["maxTokens", "Writing Output (tokens)", 1, 131072],
    ["noteMaxTokens", "Note Output (tokens)", 1, 131072],
    ["thinkingMaxTokens", "Thinking Output (tokens)", 0, 131072],
    ["noteThinkingMaxTokens", "Note Thinking Output (tokens)", 0, 131072],
    ["context", "Max context (tokens)", 256, 262144],
  ];
  const native = ["kobold", "horde"].includes(story.connection.kind);
  const samplers = true;
  const fields: [keyof Settings, string, number, number, number][] = [
    ["temperature", "Temperature", 0, 2, 0.05],
    ["top_p", "Top P", 0, 1, 0.01],
    ...(samplers
      ? ([
          ["top_k", "Top K", 0, 200, 1],
          ["min_p", "Min P", 0, 1, 0.01],
          ["rep_pen", "Repetition penalty", 1, 2, 0.05],
        ] as [keyof Settings, string, number, number, number][])
      : []),
    ...(native
      ? ([
          ["typical", "Typical P", 0, 1, 0.01],
          ["rep_pen_range", "Repetition range", 0, 32768, 1],
        ] as [keyof Settings, string, number, number, number][])
      : []),
    ["seed", "Seed (-1 = random)", -1, 2147483647, 1],
  ];
  return (
    <>
      <h2>Settings</h2>
      <WritingPresetSettings story={story} patch={patch} />
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
          Max Context includes input and output. Each request reserves its own
          text and thinking budgets separately; older prose is trimmed first.
          API output is their sum, even with Thinking off, to allow for models
          that still think. Visible text and stored thoughts have independent
          estimated token caps. Exact reasoning limits depend on model/API
          support. Note JSON is not locally truncated; its output limit is
          enforced by the API and validated before applying updates.
        </p>
      </div>

      <h3>Generation presets</h3>
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
      <h3>Thinking</h3>
      <Field label="Thinking prefix">
        <input
          maxLength={128}
          value={s.thinkingPrefix}
          onChange={(e) =>
            patch({ settings: { ...s, thinkingPrefix: e.target.value } })
          }
        />
      </Field>
      <Field label="Thinking suffix">
        <input
          maxLength={128}
          value={s.thinkingSuffix}
          onChange={(e) =>
            patch({ settings: { ...s, thinkingSuffix: e.target.value } })
          }
        />
      </Field>
      <Toggle
        label="Server prefills thinking prefix"
        value={s.thinkingPrefill}
        onChange={(thinkingPrefill) =>
          patch({ settings: { ...s, thinkingPrefill } })
        }
      />
      <p className="help">
        Default tags are &lt;think&gt; and &lt;/think&gt;. Use custom nonempty,
        distinct tags for another model. Enable prefill only when your
        completion server already supplies the opening tag and returns thoughts
        before the closing tag.
      </p>
      {([false, true] as const).map((isNote) => {
        const enabled = isNote ? "noteThinking" : "thinking";
        const level = isNote ? "noteThinkingLevel" : "thinkingLevel";
        return (
          <div key={enabled}>
            <Toggle
              label={isNote ? "Note Thinking" : "Writing Thinking"}
              value={s[enabled]}
              onChange={(value) =>
                patch({ settings: { ...s, [enabled]: value } })
              }
            />
            {s[enabled] && (
              <Field
                label={
                  isNote ? "Note Thinking level" : "Writing Thinking level"
                }
              >
                <select
                  value={s[level]}
                  onChange={(e) =>
                    patch({ settings: { ...s, [level]: e.target.value } })
                  }
                >
                  {["minimal", "low", "medium", "high"].map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </Field>
            )}
          </div>
        );
      })}
      <p className="help">
        NanoGPT and OpenRouter receive reasoning controls. Some models always
        think or never expose their thoughts. OpenRouter uses a token budget
        where advertised; NanoGPT exposes effort control. Exposed/inline
        thoughts are separated regardless of this switch. Native providers use
        server reasoning settings. Generic OpenAI-compatible servers must
        support the sampling extensions; unsupported fields may be rejected.
      </p>
      <details open className="settings-details">
        <summary>Generation settings</summary>
        <Toggle
          label="Trim incomplete sentences"
          value={s.trimIncomplete}
          onChange={(trimIncomplete) =>
            patch({ settings: { ...s, trimIncomplete } })
          }
        />
        <p className="help">
          Removes an unfinished final sentence from completed AI output, never
          from your own text. Manual Stop keeps partial output. Sentence
          detection is approximate; ellipsis endings are treated as incomplete.
        </p>
        {story.connection.kind === "openrouter" && (
          <p className="help">
            Min P, Top K and repetition penalty depend on model support. After
            Fetch models, unsupported parameters are omitted. KoboldCpp's
            repetition range is not an OpenRouter parameter.
          </p>
        )}
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
