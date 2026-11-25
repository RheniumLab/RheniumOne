"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AdjustmentsEditor, LineItems, TotalsPanel } from "@/components/line-items";
import { ErrorBox } from "@/components/ui";
import { useAuth } from "@/lib/auth-context";
import { useCollection } from "@/lib/hooks";
import { useCompany } from "@/lib/business";
import { createDoc, today, updateDoc } from "@/lib/data";
import { computeTotals, sameState, type Adjustments, type Line } from "@/lib/tax";

export interface PoDraft {
  vendorId: string;
  scope: string;
  projectId: string;
  date: string;
  expectedDate: string;
  billingType: string;
  lines: (Line & { received?: number })[];
  adj: Adjustments;
  deliveryAddress: string;
  notes: string;
  terms: string;
  assetRequestId?: string | null;
  bomId?: string | null;
}

export function PoEditor({ id, initial }: { id?: string; initial?: Partial<PoDraft> }) {
  const router = useRouter();
  const { nonGst } = useAuth();
  const company = useCompany();
  const { rows: vendors } = useCollection("vendors");
  const { rows: projects } = useCollection("projects", [], { gstAware: true });
  const [v, setV] = useState<PoDraft>({
    vendorId: "", scope: "company", projectId: "", date: today(), expectedDate: "", billingType: "gst",
    lines: [], adj: {}, deliveryAddress: company.address ?? "", notes: "", terms: "", ...initial,
  });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (p: Partial<PoDraft>) => setV((x) => ({ ...x, ...p }));
  const vendor = vendors.find((x) => x.id === v.vendorId);
  const gst = v.billingType === "gst";
  const intra = sameState(vendor?.state, company.state);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!v.lines.length) return setErr("Add at least one line.");
    if (v.scope === "project" && !v.projectId) return setErr("Choose the project.");
    setBusy(true);
    try {
      const t = computeTotals(v.lines, v.adj, { gst, intraState: intra });
      const data = {
        ...v, projectId: v.scope === "project" ? v.projectId : null, intraState: intra, vendorName: String(vendor?.name ?? ""),
        lines: v.lines.map((l) => ({ ...l, received: l.received ?? 0 })), total: t.total, taxable: t.taxable, tax: t.tax,
      };
      if (id) {
        await updateDoc("pos", id, data);
        router.push(`/purchases/${id}`);
      } else {
        const nid = await createDoc("pos", { ...data, status: "Draft", number: null });
        if (v.assetRequestId) await updateDoc("assetRequests", v.assetRequestId, { status: "Ordered", poId: nid });
        router.push(`/purchases/${nid}`);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="space-y-4">
      <div className="card grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label className="label">Vendor *</label>
          <select className="input" required value={v.vendorId} onChange={(e) => set({ vendorId: e.target.value })}>
            <option value="">—</option>
            {vendors.map((x) => <option key={x.id} value={x.id}>{String(x.name)}</option>)}
          </select>
        </div>
        <div>
          <label className="label">For</label>
          <select className="input" value={v.scope} onChange={(e) => set({ scope: e.target.value })}><option value="company">Company</option><option value="project">Project</option></select>
        </div>
        {v.scope === "project" ? (
          <div>
            <label className="label">Project *</label>
            <select className="input" value={v.projectId} onChange={(e) => set({ projectId: e.target.value })}>
              <option value="">—</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{String(p.code)} · {String(p.name)}</option>)}
            </select>
          </div>
        ) : <div />}
        <div>
          <label className="label">GST / non-GST</label>
          <select className="input" value={v.billingType} onChange={(e) => set({ billingType: e.target.value })}><option value="gst">GST</option>{nonGst && <option value="nonGst">Non-GST</option>}</select>
        </div>
        <div><label className="label">PO date</label><input className="input" type="date" value={v.date} onChange={(e) => set({ date: e.target.value })} /></div>
        <div><label className="label">Expected delivery</label><input className="input" type="date" value={v.expectedDate} onChange={(e) => set({ expectedDate: e.target.value })} /></div>
        <div className="sm:col-span-2"><label className="label">Deliver to</label><input className="input" value={v.deliveryAddress} onChange={(e) => set({ deliveryAddress: e.target.value })} /></div>
      </div>
      <div className="card p-4"><LineItems lines={v.lines} onChange={(lines) => set({ lines })} gst={gst} defaultTax={company.defaultGstRate ?? 18} /></div>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="card p-4"><AdjustmentsEditor adj={v.adj} onChange={(adj) => set({ adj })} gst={gst} /></div>
        <div className="card p-4"><TotalsPanel lines={v.lines} adj={v.adj} gst={gst} intraState={intra} /></div>
      </div>
      <div className="card grid gap-3 p-4 sm:grid-cols-2">
        <div><label className="label">Notes</label><textarea className="input" value={v.notes} onChange={(e) => set({ notes: e.target.value })} /></div>
        <div><label className="label">Terms</label><textarea className="input" value={v.terms} onChange={(e) => set({ terms: e.target.value })} /></div>
      </div>
      {err && <ErrorBox>{err}</ErrorBox>}
      <div className="flex gap-2">
        <button className="btn-primary" disabled={busy}>{busy ? "Saving…" : id ? "Save" : "Create draft PO"}</button>
        <button type="button" className="btn" onClick={() => router.back()}>Cancel</button>
      </div>
    </form>
  );
}
