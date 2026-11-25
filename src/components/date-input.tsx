"use client";

/**
 * Date / month field that shows a clear "Select date" prompt while empty
 * (browsers otherwise show a blank box, or a bare dd-mm-yyyy mask).
 */
export function DateInput({
  value,
  onChange,
  type = "date",
  placeholder,
  className = "",
  required,
  disabled,
  prefix,
}: {
  value: string | null | undefined;
  onChange: (v: string) => void;
  type?: "date" | "month";
  placeholder?: string;
  className?: string;
  required?: boolean;
  disabled?: boolean;
  /** Short label shown inside the box on the left, for compact filter rows (e.g. "From"). */
  prefix?: string;
}) {
  const empty = !value;
  const auto = /!w-auto/.test(className);
  const pad = prefix ? { paddingLeft: `${1.1 + prefix.length * 0.5}rem` } : undefined;
  return (
    <div className={`relative ${auto ? "inline-block" : "w-full"}`} style={auto ? { minWidth: `${10 + (prefix?.length ?? 0) * 0.5}rem` } : undefined}>
      <input
        type={type}
        className={`input peer ${empty ? "text-transparent focus:text-text" : ""} ${className.replace("!w-auto", "")}`}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        disabled={disabled}
        style={pad}
        aria-label={prefix ?? placeholder}
      />
      {prefix && (
        <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-xs font-medium text-muted">{prefix}</span>
      )}
      {empty && (
        <span className="pointer-events-none absolute inset-y-0 flex items-center text-sm text-muted peer-focus:hidden" style={{ left: prefix ? pad!.paddingLeft : "0.75rem" }}>
          {placeholder ?? (type === "month" ? "Select month" : "Select date")}
        </span>
      )}
    </div>
  );
}
