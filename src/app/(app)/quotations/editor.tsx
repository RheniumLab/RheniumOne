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
import { pad } from "@/lib/data";
import { DateInput } from "@/components/date-input";

export interface QuotationDraft {
  title: string;
  date: string;
  validUntil: string;
  clientId: string;
  projectId?: string | null;
  requirementId?: string | null;
  proposalId?: string | null;
  bomId?: string | null;
  billingType: string;
  placeOfSupply: string;
  lines: Line[];
  adj: Adjustments;
  scope: string;
  terms: string;
}

const plus30 = () => {
  const d = new Date();
  d.setDate(d.getDate() + 30);
  return d.toISOString().slice(0, 10);
};

export const QUOTATION_CODE = { counter: "quotation", field: "number", format: (n: number) => `RQ/${pad(n)}` };

export function QuotationEditor({ id, initial }: { id?: string; initial?: Partial<QuotationDraft> }) {
  const router = useRouter();
  const { nonGst } = useAuth();
  const company = useCompany();
  const { rows: clients } = useCollection("clients");
  const [v, setV] = useState<QuotationDraft>({
    title: "", date: today(), validUntil: plus30(), clientId: "", billingType: "gst", placeOfSupply: "",
    lines: [], adj: { roundOff: true }, scope: "", terms: company.quotationTerms ?? "", ...initial,
  });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (p: Partial<QuotationDraft>) => setV((x) => ({ ...x, ...p }));
  const gst = v.billingType === "gst";
  const intra = sameState(v.placeOfSupply, company.state);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!v.lines.length) return setErr("Add at least one line.");
    setBusy(true);
    try {
      const t = computeTotals(v.lines, v.adj, { gst, intraState: intra });
      const client = clients.find((c) => c.id === v.clientId);
      const data = { ...v, intraState: intra, total: t.total, taxable: t.taxable, tax: t.tax, estCost: t.cost, clientName: client?.displayName || client?.legalName || "" };
      if (id) {
        await updateDoc("quotations", id, data);
        router.push(`/quotations/${id}`);
      } else {
        const newId = await createDoc("quotations", { ...data, status: "Draft", rev: 0, releases: [] }, QUOTATION_CODE);
        router.push(`/quotations/${newId}`);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="space-y-4">
      <div className="card grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="sm:col-span-2"><label className="label">Subject *</label><input className="input" required value={v.title} onChange={(e) => set({ title: e.target.value })} /></div>
        <div>
          <label className="label">Client *</label>
          <select className="input" required value={v.clientId} onChange={(e) => {
            const c = clients.find((x) => x.id === e.target.value);
            set({ clientId: e.target.value, placeOfSupply: String(c?.state ?? ""), billingType: String(c?.billingType ?? v.billingType) });
          }}>
            <option value="">Select client</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{String(c.displayName || c.legalName)}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Billing type</label>
          <select className="input" value={v.billingType} onChange={(e) => set({ billingType: e.target.value })}>
            <option value="gst">GST</option>{nonGst && <option value="nonGst">Non-GST</option>}
          </select>
        </div>
        <div><label className="label">Date</label><DateInput value={v.date} onChange={(val) => set({ date: val })} /></div>
        <div><label className="label">Valid until</label><DateInput value={v.validUntil} onChange={(val) => set({ validUntil: val })} /></div>
        <div><label className="label">Place of supply</label><input className="input" value={v.placeOfSupply} onChange={(e) => set({ placeOfSupply: e.target.value })} /></div>
      </div>
      <div className="card p-4">
        <h2 className="mb-2 text-sm font-semibold">Priced items</h2>
        <LineItems lines={v.lines} onChange={(lines) => set({ lines })} gst={gst} showCost defaultTax={company.defaultGstRate ?? 18} />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="card p-4"><h2 className="mb-2 text-sm font-semibold">Discounts and charges</h2><AdjustmentsEditor adj={v.adj} onChange={(adj) => set({ adj })} gst={gst} /></div>
        <div className="card p-4"><h2 className="mb-2 text-sm font-semibold">Totals</h2><TotalsPanel lines={v.lines} adj={v.adj} gst={gst} intraState={intra} showCost /></div>
      </div>
      <div className="card grid gap-3 p-4 sm:grid-cols-2">
        <div><label className="label">Scope</label><textarea className="input min-h-24" value={v.scope} onChange={(e) => set({ scope: e.target.value })} /></div>
        <div><label className="label">Terms</label><textarea className="input min-h-24" value={v.terms} onChange={(e) => set({ terms: e.target.value })} /></div>
      </div>
      {err && <ErrorBox>{err}</ErrorBox>}
      <div className="flex gap-2">
        <button className="btn-primary" disabled={busy}>{busy ? "Saving…" : id ? "Save" : "Create quotation"}</button>
        <button type="button" className="btn" onClick={() => router.back()}>Cancel</button>
      </div>
    </form>
  );
}
