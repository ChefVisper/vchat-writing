import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Box, Braces, Hash, Link2, Settings2, X } from "lucide-react";
import type { GameProject } from "../vgame/types";
import { vhtmlCompletions, type VHTMLCompletion } from "../vgame/completion";

export interface CompletionAnchor {
  left: number;
  top: number;
  bottom: number;
}

/** Measure the native textarea's wrapped caret, including its own scroll offset. */
function textareaAnchor(
  input: HTMLTextAreaElement | null,
): CompletionAnchor | null {
  if (!input || document.activeElement !== input) return null;
  const rect = input.getBoundingClientRect(),
    style = getComputedStyle(input);
  const mirror = document.createElement("div"),
    marker = document.createElement("span");
  for (const property of [
    "box-sizing",
    "width",
    "border-width",
    "border-style",
    "padding",
    "font-family",
    "font-size",
    "font-weight",
    "font-style",
    "line-height",
    "letter-spacing",
    "text-indent",
    "text-align",
    "tab-size",
  ])
    mirror.style.setProperty(property, style.getPropertyValue(property));
  Object.assign(mirror.style, {
    position: "fixed",
    left: "-10000px",
    top: "0",
    visibility: "hidden",
    whiteSpace: "pre-wrap",
    overflowWrap: "break-word",
  });
  mirror.textContent = input.value.slice(0, input.selectionStart);
  marker.textContent = input.value.slice(input.selectionStart) || "\u200b";
  mirror.append(marker);
  document.body.append(mirror);
  const caret = marker.getClientRects()[0] ?? marker.getBoundingClientRect(),
    base = mirror.getBoundingClientRect();
  const top = Math.max(
    rect.top,
    Math.min(
      rect.bottom - 16,
      rect.top + caret.top - base.top - input.scrollTop,
    ),
  );
  const left = Math.max(
    rect.left,
    Math.min(
      rect.right - 4,
      rect.left + caret.left - base.left - input.scrollLeft,
    ),
  );
  const bottom = Math.min(
    rect.bottom,
    top + (parseFloat(style.lineHeight) || 20),
  );
  mirror.remove();
  return { left, top, bottom };
}

export function VHTMLSuggestions({
  items,
  selected,
  onChoose,
  name = "V-HTML input suggestions",
  getAnchor,
  getOwner,
  onSelect,
  onDismiss,
}: {
  items: VHTMLCompletion[];
  selected: number;
  onChoose: (item: VHTMLCompletion) => void;
  name?: string;
  getAnchor: () => CompletionAnchor | null;
  getOwner: () => HTMLElement | null;
  onSelect: (index: number) => void;
  onDismiss: () => void;
}) {
  const popup = useRef<HTMLDivElement>(null),
    callbacks = useRef({ getAnchor, getOwner, onDismiss });
  callbacks.current = { getAnchor, getOwner, onDismiss };
  const [position, setPosition] = useState({
    left: 8,
    top: 8,
    width: 560,
    maxHeight: 300,
    visible: false,
  });
  useLayoutEffect(() => {
    if (!items.length) return;
    let frame = 0;
    const place = () => {
      const anchor = callbacks.current.getAnchor(),
        box = popup.current;
      if (!anchor || !box) {
        callbacks.current.onDismiss();
        return;
      }
      const viewport = window.visualViewport;
      const leftEdge = (viewport?.offsetLeft ?? 0) + 8,
        topEdge = (viewport?.offsetTop ?? 0) + 8;
      const rightEdge = leftEdge + (viewport?.width ?? innerWidth) - 16;
      const bottomEdge = topEdge + (viewport?.height ?? innerHeight) - 16;
      const width = Math.min(560, rightEdge - leftEdge);
      const below = bottomEdge - anchor.bottom - 5,
        above = anchor.top - topEdge - 5;
      const upwards = below < Math.min(300, box.scrollHeight) && above > below;
      const maxHeight = Math.max(
        80,
        Math.min(300, upwards ? above : below, bottomEdge - topEdge),
      );
      const height = Math.min(box.scrollHeight, maxHeight);
      const next = {
        left: Math.max(leftEdge, Math.min(anchor.left, rightEdge - width)),
        top: Math.max(
          topEdge,
          Math.min(
            upwards ? anchor.top - height - 5 : anchor.bottom + 5,
            bottomEdge - height,
          ),
        ),
        width,
        maxHeight,
        visible: true,
      };
      setPosition((old) =>
        Object.keys(next).every(
          (key) =>
            old[key as keyof typeof old] === next[key as keyof typeof next],
        )
          ? old
          : next,
      );
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(place);
    };
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        !popup.current?.contains(target) &&
        !callbacks.current.getOwner()?.contains(target)
      )
        callbacks.current.onDismiss();
    };
    place();
    // A second frame accounts for the mobile one-column layout after sizing.
    schedule();
    window.addEventListener("resize", schedule);
    document.addEventListener("scroll", schedule, true);
    document.addEventListener("pointerdown", outside, true);
    window.visualViewport?.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("scroll", schedule);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", schedule);
      document.removeEventListener("scroll", schedule, true);
      document.removeEventListener("pointerdown", outside, true);
      window.visualViewport?.removeEventListener("resize", schedule);
      window.visualViewport?.removeEventListener("scroll", schedule);
    };
  }, [items, selected]);
  useLayoutEffect(() => {
    popup.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [selected, items]);
  if (!items.length) return null;
  const active = items[selected] ?? items[0],
    icons = {
      command: Braces,
      object: Box,
      field: Settings2,
      value: Hash,
      reference: Link2,
    };
  return createPortal(
    <div
      ref={popup}
      className="vgame-completion-popup"
      data-compact={position.maxHeight < 180}
      style={{
        left: position.left,
        top: position.top,
        width: position.width,
        maxHeight: position.maxHeight,
        visibility: position.visible ? "visible" : "hidden",
      }}
    >
      <div className="vgame-completion-list" role="listbox" aria-label={name}>
        {items.map((item, index) => (
          <button
            type="button"
            key={item.label}
            role="option"
            tabIndex={-1}
            aria-selected={index === selected}
            onMouseEnter={() => onSelect(index)}
            onPointerDown={(e) => e.preventDefault()}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onChoose(item)}
          >
            {(() => {
              const Icon = icons[item.kind];
              return <Icon size={15} aria-hidden="true" />;
            })()}
            <span>{item.label}</span>
          </button>
        ))}
      </div>
      <div
        className="vgame-completion-detail"
        aria-label="Completion details"
        aria-live="polite"
      >
        <strong>{active.label}</strong>
        <p>{active.detail}</p>
        <code>{active.example}</code>
      </div>
      <div className="vgame-completion-footer">
        <span>↑ ↓ seç · Tab ekle · dokunarak ekle</span>
        <button
          type="button"
          aria-label="Close suggestions"
          onPointerDown={(e) => e.preventDefault()}
          onClick={onDismiss}
        >
          <X size={14} />
        </button>
      </div>
    </div>,
    document.body,
  );
}
export function VHTMLComposer({
  value,
  onChange,
  game,
  disabled,
  label,
  placeholder,
  maxLength = 10000,
  onSubmit,
}: {
  value: string;
  onChange: (text: string) => void;
  game: GameProject;
  disabled: boolean;
  label: string;
  placeholder?: string;
  maxLength?: number;
  onSubmit?: () => void;
}) {
  const input = useRef<HTMLTextAreaElement>(null);
  const [items, setItems] = useState<VHTMLCompletion[]>([]),
    [selected, setSelected] = useState(0);
  useEffect(() => {
    if (!value || disabled) setItems([]);
  }, [value, disabled]);
  const update = (text: string, cursor: number) => {
    setItems(vhtmlCompletions(text, cursor, game));
    setSelected(0);
  };
  const accept = (item: VHTMLCompletion) => {
    const next = value.slice(0, item.from) + item.insert + value.slice(item.to);
    if (next.length > maxLength) return;
    onChange(next);
    setItems([]);
    setSelected(0);
    requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.setSelectionRange(
        item.from + item.insert.length,
        item.from + item.insert.length,
      );
      update(next, item.from + item.insert.length);
    });
  };
  return (
    <div className="vgame-input-editor">
      <textarea
        ref={input}
        aria-label={label}
        placeholder={placeholder}
        disabled={disabled}
        value={value}
        maxLength={maxLength}
        spellCheck={false}
        enterKeyHint="enter"
        onChange={(e) => {
          onChange(e.target.value);
          update(e.target.value, e.target.selectionStart);
        }}
        onClick={(e) =>
          update(e.currentTarget.value, e.currentTarget.selectionStart)
        }
        onBlur={() => setItems([])}
        onKeyUp={(e) => {
          if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key))
            update(e.currentTarget.value, e.currentTarget.selectionStart);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setItems([]);
            e.stopPropagation();
          } else if (items.length && e.key === "Tab") {
            e.preventDefault();
            accept(items[selected] ?? items[0]);
          } else if (
            items.length &&
            (e.key === "ArrowDown" || e.key === "ArrowUp")
          ) {
            e.preventDefault();
            setSelected(
              (selected + (e.key === "ArrowDown" ? 1 : items.length - 1)) %
                items.length,
            );
          } else if (
            e.key === "Enter" &&
            (e.ctrlKey || e.metaKey) &&
            onSubmit
          ) {
            e.preventDefault();
            onSubmit();
          }
        }}
      />
      <VHTMLSuggestions
        items={disabled ? [] : items}
        selected={selected}
        onChoose={accept}
        getAnchor={() => textareaAnchor(input.current)}
        getOwner={() => input.current}
        onSelect={setSelected}
        onDismiss={() => setItems([])}
      />
    </div>
  );
}
