import {
  useId,
  cloneElement,
  isValidElement,
  type ReactNode,
  type ReactElement,
} from "react";
export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  const labelId = useId();
  return (
    <label className="field">
      <span id={labelId}>{label}</span>
      {isValidElement(children)
        ? cloneElement(
            children as ReactElement<{ "aria-labelledby"?: string }>,
            { "aria-labelledby": labelId },
          )
        : children}
    </label>
  );
}
export function Toggle({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (b: boolean) => void;
}) {
  return (
    <label className="toggle">
      <span>{label}</span>
      <input
        type="checkbox"
        checked={value}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  );
}
export function Position({
  value,
  onChange,
}: {
  value: string;
  onChange: (s: "before" | "after") => void;
}) {
  return (
    <Field label="Injection position">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as "before" | "after")}
      >
        <option value="before">Before story</option>
        <option value="after">Near continuation</option>
      </select>
    </Field>
  );
}
