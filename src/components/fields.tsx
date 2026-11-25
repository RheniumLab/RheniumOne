"use client";

import { Plus, Trash2 } from "lucide-react";
import { useCollection } from "@/lib/hooks";
import { useAuth } from "@/lib/auth-context";
import type { Field } from "@/lib/entities";

export const OPTION_LABELS: Record<string, string> = { gst: "GST", nonGst: "Non-GST" };
export const optLabel = (o: string) => OPTION_LABELS[o] ?? o;

type Values = Record<string, unknown>;

export function FieldInput({ field, value, onChange }: { field: Field; value: unknown; onChange: (v: unknown) => void }) {
  const { nonGst } = useAuth();
  const v = value ?? "";
  switch (field.type) {
    case "textarea":
      return <textarea className="input min-h-20" value={String(v)} onChange={(e) => onChange(e.target.value)} required={field.required} />;
    case "number":
    case "money":
      return (
        <input
          className="input tabular-nums"
          type="number"
          step={field.type === "money" ? "0.01" : "any"}
          value={v === null ? "" : String(v)}
          onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
          required={field.required}
        />
      );
    case "checkbox":
      return <input type="checkbox" className="mt-2 h-4 w-4" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} />;
    case "select": {
      const opts = (field.options ?? []).filter((o) => o !== "nonGst" || nonGst);
      return (
        <select className="input" value={String(v)} onChange={(e) => onChange(e.target.value)} required={field.required}>
          <option value="">—</option>
          {opts.map((o) => (
            <option key={o} value={o}>{optLabel(o)}</option>
          ))}
        </select>
      );
    }
    case "ref":
      return <RefSelect field={field} value={String(v)} onChange={onChange} />;
    case "users":
      return <UserSelect value={String(v)} onChange={onChange} />;
    case "list":
      return <ListInput field={field} value={(value as Values[]) ?? []} onChange={onChange} />;
    default:
      return (
        <input
          className="input"
          type={field.type === "text" ? "text" : field.type}
          value={String(v)}
          onChange={(e) => onChange(e.target.value)}
          required={field.required}
        />
      );
  }
}

function RefSelect({ field, value, onChange }: { field: Field; value: string; onChange: (v: unknown) => void }) {
  const { rows } = useCollection(field.ref!.collection, [], { gstAware: field.ref!.gstAware });
  const label = field.ref!.label;
  const sorted = [...rows].sort((a, b) => String(a[label] ?? "").localeCompare(String(b[label] ?? "")));
  return (
    <select className="input" value={value} onChange={(e) => onChange(e.target.value)} required={field.required}>
      <option value="">—</option>
      {sorted.map((r) => (
        <option key={r.id} value={r.id}>
          {String(r[label] || r.legalName || r.name || r.id)}
          {r.code ? ` (${r.code})` : ""}
        </option>
      ))}
    </select>
  );
}

export function UserSelect({ value, onChange, required }: { value: string; onChange: (v: string) => void; required?: boolean }) {
  const { rows } = useCollection("users");
  return (
    <select className="input" value={value} onChange={(e) => onChange(e.target.value)} required={required}>
      <option value="">—</option>
      {rows.filter((u) => u.active).map((u) => (
        <option key={u.id} value={u.id}>{String(u.name)}</option>
      ))}
    </select>
  );
}

function ListInput({ field, value, onChange }: { field: Field; value: Values[]; onChange: (v: unknown) => void }) {
  const sub = field.fields ?? [];
  const set = (i: number, k: string, x: unknown) => onChange(value.map((row, j) => (j === i ? { ...row, [k]: x } : row)));
  return (
    <div className="space-y-2">
      {value.map((row, i) => (
        <div key={i} className="flex flex-wrap items-end gap-2 rounded-md border border-border bg-surface-2/50 p-2">
          {sub.map((f) => (
            <div key={f.name} className={f.wide ? "w-full" : f.type === "checkbox" ? "w-16" : "min-w-36 flex-1"}>
              <label className="label">{f.label}</label>
              <FieldInput field={f} value={row[f.name]} onChange={(x) => set(i, f.name, x)} />
            </div>
          ))}
          <button type="button" className="btn !px-2" onClick={() => onChange(value.filter((_, j) => j !== i))} aria-label="Remove row">
            <Trash2 size={14} />
          </button>
        </div>
      ))}
      <button type="button" className="btn" onClick={() => onChange([...value, {}])}>
        <Plus size={14} /> Add {field.label.toLowerCase().replace(/s$/, "")}
      </button>
    </div>
  );
}

/** Read-only display of a field value. */
export function FieldValue({ field, value }: { field: Field; value: unknown }) {
  const { rows: users } = useCollection("users", [], { enabled: field.type === "users" || field.type === "list" });
  if (value === null || value === undefined || value === "" || (Array.isArray(value) && !value.length))
    return <span className="text-muted">—</span>;
  if (field.type === "users") return <>{String(users.find((u) => u.id === value)?.name ?? "—")}</>;
  if (field.type === "ref") return <RefValue field={field} id={String(value)} />;
  if (field.type === "checkbox") return <>{value ? "Yes" : "No"}</>;
  if (field.type === "money") return <span className="tabular-nums">{Number(value).toLocaleString("en-IN", { style: "currency", currency: "INR" })}</span>;
  if (field.type === "url") return <a className="text-brand underline" href={String(value)} target="_blank" rel="noreferrer">{String(value)}</a>;
  if (field.type === "select") return <>{optLabel(String(value))}</>;
  if (field.type === "list") {
    const rows = value as Values[];
    const sub = field.fields ?? [];
    return (
      <div className="overflow-x-auto">
        <table className="table">
          <thead><tr>{sub.map((f) => <th key={f.name}>{f.label}</th>)}</tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>{sub.map((f) => <td key={f.name}><FieldValue field={f} value={r[f.name]} /></td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  return <span className="whitespace-pre-wrap">{String(value)}</span>;
}

function RefValue({ field, id }: { field: Field; id: string }) {
  const { rows } = useCollection(field.ref!.collection, [], { gstAware: field.ref!.gstAware });
  const r = rows.find((x) => x.id === id);
  return <>{r ? String(r[field.ref!.label] || r.legalName || r.name) : "—"}</>;
}
