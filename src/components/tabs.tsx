"use client";

/** The app's one switch style: underlined tabs. "main" picks the view (Fixtures / Log,
 *  This league / All players), "sub" a choice inside it (High / Primary, This tournament / All). */
export function Tabs<T extends string>({ items, value, onPick, size = "main", label }: {
  items: readonly (readonly [T, string] | readonly [T, string, boolean])[];
  value: T;
  onPick: (v: T) => void;
  size?: "main" | "sub";
  label?: string;
}) {
  return (
    <div className={size === "main" ? "scope-tabs" : "stage-tabs"} role="tablist" aria-label={label}>
      {items.map(([v, text, disabled]) => (
        <button key={v} type="button" role="tab" aria-selected={value === v} className={value === v ? "on" : ""} disabled={disabled} onClick={() => onPick(v)}>{text}</button>
      ))}
    </div>
  );
}
