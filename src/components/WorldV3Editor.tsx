import { useMemo, useState } from "react";
import type { GameProject } from "../vgame/types";
import { escapeXML as esc } from "../vgame/xml";
import { v3Value } from "../vgame/v3";
import { Field } from "./Fields";

export function WorldV3Editor({
  game,
  execute,
  busy,
  runMechanic,
}: {
  game: GameProject;
  execute: (source: string, label: string) => boolean;
  busy: boolean;
  runMechanic: (id: string) => void;
}) {
  const [id, setId] = useState(""),
    [kind, setKind] = useState("variable"),
    [norm, setNorm] = useState("string"),
    [initial, setInitial] = useState(""),
    [name, setName] = useState("");
  const [stat, setStat] = useState(""),
    [entity, setEntity] = useState("player"),
    [value, setValue] = useState(""),
    [all, setAll] = useState(false);
  const [selected, setSelected] = useState("");
  const [characterLimit, setCharacterLimit] = useState(12);
  const object = game.objects.find((o) => o.id === selected && o.v3);
  const stats = useMemo(
      () => game.objects.filter((o) => o.kind === "stat" && o.v3),
      [game.objects],
    ),
    entities = useMemo(
      () => game.objects.filter((o) => o.kind === "entity"),
      [game.objects],
    );
  const linkedCharacters = useMemo(
    () =>
      entities.filter((e) =>
        stats.some((s) => game.vhtml3?.bindings[s.id]?.[e.id] !== undefined),
      ),
    [entities, stats, game.vhtml3?.bindings],
  );
  return (
    <div className="vgame-v3-world">
      <p className="help">
        V-HTML 3.0 · Stat definitions belong to the registry; each linked
        character has an independent value. Commands use XML attributes.
      </p>
      <div className="vgame-form-grid">
        <Field label="V3 object ID">
          <input
            disabled={busy}
            value={id}
            onChange={(e) => setId(e.target.value)}
            placeholder="health"
          />
        </Field>
        <Field label="V3 object name">
          <input
            disabled={busy}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Field label="V3 object kind">
          <select
            disabled={busy}
            value={kind}
            onChange={(e) => {
              const k = e.target.value;
              setKind(k);
              setNorm(
                k === "variable" || k === "entity"
                  ? "string"
                  : k === "encounter"
                    ? "percentage"
                    : "integer",
              );
              setInitial(
                k === "stat"
                  ? "10"
                  : k === "entity" || k === "variable"
                    ? ""
                    : "0",
              );
            }}
          >
            {["variable", "stat", "entity", "encounter", "mechanic"].map(
              (k) => (
                <option key={k}>{k}</option>
              ),
            )}
          </select>
        </Field>
        {kind !== "entity" && (
          <>
            <Field label="V3 value type">
              <select
                disabled={busy || kind !== "variable"}
                value={norm}
                onChange={(e) => {
                  setNorm(e.target.value);
                  setInitial(
                    e.target.value === "boolean"
                      ? "false"
                      : e.target.value === "string"
                        ? ""
                        : "0",
                  );
                }}
              >
                {["string", "integer", "decimal", "boolean", "percentage"].map(
                  (n) => (
                    <option key={n}>{n}</option>
                  ),
                )}
              </select>
            </Field>
            <Field label="V3 default value">
              <input
                disabled={busy}
                value={initial}
                onChange={(e) => setInitial(e.target.value)}
              />
            </Field>
          </>
        )}
      </div>
      <button
        disabled={busy || !id.trim()}
        onClick={() => {
          const attributes =
            kind === "entity"
              ? ""
              : kind === "encounter"
                ? ` base-chance="${esc(initial)}"`
                : ` norm="${norm}" default="${esc(initial)}"`;
          if (
            execute(
              `<add type="${kind}" id="${esc(id)}"${name ? ` name="${esc(name)}"` : ""}${attributes}/>`,
              "Create V3 object",
            )
          ) {
            setId("");
            setName("");
          }
        }}
      >
        Create V3 object
      </button>
      <details className="vgame-card" open>
        <summary>Character stat bindings</summary>
        <Field label="Binding stat">
          <select
            disabled={busy}
            value={stat}
            onChange={(e) => setStat(e.target.value)}
          >
            <option value="">Choose a stat</option>
            {stats.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name} · default {String(o.default)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Binding character">
          <select
            disabled={busy || all}
            value={entity}
            onChange={(e) => setEntity(e.target.value)}
          >
            <option value="player">Player</option>
            {entities
              .filter((e) => e.id !== "player")
              .map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
          </select>
        </Field>
        <label className="vgame-check">
          <input
            disabled={busy}
            type="checkbox"
            checked={all}
            onChange={(e) => setAll(e.target.checked)}
          />
          Link all current and future characters
        </label>
        <Field label="Binding value">
          <input
            disabled={busy}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Keep existing value, or use stat default"
          />
        </Field>
        <div className="row">
          <button
            disabled={busy || !stat}
            onClick={() =>
              execute(
                `<configure id="${esc(stat)}" ${all ? 'auto-link="true"' : `link="${esc(entity)}"`}${value ? ` value="${esc(value)}"` : ""}/>`,
                "Link character stat",
              )
            }
          >
            Link / update
          </button>
          <button
            disabled={busy || !stat || all}
            onClick={() =>
              execute(
                `<configure id="${esc(stat)}" unlink="${esc(entity)}"/>`,
                "Unlink character stat",
              )
            }
          >
            Unlink
          </button>
        </div>
        {linkedCharacters.slice(0, characterLimit).map((e) => {
          const linked = stats.filter(
            (s) => game.vhtml3?.bindings[s.id]?.[e.id] !== undefined,
          );
          return linked.length ? (
            <div className="vgame-card" key={e.id}>
              <strong>{e.name}</strong>
              <dl className="vgame-stat-list">
                {linked.map((s) => (
                  <div key={s.id}>
                    <dt>{s.name}</dt>
                    <dd>{String(v3Value(game, s.id, e.id))}</dd>
                  </div>
                ))}
              </dl>
              <button
                disabled={busy}
                onClick={() =>
                  execute(
                    `<ui type="entity-card" id="${esc(e.id)}"/>`,
                    "Show character card",
                  )
                }
              >
                Show character card
              </button>
            </div>
          ) : null;
        })}
        {linkedCharacters.length > characterLimit && (
          <button onClick={() => setCharacterLimit((n) => n + 12)}>
            Show 12 more characters
          </button>
        )}
      </details>
      <Field label="V3 registered object">
        <select
          value={selected}
          disabled={busy}
          onChange={(e) => setSelected(e.target.value)}
        >
          <option value="">Inspect an object</option>
          {game.objects
            .filter((o) => o.v3)
            .map((o) => (
              <option key={o.id} value={o.id}>
                {o.name} · {o.kind}
              </option>
            ))}
        </select>
      </Field>
      {object && (
        <div className="vgame-card">
          <p className="vgame-meta">
            {object.kind === "stat" ? "Default" : "Value"}:{" "}
            {String(object.kind === "stat" ? object.default : object.value)}
          </p>
          <Field label="V3 AI access">
            <select
              disabled={busy}
              value={object.aiAccess}
              onChange={(e) =>
                execute(
                  `<configure id="${esc(object.id)}" ai-access="${e.target.value}"/>`,
                  "Change V3 AI access",
                )
              }
            >
              <option value="none">None</option>
              <option value="read">Read</option>
              <option value="modify">Modify</option>
            </select>
          </Field>
          <p className="help">
            Use XML configure for advanced rules, mechanics and encounters. The
            History panel records rolls and changes.
          </p>
          {object.kind === "mechanic" && object.v3?.trigger === "manual" && (
            <button disabled={busy} onClick={() => runMechanic(object.id)}>
              Run mechanic once
            </button>
          )}
        </div>
      )}
    </div>
  );
}
