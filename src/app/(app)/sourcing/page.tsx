"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Empty, NoAccess, PageHeader } from "@/components/ui";
import { useAuth } from "@/lib/auth-context";
import { useCollection } from "@/lib/hooks";
import { fmtDate, inr } from "@/lib/data";
import { isLeaf, totalQty, type BomLine } from "@/lib/bom";

/** §7.2: what each project sourced from whom and at what price vs estimate, and price history per item. */
export default function SourcingPage() {
  const { can } = useAuth();
  const ok = can("sourcing", "view");
  const { rows: boms } = useCollection("boms", [], { enabled: ok });
  const { rows: projects } = useCollection("projects", [], { gstAware: true, enabled: ok });
  const { rows: vendors } = useCollection("vendors", [], { enabled: ok });
  const { rows: pos } = useCollection("pos", [], { gstAware: true, enabled: ok && can("purchases", "view") });
  const { rows: items } = useCollection("items", [], { enabled: ok });
  const [projectId, setProjectId] = useState("");
  const [itemId, setItemId] = useState("");
  const vname = (id: unknown) => String(vendors.find((v) => v.id === id)?.name ?? "—");

  const rows = useMemo(() => {
    const out: { bom: string; bomId: string; line: BomLine; qty: number; vendor: string; price: number | null }[] = [];
    for (const b of boms.filter((b) => !projectId || b.projectId === projectId)) {
      const ls = (b.lines ?? []) as BomLine[];
      ls.forEach((l, i) => {
        if (!isLeaf(ls, i)) return;
        const q = (l.quotes ?? []).find((x) => x.vendorId === l.selectedVendorId);
        out.push({ bom: `${b.code} ${b.name}`, bomId: b.id, line: l, qty: totalQty(ls, i), vendor: l.selectedVendorId ? vname(l.selectedVendorId) : "—", price: q?.price ?? null });
      });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boms, projectId, vendors]);

  const history = useMemo(() => {
    const out: { date: string; vendor: string; project: string; rate: number; po: string; poId: string }[] = [];
    for (const p of pos) {
      if (p.status === "Cancelled" || p.status === "Rejected") continue;
      for (const l of (p.lines ?? []) as Record<string, unknown>[]) {
        if (itemId && l.itemId !== itemId) continue;
        if (!itemId) continue;
        const pr = projects.find((x) => x.id === p.projectId);
        out.push({ date: String(p.date), vendor: vname(p.vendorId), project: pr ? String(pr.code) : "Company", rate: Number(l.rate), po: String(p.number ?? "Draft"), poId: p.id });
      }
    }
    return out.sort((a, b) => b.date.localeCompare(a.date));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pos, itemId, projects, vendors]);

  if (!ok) return <NoAccess />;
  const estTotal = rows.reduce((s, r) => s + r.qty * (Number(r.line.rate) || 0), 0);
  const srcTotal = rows.reduce((s, r) => s + r.qty * (r.price ?? Number(r.line.rate) ?? 0), 0);

  return (
    <div className="space-y-5">
      <PageHeader title="Project-wise sourcing" subtitle="Quotes and vendor selection are entered on each BOM’s Sourcing tab" />
      <div className="card">
        <div className="flex flex-wrap items-center gap-3 border-b border-border p-3">
          <select className="input !w-auto" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">All projects</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{String(p.code)} · {String(p.name)}</option>)}
          </select>
          <span className="text-sm text-muted">Estimate {inr(estTotal)} · sourced {inr(srcTotal)} · <span className={srcTotal > estTotal ? "text-danger" : "text-ok"}>{srcTotal > estTotal ? "+" : ""}{inr(srcTotal - estTotal)}</span></span>
        </div>
        {!rows.length ? <Empty>No BOM parts yet.</Empty> : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead><tr><th>BOM</th><th>Part</th><th className="text-right">Qty</th><th>Vendor</th><th className="text-right">Estimate</th><th className="text-right">Sourced at</th><th className="text-right">Difference</th></tr></thead>
              <tbody>
                {rows.map((r, i) => {
                  const d = r.price === null ? null : r.price - (Number(r.line.rate) || 0);
                  return (
                    <tr key={i}>
                      <td><Link className="text-brand hover:underline" href={`/boms/${r.bomId}`}>{r.bom}</Link></td>
                      <td>{r.line.partNo ? `${r.line.partNo} · ` : ""}{r.line.description}</td>
                      <td className="text-right">{r.qty} {r.line.unit}</td>
                      <td>{r.vendor}</td>
                      <td className="text-right tabular-nums">{inr(Number(r.line.rate) || 0)}</td>
                      <td className="text-right tabular-nums">{r.price === null ? "—" : inr(r.price)}</td>
                      <td className={`text-right tabular-nums ${d && d > 0 ? "text-danger" : d && d < 0 ? "text-ok" : ""}`}>{d === null ? "—" : inr(d)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <div className="flex flex-wrap items-center gap-3 border-b border-border p-3">
          <span className="text-sm font-semibold">Price history</span>
          <select className="input !w-auto" value={itemId} onChange={(e) => setItemId(e.target.value)}>
            <option value="">Choose an item…</option>
            {items.map((it) => <option key={it.id} value={it.id}>{String(it.code)} {String(it.name)}</option>)}
          </select>
        </div>
        {!itemId ? <Empty>Pick an item to see what it cost across vendors and projects.</Empty> : !history.length ? <Empty>No purchase orders for this item yet.</Empty> : (
          <table className="table">
            <thead><tr><th>Date</th><th>PO</th><th>Vendor</th><th>Project</th><th className="text-right">Rate</th></tr></thead>
            <tbody>{history.map((h, i) => <tr key={i}><td>{fmtDate(h.date)}</td><td><Link className="text-brand hover:underline" href={`/purchases/${h.poId}`}>{h.po}</Link></td><td>{h.vendor}</td><td>{h.project}</td><td className="text-right tabular-nums">{inr(h.rate)}</td></tr>)}</tbody>
          </table>
        )}
      </div>
    </div>
  );
}
