"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { ErrorBox, NoAccess, PageHeader } from "@/components/ui";
import { useAuth } from "@/lib/auth-context";
import { useCollection } from "@/lib/hooks";
import { fySeries } from "@/lib/business";
import { createDoc, today } from "@/lib/data";
import { LOCATIONS, useStock } from "@/lib/stock";

export default function NewChallanPage() {
  return <Suspense><NewChallan /></Suspense>;
}

interface CLine { itemId: string; description: string; qty: number; unit: string }

/** A challan pulls items from inventory and links to a project (§7.6). */
function NewChallan() {
  const { can } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const { items, stock } = useStock();
  const { rows: projects } = useCollection("projects", [], { gstAware: true });
  const { rows: clients } = useCollection("clients");
  const { rows: vendors } = useCollection("vendors", [], { enabled: can("vendors", "view") });
  const [v, setV] = useState({
    date: today(), projectId: params.get("projectId") ?? "", purpose: "Material to client site", partyType: "client", partyId: "",
    consignee: "", address: "", fromLocation: "Store", returnable: false, expectedReturn: "", vehicle: "", notes: "",
  });
  const [lines, setLines] = useState<CLine[]>([{ itemId: "", description: "", qty: 1, unit: "Nos" }]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!can("challans", "create")) return <NoAccess />;

  const pickParty = (id: string) => {
    const p = v.partyType === "client" ? clients.find((c) => c.id === id) : vendors.find((x) => x.id === id);
    setV({ ...v, partyId: id, consignee: String(p?.legalName ?? p?.name ?? ""), address: String(p?.billingAddress ?? p?.address ?? "") });
  };

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    const ls = lines.filter((l) => l.description && l.qty > 0);
    if (!ls.length) return setErr("Add at least one item.");
    for (const l of ls) {
      const have = l.itemId ? stock.get(l.itemId)?.byLocation[v.fromLocation] ?? 0 : Infinity;
      if (have < l.qty) return setErr(`Only ${have} of "${l.description}" in ${v.fromLocation}.`);
    }
    setBusy(true);
    try {
      const project = projects.find((p) => p.id === v.projectId);
      const id = await createDoc("challans", {
        ...v, clientId: v.partyType === "client" ? v.partyId : project?.clientId ?? null, vendorId: v.partyType === "vendor" ? v.partyId : null,
        lines: ls.map((l) => ({ ...l, returned: 0 })), status: "Open", eway: {},
      }, fySeries("dc", "DC", new Date(v.date)));
      for (const l of ls)
        if (l.itemId) await createDoc("stockMoves", { itemId: l.itemId, qty: -l.qty, location: v.fromLocation, type: "Challan", projectId: v.projectId || null, ref: { col: "challans", id }, date: v.date, note: `Challan to ${v.consignee}` });
      router.push(`/challans/${id}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <div className="max-w-4xl">
      <PageHeader title="New delivery challan" back="/challans" />
      <form onSubmit={save} className="space-y-4">
        <div className="card grid gap-3 p-4 sm:grid-cols-3">
          <div><label className="label">Date</label><input className="input" type="date" value={v.date} onChange={(e) => setV({ ...v, date: e.target.value })} /></div>
          <div>
            <label className="label">Purpose</label>
            <select className="input" value={v.purpose} onChange={(e) => setV({ ...v, purpose: e.target.value, returnable: e.target.value !== "Material to client site" })}>
              {["Material to client site", "Sent for job work", "On approval", "Repair / return", "Other"].map((p) => <option key={p}>{p}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Project</label>
            <select className="input" value={v.projectId} onChange={(e) => setV({ ...v, projectId: e.target.value })}>
              <option value="">—</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{String(p.code)} · {String(p.name)}</option>)}
            </select>
          </div>
          <div>
            <label className="label">To</label>
            <select className="input" value={v.partyType} onChange={(e) => setV({ ...v, partyType: e.target.value, partyId: "" })}><option value="client">Client</option><option value="vendor">Vendor (job work)</option></select>
          </div>
          <div>
            <label className="label">{v.partyType === "client" ? "Client" : "Vendor"}</label>
            <select className="input" value={v.partyId} onChange={(e) => pickParty(e.target.value)}>
              <option value="">—</option>
              {(v.partyType === "client" ? clients : vendors).map((p) => <option key={p.id} value={p.id}>{String(p.displayName || p.legalName || p.name)}</option>)}
            </select>
          </div>
          <div><label className="label">From location</label><select className="input" value={v.fromLocation} onChange={(e) => setV({ ...v, fromLocation: e.target.value })}>{LOCATIONS.map((l) => <option key={l}>{l}</option>)}</select></div>
          <div><label className="label">Consignee name</label><input className="input" required value={v.consignee} onChange={(e) => setV({ ...v, consignee: e.target.value })} /></div>
          <div className="sm:col-span-2"><label className="label">Delivery address</label><input className="input" value={v.address} onChange={(e) => setV({ ...v, address: e.target.value })} /></div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={v.returnable} onChange={(e) => setV({ ...v, returnable: e.target.checked })} /> Goods expected back</label>
          {v.returnable && <div><label className="label">Expected return</label><input className="input" type="date" value={v.expectedReturn} onChange={(e) => setV({ ...v, expectedReturn: e.target.value })} /></div>}
          <div><label className="label">Vehicle no.</label><input className="input" value={v.vehicle} onChange={(e) => setV({ ...v, vehicle: e.target.value.toUpperCase() })} /></div>
        </div>
        <div className="card overflow-x-auto p-4">
          <table className="table">
            <thead><tr><th>Item</th><th>Description</th><th className="text-right">In {v.fromLocation}</th><th className="w-24">Qty</th><th className="w-20">Unit</th><th></th></tr></thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i}>
                  <td>
                    <select className="input !py-1" value={l.itemId} onChange={(e) => { const it = items.find((x) => x.id === e.target.value); setLines(lines.map((x, j) => (j === i ? { ...x, itemId: e.target.value, description: String(it?.name ?? x.description), unit: String(it?.unit ?? x.unit) } : x))); }}>
                      <option value="">— not a stock item —</option>
                      {items.map((it) => <option key={it.id} value={it.id}>{String(it.code)} {String(it.name)}</option>)}
                    </select>
                  </td>
                  <td><input className="input !py-1" value={l.description} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))} /></td>
                  <td className="text-right">{l.itemId ? stock.get(l.itemId)?.byLocation[v.fromLocation] ?? 0 : "—"}</td>
                  <td><input className="input !py-1 text-right" type="number" step="any" value={l.qty} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, qty: Number(e.target.value) } : x)))} /></td>
                  <td><input className="input !py-1" value={l.unit} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, unit: e.target.value } : x)))} /></td>
                  <td><button type="button" className="text-muted hover:text-danger" onClick={() => setLines(lines.filter((_, j) => j !== i))}><Trash2 size={14} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <button type="button" className="btn mt-2" onClick={() => setLines([...lines, { itemId: "", description: "", qty: 1, unit: "Nos" }])}><Plus size={14} /> Add item</button>
        </div>
        {err && <ErrorBox>{err}</ErrorBox>}
        <button className="btn-primary" disabled={busy}>{busy ? "Saving…" : "Create challan"}</button>
      </form>
    </div>
  );
}
