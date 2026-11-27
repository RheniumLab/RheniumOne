"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowRightLeft, Plus } from "lucide-react";
import { Badge, Empty, ErrorBox, NoAccess, PageHeader, Spinner, Stat } from "@/components/ui";
import { useAuth } from "@/lib/auth-context";
import { useCollection } from "@/lib/hooks";
import { createDoc, fmtDate, inr, today } from "@/lib/data";
import { LOCATIONS, MOVE_TYPES, useStock } from "@/lib/stock";
import { DateInput } from "@/components/date-input";

/** §7.4 Stock per item and location, reserved per project, low-stock alerts, every movement logged. */
export default function InventoryPage() {
  const { can } = useAuth();
  const { items, moves, stock, low, loading } = useStock();
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<"stock" | "moves">("stock");
  const [show, setShow] = useState(false);
  if (!can("inventory", "view")) return <NoAccess />;
  const value = items.reduce((s, it) => s + (stock.get(it.id)?.total ?? 0) * (Number(it.rate) || 0), 0);
  const list = items.filter((it) => !q || `${it.code} ${it.name} ${it.category}`.toLowerCase().includes(q.toLowerCase())).sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const iname = (id: unknown) => { const it = items.find((x) => x.id === id); return it ? `${it.code} ${it.name}` : "—"; };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Inventory"
        actions={
          <>
            {can("inventory", "edit") && <button className="btn" onClick={() => setShow(!show)}><ArrowRightLeft size={15} /> Stock movement</button>}
            {can("inventory", "create") && <Link className="btn-primary" href="/inventory/new"><Plus size={15} /> New item</Link>}
          </>
        }
      />
      <div className="stat-row">
        <Stat label="Items" value={items.length} />
        <Stat label="Stock value (at standard rate)" value={inr(value)} />
        <Stat label="At or below reorder level" value={low.length} tone={low.length ? "danger" : "ok"} />
      </div>
      {show && <MoveForm items={items} onDone={() => setShow(false)} />}
      <div className="flex gap-1 border-b border-border">
        {([["stock", "Stock"], ["moves", "Movements"]] as const).map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className={`-mb-px border-b-2 px-3 py-2 text-sm ${tab === k ? "border-brand font-medium text-brand" : "border-transparent text-muted"}`}>{l}</button>
        ))}
      </div>
      {tab === "stock" ? (
        <div className="card">
          <div className="border-b border-border p-3"><input className="input" placeholder="Search items…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          {loading ? <Spinner /> : !list.length ? <Empty>No items yet.</Empty> : (
            <div className="overflow-x-auto">
              <table className="table">
                <thead><tr><th>Code</th><th>Item</th>{LOCATIONS.map((l) => <th key={l} className="text-right">{l}</th>)}<th className="text-right">Total</th><th className="text-right">Reserved</th><th className="text-right">Free</th><th className="text-right">Reorder at</th></tr></thead>
                <tbody>
                  {list.map((it) => {
                    const s = stock.get(it.id)!;
                    const isLow = low.some((x) => x.id === it.id);
                    return (
                      <tr key={it.id}>
                        <td>{String(it.code)}</td>
                        <td><Link className="font-medium text-brand hover:underline" href={`/inventory/${it.id}`}>{String(it.name)}</Link> <span className="text-xs text-muted">{String(it.unit ?? "")}</span></td>
                        {LOCATIONS.map((l) => <td key={l} className="text-right tabular-nums">{s?.byLocation[l] || "—"}</td>)}
                        <td className="text-right font-medium tabular-nums">{s?.total ?? 0}</td>
                        <td className="text-right tabular-nums">{s?.reserved || "—"}</td>
                        <td className="text-right tabular-nums">{(s?.total ?? 0) - (s?.reserved ?? 0)}</td>
                        <td className="text-right">{isLow ? <Badge kind="danger">{`${it.reorderLevel} · low`}</Badge> : String(it.reorderLevel ?? "—")}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : (
        <div className="card overflow-x-auto">
          {!moves.length ? <Empty>No movements yet.</Empty> : (
            <table className="table">
              <thead><tr><th>Date</th><th>Item</th><th>Type</th><th>Location</th><th className="text-right">Qty</th><th>Reference</th></tr></thead>
              <tbody>
                {[...moves].sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 300).map((m) => (
                  <tr key={m.id}>
                    <td>{fmtDate(m.date)}</td>
                    <td>{iname(m.itemId)}</td>
                    <td>{String(m.type)}</td>
                    <td>{String(m.location)}</td>
                    <td className={`text-right tabular-nums ${Number(m.qty) < 0 ? "text-danger" : "text-ok"}`}>{Number(m.qty) > 0 ? "+" : ""}{String(m.qty)}</td>
                    <td className="text-xs">{String(m.note ?? "")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

function MoveForm({ items, onDone }: { items: Record<string, unknown>[]; onDone: () => void }) {
  const { rows: projects } = useCollection("projects", [], { gstAware: true });
  const [v, setV] = useState({ type: "Issue", itemId: "", qty: "", location: "Store", to: "Site", projectId: "", date: today(), note: "" });
  const [err, setErr] = useState<string | null>(null);
  const t = MOVE_TYPES.find((x) => x.key === v.type)!;
  return (
    <form className="card grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4" onSubmit={async (e) => {
      e.preventDefault();
      const q = Number(v.qty);
      if (!v.itemId || !q) return setErr("Choose the item and quantity.");
      if (v.type === "Issue" && !v.projectId) return setErr("Choose the project the material is issued to.");
      const base = { itemId: v.itemId, date: v.date, projectId: v.projectId || null, note: v.note };
      if (v.type === "Transfer") {
        await createDoc("stockMoves", { ...base, type: "Transfer out", qty: -q, location: v.location });
        await createDoc("stockMoves", { ...base, type: "Transfer in", qty: q, location: v.to });
      } else {
        await createDoc("stockMoves", { ...base, type: v.type, qty: t.sign * q, location: v.location });
      }
      onDone();
    }}>
      <div>
        <label className="label">Movement</label>
        <select className="input" value={v.type} onChange={(e) => setV({ ...v, type: e.target.value })}>{MOVE_TYPES.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}</select>
      </div>
      <div className="lg:col-span-2">
        <label className="label">Item</label>
        <select className="input" required value={v.itemId} onChange={(e) => setV({ ...v, itemId: e.target.value })}>
          <option value="">Select item</option>
          {items.map((it) => <option key={String(it.id)} value={String(it.id)}>{String(it.code)} {String(it.name)}</option>)}
        </select>
      </div>
      <div><label className="label">Quantity</label><input className="input" type="number" step="any" min="0" required value={v.qty} onChange={(e) => setV({ ...v, qty: e.target.value })} /></div>
      <div><label className="label">{v.type === "Transfer" ? "From" : "Location"}</label><select className="input" value={v.location} onChange={(e) => setV({ ...v, location: e.target.value })}>{LOCATIONS.map((l) => <option key={l}>{l}</option>)}</select></div>
      {v.type === "Transfer" && <div><label className="label">To</label><select className="input" value={v.to} onChange={(e) => setV({ ...v, to: e.target.value })}>{LOCATIONS.map((l) => <option key={l}>{l}</option>)}</select></div>}
      <div>
        <label className="label">Project {v.type === "Issue" ? "*" : ""}</label>
        <select className="input" value={v.projectId} onChange={(e) => setV({ ...v, projectId: e.target.value })}>
          <option value="">Select project</option>
          {projects.map((p) => <option key={p.id} value={p.id}>{String(p.code)} · {String(p.name)}</option>)}
        </select>
      </div>
      <div><label className="label">Date</label><DateInput value={v.date} onChange={(val) => setV({ ...v, date: val })} /></div>
      <div className="lg:col-span-2"><label className="label">Note</label><input className="input" value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} /></div>
      {err && <div className="lg:col-span-4"><ErrorBox>{err}</ErrorBox></div>}
      <div><button className="btn-primary">Save movement</button></div>
    </form>
  );
}
