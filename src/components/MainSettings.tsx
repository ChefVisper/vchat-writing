import { useEffect, useRef } from "react";

export type WorkspaceMode = "vchat" | "vgame";
export function MainSettings({
  mode,
  dark,
  disabled,
  onMode,
  onAppearance,
  onClose,
}: {
  mode: WorkspaceMode;
  dark: boolean;
  disabled: boolean;
  onMode: (mode: WorkspaceMode) => void;
  onAppearance: (dark: boolean) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => previous?.focus();
  }, []);
  return (
    <div
      className="main-settings-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="main-settings-dialog"
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="main-settings-title"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            onClose();
          }
          if (event.key === "Tab") {
            const targets = [
              ...(dialog.current?.querySelectorAll<HTMLElement>(
                'button:not(:disabled),select:not(:disabled),input:not(:disabled),[tabindex="0"]',
              ) ?? []),
            ];
            const first = targets[0],
              last = targets.at(-1);
            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault();
              last?.focus();
            }
            if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              first?.focus();
            }
          }
        }}
      >
        <div className="main-settings-heading">
          <h2 id="main-settings-title">Main settings</h2>
          <button aria-label="Close main settings" onClick={onClose}>
            ×
          </button>
        </div>
        <label className="field">
          <span>Workspace</span>
          <select
            disabled={disabled}
            aria-label="Workspace mode"
            value={mode}
            onChange={(event) => onMode(event.target.value as WorkspaceMode)}
          >
            <option value="vchat">Vchat · co-writing</option>
            <option value="vgame">Vgame · interactive fiction</option>
          </select>
        </label>
        <p className="help">
          Vchat keeps your continuous manuscript. Vgame stores its pages and
          game state separately in the same project.
        </p>
        <label className="field">
          <span>Appearance</span>
          <select
            aria-label="Main appearance"
            value={dark ? "dark" : "light"}
            onChange={(event) => onAppearance(event.target.value === "dark")}
          >
            <option value="dark">Dark</option>
            <option value="light">Light</option>
          </select>
        </label>
        {disabled && (
          <p className="help">
            Finish or stop generation before switching workspaces.
          </p>
        )}
      </div>
    </div>
  );
}
