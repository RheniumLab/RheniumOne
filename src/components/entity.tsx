"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, type ReactNode } from "react";
import { Pencil, Plus, Search, Trash2 } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useCollection, useDoc } from "@/lib/hooks";
import { orderBy, where } from "firebase/firestore";
import { createDoc, softDelete, updateDoc } from "@/lib/data";
import type { EntityDef, Field } from "@/lib/entities";
import { Cell, Empty, ErrorBox, GstBadge, NoAccess, PageHeader, Spinner } from "./ui";
import { FieldInput, FieldValue } from "./fields";

function sections(fields: Field[]) {
  const out: { name: string; fields: Field[] }[] = [];
  for (const f of fields) {
    const s = f.section ?? "";
    let g = out.find((x) => x.name === s);
    if (!g) out.push((g = { name: s, fields: [] }));
    g.fields.push(f);
  }
  return out;
}

export function EntityList({ def, extraActions }: { def: EntityDef; extraActions?: ReactNode }) {
  const { can } = useAuth();
  const { rows, loading, error } = useCollection(def.collection, [], { gstAware: def.gstAware });
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");

  const statuses = useMemo(() => {
    if (!def.statusField) return [];
    return Array.from(new Set(rows.map((r) => String(r[def.statusField!] ?? "")).filter(Boolean)));
  }, [rows, def.statusField]);

  const filtered = rows
    .filter((r) => !status || r[def.statusField!] === status)
    .filter((r) => !q || JSON.stringify(r).toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => String(b.code ?? "").localeCompare(String(a.code ?? "")) || def.title(a).localeCompare(def.title(b)));

  if (!can(def.module, "view")) return <NoAccess />;

  return (
    <div>
      <PageHeader
        title={def.plural}
        subtitle={`${rows.length} record${rows.length === 1 ? "" : "s"}`}
        actions={
          <>
            {extraActions}
            {can(def.module, "create") && (
              <Link href={`${def.basePath}/new`} className="btn-primary"><Plus size={15} /> New {def.singular.toLowerCase()}</Link>
            )}
          </>
        }
      />
      <div className="card">
        <div className="flex flex-wrap gap-2 border-b border-border p-3">
          <div className="relative min-w-48 flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input className="input !pl-8" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          {statuses.length > 0 && (
            <select className="input !w-auto" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All statuses</option>
              {statuses.map((s) => <option key={s}>{s}</option>)}
            </select>
          )}
        </div>
        {error && <div className="p-3"><ErrorBox>{error}</ErrorBox></div>}
        {loading ? (
          <Spinner />
        ) : !filtered.length ? (
          <Empty>No {def.plural.toLowerCase()} yet.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  {def.columns.map((c) => <th key={c.field}>{c.label}</th>)}
                  {def.gstAware && <th>Billing</th>}
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.id} className="cursor-pointer">
                    {def.columns.map((c, i) => (
                      <td key={c.field}>
                        {i === 1 || (i === 0 && def.columns.length === 1) ? (
                          <Link href={`${def.basePath}/${r.id}`} className="font-medium text-brand hover:underline">
                            <Cell value={r[c.field] || def.title(r)} kind={c.kind} />
                          </Link>
                        ) : (
                          <Link href={`${def.basePath}/${r.id}`} className="block"><Cell value={r[c.field]} kind={c.kind} /></Link>
                        )}
                      </td>
                    ))}
                    {def.gstAware && <td><GstBadge type={String(r.billingType)} /></td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export function EntityForm({
  def,
  initial,
  id,
  onSaved,
  transform,
}: {
  def: EntityDef;
  initial?: Record<string, unknown>;
  id?: string;
  onSaved?: (id: string) => void;
  /** Adjust values as they change (e.g. fill billing type from the client). */
  transform?: (next: Record<string, unknown>, changed: string) => Promise<Record<string, unknown>> | Record<string, unknown>;
}) {
  const router = useRouter();
  const defaults = Object.fromEntries(def.fields.filter((f) => f.default !== undefined).map((f) => [f.name, f.default]));
  const [values, setValues] = useState<Record<string, unknown>>({ ...defaults, ...(initial ?? {}) });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const set = async (k: string, v: unknown) => {
    let next = { ...values, [k]: v };
    if (transform) next = await transform(next, k);
    setValues(next);
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const data: Record<string, unknown> = {};
      for (const f of def.fields) if (!f.when || f.when(values)) data[f.name] = values[f.name] ?? null;
      if (def.gstAware && !data.billingType) data.billingType = "gst";
      if (id) {
        await updateDoc(def.collection, id, data, initial);
        if (onSaved) onSaved(id);
        else router.push(`${def.basePath}/${id}`);
      } else {
        const newId = await createDoc(def.collection, data, def.code);
        if (onSaved) onSaved(newId);
        else router.push(`${def.basePath}/${newId}`);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {sections(def.fields).map((s) => {
        const visible = s.fields.filter((f) => !f.when || f.when(values));
        if (!visible.length) return null;
        return (
          <div key={s.name} className="card p-4">
            {s.name && <h2 className="mb-3 text-sm font-semibold">{s.name}</h2>}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {visible.map((f) => (
                <div key={f.name} className={f.wide ? "sm:col-span-2 lg:col-span-3" : ""}>
                  <label className="label">
                    {f.label}
                    {f.required && <span className="text-danger"> *</span>}
                  </label>
                  <FieldInput field={f} value={values[f.name]} onChange={(v) => set(f.name, v)} />
                  {f.help && <div className="mt-1 text-xs text-muted">{f.help}</div>}
                </div>
              ))}
            </div>
          </div>
        );
      })}
      {err && <ErrorBox>{err}</ErrorBox>}
      <div className="flex gap-2">
        <button className="btn-primary" disabled={busy}>{busy ? "Saving…" : id ? "Save changes" : `Create ${def.singular.toLowerCase()}`}</button>
        <button type="button" className="btn" onClick={() => router.back()}>Cancel</button>
      </div>
    </form>
  );
}

export function EntityNew({ def, transform }: { def: EntityDef; transform?: Parameters<typeof EntityForm>[0]["transform"] }) {
  const { can } = useAuth();
  if (!can(def.module, "create")) return <NoAccess />;
  return (
    <div>
      <PageHeader title={`New ${def.singular.toLowerCase()}`} back={def.basePath} />
      <EntityForm def={def} transform={transform} />
    </div>
  );
}

export function EntityDetail({
  def,
  id,
  children,
  actions,
  transform,
}: {
  def: EntityDef;
  id: string;
  children?: (d: Record<string, unknown>) => ReactNode;
  actions?: (d: Record<string, unknown>) => ReactNode;
  transform?: Parameters<typeof EntityForm>[0]["transform"];
}) {
  const { can } = useAuth();
  const router = useRouter();
  const { data, loading, error } = useDoc(def.collection, id);
  const [editing, setEditing] = useState(false);

  if (!can(def.module, "view")) return <NoAccess />;
  if (loading) return <Spinner />;
  if (error) return <ErrorBox>{error}</ErrorBox>;
  if (!data || data.deleted) return <Empty>Not found.</Empty>;

  if (editing) {
    return (
      <div>
        <PageHeader title={`Edit ${def.title(data)}`} />
        <EntityForm def={def} id={id} initial={data} transform={transform} onSaved={() => setEditing(false)} />
      </div>
    );
  }

  async function remove() {
    if (!confirm(`Delete this ${def.singular.toLowerCase()}? It will be marked deleted and kept in the audit log.`)) return;
    await softDelete(def.collection, id);
    router.push(def.basePath);
  }

  return (
    <div>
      <PageHeader
        back={def.basePath}
        title={def.title(data)}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            {data.code ? <span className="font-mono">{String(data.code)}</span> : null}
            {def.gstAware && <GstBadge type={String(data.billingType)} />}
          </span>
        }
        actions={
          <>
            {actions?.(data)}
            {can(def.module, "edit") && (
              <button className="btn" onClick={() => setEditing(true)}><Pencil size={14} /> Edit</button>
            )}
            {can(def.module, "delete") && (
              <button className="btn-danger" onClick={remove}><Trash2 size={14} /> Delete</button>
            )}
          </>
        }
      />
      {children?.(data)}
      <div className="space-y-4">
        {sections(def.fields).map((s) => {
          const visible = s.fields.filter((f) => !f.when || f.when(data));
          if (!visible.length) return null;
          return (
            <div key={s.name} className="card p-4">
              {s.name && <h2 className="mb-3 text-sm font-semibold">{s.name}</h2>}
              <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
                {visible.map((f) => (
                  <div key={f.name} className={f.wide ? "sm:col-span-2 lg:col-span-3" : ""}>
                    <dt className="text-xs text-muted">{f.label}</dt>
                    <dd className="mt-0.5 text-sm"><FieldValue field={f} value={data[f.name]} /></dd>
                  </div>
                ))}
              </dl>
            </div>
          );
        })}
        <ChangeHistory col={def.collection} id={id} />
      </div>
    </div>
  );
}

/** Each record shows its own change history (§10.2). */
function ChangeHistory({ col, id }: { col: string; id: string }) {
  const { isAdmin } = useAuth();
  const [open, setOpen] = useState(false);
  if (!isAdmin) return null;
  return (
    <div className="card p-4">
      <button className="text-sm font-semibold" onClick={() => setOpen(!open)}>
        {open ? "▾" : "▸"} Change history
      </button>
      {open && <HistoryList col={col} id={id} />}
    </div>
  );
}

function HistoryList({ col, id }: { col: string; id: string }) {
  const { rows, loading } = useAuditFor(col, id);
  if (loading) return <Spinner />;
  if (!rows.length) return <Empty>No changes logged.</Empty>;
  return (
    <ul className="mt-3 space-y-2 text-sm">
      {rows.map((r) => (
        <li key={r.id} className="rounded-md bg-surface-2 p-2">
          <div className="text-xs text-muted">
            {r.at?.toDate?.().toLocaleString("en-IN")} · {String(r.userName)} · <b>{String(r.action)}</b>
          </div>
          {r.after && Object.keys(r.after).length > 0 && (
            <div className="mt-1 font-mono text-xs break-all">
              {Object.entries(r.after as Record<string, unknown>).map(([k, v]) => (
                <div key={k}>
                  {k}: {JSON.stringify((r.before as Record<string, unknown>)?.[k] ?? null)} → {JSON.stringify(v)}
                </div>
              ))}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

function useAuditFor(col: string, id: string) {
  return useCollection("auditLog", [where("collection", "==", col), where("docId", "==", id), orderBy("at", "desc")], { includeDeleted: true }, [col, id]);
}
