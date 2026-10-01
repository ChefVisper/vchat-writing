import {
  forwardRef,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
} from "react";
import {
  Compartment,
  EditorState,
  StateEffect,
  StateField,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  keymap,
  placeholder,
  type DecorationSet,
} from "@codemirror/view";
import { insertNewline } from "@codemirror/commands";
export { EditorView };

function newline(view: EditorView) {
  return view.state.readOnly || insertNewline(view);
}

const highlight = StateEffect.define<{ from: number; to: number } | null>();
const highlightField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, transaction) {
    if (transaction.docChanged) value = Decoration.none;
    for (const effect of transaction.effects)
      if (effect.is(highlight))
        value =
          effect.value && effect.value.from < effect.value.to
            ? Decoration.set([
                Decoration.mark({ class: "latest-ai-passage" }).range(
                  effect.value.from,
                  effect.value.to,
                ),
              ])
            : Decoration.none;
    return value;
  },
  provide: (field) => EditorView.decorations.from(field),
});
export interface ManuscriptHandle {
  scrollToEnd: () => void;
  find: (query: string) => boolean;
}
interface Props {
  text: string;
  readOnly: boolean;
  font: number;
  latest: { from: number; to: number } | null;
  onChange: (text: string) => void;
  undo: () => void;
  redo: () => void;
}
export const ManuscriptEditor = forwardRef<ManuscriptHandle, Props>(
  function ManuscriptEditor(props, ref) {
    const host = useRef<HTMLDivElement>(null);
    const view = useRef<EditorView | null>(null);
    const current = useRef(props);
    current.current = props;
    const syncing = useRef(false);
    const readOnly = useRef(new Compartment());
    useImperativeHandle(
      ref,
      () => ({
        scrollToEnd() {
          const editor = view.current;
          if (editor)
            editor.dispatch({
              effects: EditorView.scrollIntoView(editor.state.doc.length, {
                y: "end",
              }),
            });
        },
        find(query) {
          const editor = view.current;
          if (!editor || !query) return false;
          const text = editor.state.doc.toString().toLowerCase();
          let from = text.indexOf(
            query.toLowerCase(),
            editor.state.selection.main.to,
          );
          if (from < 0) from = text.indexOf(query.toLowerCase());
          if (from < 0) return false;
          editor.dispatch({
            selection: { anchor: from, head: from + query.length },
            effects: EditorView.scrollIntoView(from, { y: "center" }),
          });
          editor.focus();
          return true;
        },
      }),
      [],
    );
    useLayoutEffect(() => {
      if (!host.current) return;
      const editor = new EditorView({
        parent: host.current,
        state: EditorState.create({
          doc: current.current.text,
          extensions: [
            EditorView.lineWrapping,
            keymap.of([{ key: "Enter", run: newline, shift: newline }]),
            placeholder("Write here…"),
            highlightField,
            readOnly.current.of(
              EditorState.readOnly.of(current.current.readOnly),
            ),
            EditorView.contentAttributes.of({
              "aria-label": "Story manuscript",
              "aria-multiline": "true",
              spellcheck: "true",
              enterkeyhint: "enter",
            }),
            EditorView.updateListener.of((update) => {
              if (update.docChanged && !syncing.current)
                current.current.onChange(update.state.doc.toString());
            }),
            EditorView.domEventHandlers({
              keydown(event) {
                const key = event.key.toLowerCase();
                if (
                  !(event.ctrlKey || event.metaKey) ||
                  event.altKey ||
                  (key !== "z" && key !== "y")
                )
                  return false;
                event.preventDefault();
                if (!current.current.readOnly) {
                  if (key === "y" || event.shiftKey) current.current.redo();
                  else current.current.undo();
                }
                return true;
              },
              click(event, editor) {
                const pos = editor.posAtCoords({
                  x: event.clientX,
                  y: event.clientY,
                });
                const range = current.current.latest;
                editor.dispatch({
                  effects: highlight.of(
                    range &&
                      pos !== null &&
                      pos >= range.from &&
                      pos <= range.to
                      ? range
                      : null,
                  ),
                });
              },
            }),
            EditorView.theme({
              "&": {
                height: "100%",
                fontSize: "inherit",
                backgroundColor: "transparent",
              },
              "&.cm-focused": { outline: "none" },
              ".cm-scroller": {
                overflow: "auto",
                fontFamily: "Arial, Helvetica, sans-serif",
                lineHeight: "1.6",
              },
              ".cm-content": {
                padding: "0",
                minHeight: "100%",
                caretColor: "#aaccff",
              },
              ".cm-line": { padding: "0" },
              ".cm-placeholder": { color: "var(--muted)" },
              ".latest-ai-passage": {
                color: "var(--ai-passage)",
              },
            }),
          ],
        }),
      });
      view.current = editor;
      return () => {
        editor.destroy();
        view.current = null;
      };
    }, []);
    useLayoutEffect(() => {
      const editor = view.current;
      if (!editor) return;
      const old = editor.state.doc.toString();
      if (old === props.text) return;
      let from = 0;
      while (
        from < old.length &&
        from < props.text.length &&
        old.charCodeAt(from) === props.text.charCodeAt(from)
      )
        from++;
      let oldEnd = old.length,
        newEnd = props.text.length;
      while (
        oldEnd > from &&
        newEnd > from &&
        old.charCodeAt(oldEnd - 1) === props.text.charCodeAt(newEnd - 1)
      ) {
        oldEnd--;
        newEnd--;
      }
      syncing.current = true;
      try {
        editor.dispatch({
          changes: { from, to: oldEnd, insert: props.text.slice(from, newEnd) },
        });
      } finally {
        syncing.current = false;
      }
    }, [props.text]);
    useLayoutEffect(() => {
      view.current?.dispatch({
        effects: readOnly.current.reconfigure(
          EditorState.readOnly.of(props.readOnly),
        ),
      });
    }, [props.readOnly]);
    useLayoutEffect(() => {
      view.current?.requestMeasure();
    }, [props.font]);
    return (
      <div
        ref={host}
        className="story-editor"
        style={{ fontSize: props.font }}
      />
    );
  },
);
