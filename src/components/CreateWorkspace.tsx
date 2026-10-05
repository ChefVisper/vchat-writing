import { useEffect, useRef, useState } from "react";
import { defaults, type Story, type Settings, type Connection } from "../types";
import { storage } from "../storage/stories";
import { credentialId } from "../storage/credentials";
import { ConnectionPanel } from "./GenerationSettings";
import { Field, Toggle } from "./Fields";
import { providers } from "../providers";
import {
  DEFAULT_CREATE_PROMPT,
  creationPrompt,
  parseCreation,
  creationStory,
  type CreationResult,
} from "../generation/creation";
import { prepareImage } from "../generation/upload";
import {
  fetchChubCharacter,
  mapCharacterCard,
  type CharacterImport,
} from "../generation/characterImport";
const PREF = "create-workspace-v1";
export function CreateWorkspace({
  source,
  keys,
  setCredential,
  onBusy,
  onCreate,
  onClose,
}: {
  source: Story;
  keys: Record<string, string>;
  setCredential: (id: string, key: string) => void;
  onBusy: (busy: boolean) => void;
  onCreate: (story: Story) => void;
  onClose: () => void;
}) {
  const [settings, setSettings] = useState<Settings>({
    ...defaults,
    maxTokens: 2048,
    thinkingMaxTokens: 2048,
    streaming: false,
  });
  const [connection, setConnection] = useState<Connection>({
    ...source.connection,
  });
  const [brief, setBrief] = useState("");
  const [characterLink, setCharacterLink] = useState("");
  const [imported, setImported] = useState<Omit<
    CharacterImport,
    "result"
  > | null>(null);
  const [template, setTemplate] = useState(DEFAULT_CREATE_PROMPT);
  const [image, setImage] = useState("");
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<CreationResult | null>(null);
  const [thoughts, setThoughts] = useState("");
  const [resultThoughts, setResultThoughts] = useState("");
  const [resultConnection, setResultConnection] = useState(connection);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const controller = useRef<AbortController | null>(null);
  const activeRequest = useRef<{ connection: Connection; key: string } | null>(
    null,
  );
  const nativeAbort = useRef<Promise<unknown>>(Promise.resolve());
  const uploadId = useRef(0);
  const draft = useRef<any>(null);
  const generateAction = useRef<() => Promise<void>>(async () => {});
  useEffect(() => {
    let active = true;
    storage
      .pref(PREF)
      .then((d) => {
        if (!active) return;
        if (d) {
          if (typeof d.brief === "string") setBrief(d.brief);
          if (typeof d.template === "string") setTemplate(d.template);
          if (typeof d.characterLink === "string")
            setCharacterLink(d.characterLink);
          if (
            d.connection &&
            ["kobold", "openai", "horde", "openrouter", "nanogpt"].includes(
              d.connection.kind,
            )
          )
            setConnection({
              kind: d.connection.kind,
              url: d.connection.url,
              model: d.connection.model,
            });
          if (d.settings)
            setSettings((s) => ({ ...s, ...d.settings, streaming: false }));
          if (
            d.result &&
            ["title", "memory", "startingText"].every(
              (k) =>
                typeof d.result[k] === "string" && d.result[k].length <= 100000,
            )
          ) {
            try {
              setResult({
                title: d.result.title,
                memory: d.result.memory,
                startingText: d.result.startingText,
                alternateGreetings:
                  Array.isArray(d.result.alternateGreetings) &&
                  d.result.alternateGreetings.length <= 99 &&
                  d.result.alternateGreetings.every(
                    (g: unknown) => typeof g === "string" && g.length <= 100000,
                  )
                    ? d.result.alternateGreetings
                    : [],
              });
              if (d.imported) setImported(d.imported);
              setResultThoughts(d.resultThoughts || "");
              setResultConnection(d.resultConnection || source.connection);
            } catch {
              /* Ignore incomplete saved preview. */
            }
          }
        }
        setReady(true);
      })
      .catch(() => {
        if (active) setReady(true);
      });
    return () => {
      active = false;
      stop();
      uploadId.current++;
      if (draft.current)
        void storage.setPref(PREF, draft.current).catch(() => {});
    };
  }, []);
  useEffect(() => {
    if (!ready) return;
    draft.current = {
      brief,
      characterLink,
      imported,
      template,
      settings,
      connection,
      result,
      resultThoughts,
      resultConnection,
    };
    const timer = setTimeout(
      () =>
        storage
          .setPref(PREF, draft.current)
          .catch(() =>
            setError("Create draft could not be saved on this device."),
          ),
      350,
    );
    return () => clearTimeout(timer);
  }, [
    brief,
    characterLink,
    imported,
    template,
    settings,
    connection,
    result,
    resultThoughts,
    resultConnection,
    ready,
  ]);
  useEffect(() => {
    const flush = () => {
      if (draft.current)
        void storage.setPref(PREF, draft.current).catch(() => {});
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") stop();
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (draft.current)
          void storage
            .setPref(PREF, draft.current)
            .then(() => setStatus("Create draft saved on this device."))
            .catch(() => setError("Create draft could not be saved."));
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        void generateAction.current();
      }
    };
    window.addEventListener("keydown", key);
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", flush);
    return () => {
      window.removeEventListener("keydown", key);
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", flush);
    };
  }, []);
  const key = keys[credentialId(connection)] || "";
  function stop() {
    controller.current?.abort();
    const active = activeRequest.current;
    if (active)
      nativeAbort.current =
        providers[active.connection.kind]
          .abort?.(active.connection, active.key)
          .catch(() => {}) ?? Promise.resolve();
  }
  async function generate() {
    if (busy || uploading || !ready || controller.current) return;
    setError("");
    setStatus("");
    let reasoning = "";
    setThoughts("");
    const c = new AbortController();
    nativeAbort.current = Promise.resolve();
    activeRequest.current = { connection: { ...connection }, key };
    controller.current = c;
    setBusy(true);
    onBusy(true);
    try {
      const prompt = creationPrompt(
        brief,
        template,
        settings,
        connection,
        !!image,
      );
      const text = await providers[connection.kind].generate({
        prompt,
        settings: { ...settings, streaming: false, stops: "" },
        connection,
        key,
        purpose: "create",
        images: image ? [image] : undefined,
        signal: c.signal,
        onToken: () => {},
        onReasoning: (t) => {
          reasoning += t;
        },
      });
      c.signal.throwIfAborted();
      const next = parseCreation(text);
      setResult(next);
      setImported(null);
      setResultThoughts(reasoning);
      setResultConnection({ ...connection });
    } catch (e) {
      if (!c.signal.aborted)
        setError(e instanceof Error ? e.message : "Creation failed.");
      else setStatus("Stopped. Previous result kept.");
    } finally {
      await nativeAbort.current;
      activeRequest.current = null;
      setThoughts(reasoning);
      controller.current = null;
      setBusy(false);
      onBusy(false);
    }
  }
  generateAction.current = generate;
  async function importCharacter(file?: File) {
    if (busy || uploading || !ready || controller.current) return;
    const c = new AbortController();
    controller.current = c;
    setBusy(true);
    onBusy(true);
    setError("");
    setStatus("");
    const timer = setTimeout(
      () =>
        c.abort(
          new Error("Character import timed out. Try again or import JSON."),
        ),
      20000,
    );
    try {
      if (file && file.size > 4 * 1024 * 1024)
        throw new Error("Choose a character JSON smaller than 4 MB.");
      const data = file
        ? mapCharacterCard(JSON.parse(await file.text()))
        : await fetchChubCharacter(characterLink, c.signal);
      c.signal.throwIfAborted();
      const { result: preview, ...context } = data;
      setResult(preview);
      setImported(context);
      setResultThoughts("");
      setThoughts("");
      setImage("");
      setStatus(
        "Character imported. Review the Memory, opening, instructions and greetings before creating a story.",
      );
    } catch (e) {
      setError(
        c.signal.aborted
          ? c.signal.reason instanceof Error &&
            c.signal.reason.name !== "AbortError"
            ? c.signal.reason.message
            : "Import stopped. Previous result kept."
          : e instanceof Error
            ? e.message
            : "Character import failed.",
      );
    } finally {
      clearTimeout(timer);
      controller.current = null;
      setBusy(false);
      onBusy(false);
    }
  }
  return (
    <main className="create-workspace">
      <div className="create-heading">
        <h2>Create</h2>
        <button disabled={busy || uploading} onClick={onClose}>
          Back to writing
        </button>
      </div>
      <div className="create-grid">
        <section className="create-input">
          <fieldset
            disabled={!ready || busy || uploading}
            className="panel-fieldset"
          >
            <details>
              <summary>Import character</summary>
              <Field label="Character link">
                <input
                  type="text"
                  maxLength={1000}
                  placeholder="chub.ai/characters/author/name"
                  value={characterLink}
                  onChange={(e) => setCharacterLink(e.target.value)}
                />
              </Field>
              <button
                disabled={!characterLink.trim()}
                onClick={() => void importCharacter()}
              >
                Import from link
              </button>
              <Field label="Character card JSON">
                <input
                  type="file"
                  accept=".json,application/json"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (file) void importCharacter(file);
                  }}
                />
              </Field>
              <p className="help">
                Public Chub / CharacterHub links and Tavern character JSON
                cards. No AI call is needed. Imported instructions go to
                Author's note; model settings stay yours.
              </p>
            </details>
            <Field label="Character / scenario brief">
              <textarea
                rows={7}
                maxLength={16000}
                value={brief}
                onChange={(e) => setBrief(e.target.value)}
                placeholder="Describe the character, setting, relationship and opening situation. Include the desired language and tone."
              />
            </Field>
            <Field label="Reference image">
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (!file) return;
                  const id = ++uploadId.current;
                  setUploading(true);
                  onBusy(true);
                  setError("");
                  try {
                    const data = await prepareImage(file);
                    if (uploadId.current === id) setImage(data);
                  } catch (e) {
                    if (uploadId.current === id)
                      setError(
                        e instanceof Error
                          ? e.message
                          : "Could not load image.",
                      );
                  } finally {
                    if (uploadId.current === id) {
                      setUploading(false);
                      onBusy(false);
                    }
                  }
                }}
              />
            </Field>
            {image && (
              <div className="create-image">
                <img src={image} alt="Creation reference" />
                <button onClick={() => setImage("")}>Remove image</button>
              </div>
            )}
            <p className="help">
              Image input needs a vision model on NanoGPT or OpenRouter. The
              image is sent when you generate and is kept only for this visit.
              Text drafts and settings save locally.
            </p>
            <details>
              <summary>Connection</summary>
              <ConnectionPanel
                story={{ ...source, connection, settings }}
                patch={(p) => {
                  if (p.connection) setConnection(p.connection);
                }}
                apiKey={key}
                setKey={(k) => setCredential(credentialId(connection), k)}
                onStatus={setStatus}
              />
            </details>
            <details>
              <summary>Create settings</summary>
              {(
                [
                  ["maxTokens", "Create Output (tokens)", 64, 131072],
                  [
                    "thinkingMaxTokens",
                    "Create Thinking Output (tokens)",
                    0,
                    131072,
                  ],
                  ["context", "Create Max Context (tokens)", 256, 262144],
                  ["temperature", "Create temperature", 0, 2],
                  ["top_p", "Create Top P", 0, 1],
                  ["top_k", "Create Top K", 0, 200],
                  ["min_p", "Create Min P", 0, 1],
                  ["rep_pen", "Create repetition penalty", 1, 2],
                ] as [keyof Settings, string, number, number][]
              ).map(([k, label, min, max]) => (
                <Field key={k} label={label}>
                  <input
                    type="number"
                    min={min}
                    max={max}
                    step={
                      ["temperature", "top_p", "min_p", "rep_pen"].includes(k)
                        ? 0.01
                        : 1
                    }
                    value={settings[k] as number}
                    onChange={(e) => {
                      if (e.target.value)
                        setSettings({
                          ...settings,
                          [k]: Math.max(min, Math.min(max, +e.target.value)),
                        });
                    }}
                  />
                </Field>
              ))}
              <Toggle
                label="Create Thinking"
                value={settings.thinking}
                onChange={(thinking) => setSettings({ ...settings, thinking })}
              />
              <Field label="Create Thinking level">
                <select
                  value={settings.thinkingLevel}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      thinkingLevel: e.target
                        .value as Settings["thinkingLevel"],
                    })
                  }
                >
                  {["minimal", "low", "medium", "high"].map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
              </Field>
              <Field label="Create thinking prefix">
                <input
                  value={settings.thinkingPrefix}
                  maxLength={128}
                  onChange={(e) =>
                    setSettings({ ...settings, thinkingPrefix: e.target.value })
                  }
                />
              </Field>
              <Field label="Create thinking suffix">
                <input
                  value={settings.thinkingSuffix}
                  maxLength={128}
                  onChange={(e) =>
                    setSettings({ ...settings, thinkingSuffix: e.target.value })
                  }
                />
              </Field>
              <Toggle
                label="Create server prefills thinking prefix"
                value={settings.thinkingPrefill}
                onChange={(thinkingPrefill) =>
                  setSettings({ ...settings, thinkingPrefill })
                }
              />
              <p className="help">
                Output covers Memory and Starting text together. The API
                receives output + thinking allowance; thought capture uses an
                estimated limit. Exact reasoning limits depend on the API/model.
                Max Context reserves an estimated 2,048 tokens for an image;
                real image usage varies.
              </p>
            </details>
            <details>
              <summary>Creation prompt</summary>
              <Field label="Creation prompt">
                <textarea
                  rows={9}
                  value={template}
                  onChange={(e) => setTemplate(e.target.value)}
                />
              </Field>
              <button onClick={() => setTemplate(DEFAULT_CREATE_PROMPT)}>
                Reset creation prompt
              </button>
            </details>
          </fieldset>
          <div className="create-actions">
            {busy ? (
              <button onClick={stop}>Stop creation</button>
            ) : (
              <button
                className="primary"
                disabled={!ready || uploading}
                onClick={() => void generate()}
              >
                Generate memory &amp; opening
              </button>
            )}
          </div>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {status && (
            <p className="help" role="status">
              {status}
            </p>
          )}
          {thoughts && (
            <details>
              <summary>Creation thinking</summary>
              <pre className="create-thoughts">{thoughts}</pre>
            </details>
          )}
        </section>
        <section className="create-result">
          <fieldset
            disabled={busy || !ready || uploading}
            className="panel-fieldset"
          >
            <Field label="Created title">
              <input
                value={result?.title || ""}
                maxLength={150}
                disabled={!result}
                onChange={(e) =>
                  result && setResult({ ...result, title: e.target.value })
                }
              />
            </Field>
            <Field label="Created Memory">
              <textarea
                rows={10}
                value={result?.memory || ""}
                disabled={!result}
                onChange={(e) =>
                  result && setResult({ ...result, memory: e.target.value })
                }
              />
            </Field>
            <Field label="Starting text">
              <textarea
                rows={12}
                maxLength={100000}
                value={result?.startingText || ""}
                disabled={!result}
                onChange={(e) =>
                  result &&
                  setResult({ ...result, startingText: e.target.value })
                }
              />
            </Field>
            {result && (
              <details>
                <summary>
                  Alternate greetings · {result.alternateGreetings?.length || 0}
                </summary>
                {(result.alternateGreetings || []).map((g, i) => (
                  <div className="context-card" key={i}>
                    <Field label={`Alternate greeting ${i + 1}`}>
                      <textarea
                        rows={6}
                        maxLength={100000}
                        value={g}
                        onChange={(e) =>
                          setResult({
                            ...result,
                            alternateGreetings: result.alternateGreetings!.map(
                              (v, n) => (n === i ? e.target.value : v),
                            ),
                          })
                        }
                      />
                    </Field>
                    <button
                      disabled={!g.trim()}
                      onClick={() =>
                        setResult({
                          ...result,
                          startingText: g,
                          alternateGreetings: result.alternateGreetings!.map(
                            (v, n) => (n === i ? result.startingText : v),
                          ),
                        })
                      }
                    >
                      Use greeting {i + 1} as opening
                    </button>
                    <button
                      onClick={() =>
                        setResult({
                          ...result,
                          alternateGreetings: result.alternateGreetings!.filter(
                            (_, n) => n !== i,
                          ),
                        })
                      }
                    >
                      Remove greeting {i + 1}
                    </button>
                  </div>
                ))}
                <button
                  disabled={(result.alternateGreetings?.length || 0) >= 99}
                  onClick={() =>
                    setResult({
                      ...result,
                      alternateGreetings: [
                        ...(result.alternateGreetings || []),
                        "",
                      ],
                    })
                  }
                >
                  Add alternate greeting
                </button>
              </details>
            )}
            {imported && (
              <details>
                <summary>
                  Imported context · {imported.lore.length} lore entries
                </summary>
                <Field label="Imported Author's note">
                  <textarea
                    rows={6}
                    maxLength={100000}
                    value={imported.author}
                    onChange={(e) =>
                      setImported({ ...imported, author: e.target.value })
                    }
                  />
                </Field>
                {imported.creatorNotes && (
                  <>
                    <h3>Creator notes</h3>
                    <pre className="create-thoughts">
                      {imported.creatorNotes}
                    </pre>
                  </>
                )}
                <p className="help">
                  Lore entries will be added to Lorebook for editing. Creator
                  notes are informational. Greetings are edited separately
                  above.
                </p>
              </details>
            )}
            <p className="help">
              Memory uses {"{{char}}"} and {"{{user}}"} as role labels. Review
              both fields before creating the story. The new story uses your
              writing connection and settings; Create settings remain separate.
            </p>
            <button
              className="primary"
              disabled={
                !result?.title.trim() ||
                !result?.memory.trim() ||
                !result?.startingText.trim()
              }
              onClick={() => {
                if (!result) return;
                const story = creationStory(
                  {
                    ...result,
                    alternateGreetings: result.alternateGreetings?.filter((g) =>
                      g.trim(),
                    ),
                  },
                  source,
                  resultThoughts,
                  resultConnection,
                );
                if (imported) {
                  story.author.content = imported.author;
                  story.lore = structuredClone(imported.lore);
                  story.characterSource = imported.source;
                }
                onCreate(story);
              }}
            >
              Create story
            </button>
          </fieldset>
        </section>
      </div>
    </main>
  );
}
