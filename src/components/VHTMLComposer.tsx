import { useEffect, useRef, useState } from "react";
import type { GameProject } from "../vgame/types";
import { vhtmlCompletions, type VHTMLCompletion } from "../vgame/completion";

export function VHTMLSuggestions({
  items,
  selected,
  onChoose,
  name = "V-HTML input suggestions",
}: {
  items: VHTMLCompletion[];
  selected: number;
  onChoose: (item: VHTMLCompletion) => void;
  name?: string;
}) {
  if (!items.length) return null;
  return (
    <div className="vgame-completions" role="listbox" aria-label={name}>
      {items.map((item, index) => (
        <button
          type="button"
          key={item.label}
          role="option"
          aria-selected={index === selected}
          onPointerDown={(e) => e.preventDefault()}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onChoose(item)}
        >
          {item.label}
        </button>
      ))}
    </div>
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
      />
    </div>
  );
}
