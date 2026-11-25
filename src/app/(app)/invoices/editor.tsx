"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AdjustmentsEditor, LineItems, TotalsPanel } from "@/components/line-items";
import { ErrorBox } from "@/components/ui";
import { useAuth } from "@/lib/auth-context";
import { useCollection } from "@/lib/hooks";
import { useCompany } from "@/lib/business";
import { createDoc, getDocOnce, today, updateDoc } from "@/lib/data";
import { computeTotals, sameState, type Adjustments, type Line } from "@/lib/tax";

export interface InvoiceDraft {
  date: string;
  dueDate: string;
  clientId: string;
  projectId: string;
  quotationId?: string | null;
  challanId?: string | null;
  billingType: string;
  placeOfSupply: string;
  lines: Line[];
  adj: Adjustments;
  notes: string;
  terms: string;
}

const addDays = (d: string, n: number) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x.toISOString().slice(0, 10);
};

export function InvoiceEditor({ id, initial }: { id?: string; initial?: Partial<InvoiceDraft> }) {
  const router = useRouter();
  const { nonGst } = useAuth();
  const company = useCompany();
  const { rows: clients } = useCollection("clients");
  const { rows: projects } = useCollection("projects", [], { gstAware: true });
  const [v, setV] = useState<InvoiceDraft>({
    date: today(), dueDate: addDays(today(), 30), clientId: "", projectId: "", billingType: "gst", placeOfSupply: "",
    lines: [], adj: { roundOff: true }, notes: "", terms: "", ...initial,
  });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (p: Partial<InvoiceDraft>) => setV((x) => ({ ...x, ...p }));

  // Client → place of supply, due date from payment terms; project → billing type (§9).
  useEffect(() => {
    if (!v.clientId) return;
    const c = clients.find((x) => x.id === v.clientId);
    if (!c) return;
    setV((x) => ({
      ...x,
      placeOfSupply: x.placeOfSupply || String(c.state ?? ""),
      dueDate: id ? x.dueDate : addDays(x.date, Number(c.paymentTermsDays ?? 30)),
      billingType: x.projectId ? x.billingType : String(c.billingType ?? x.billingType),
    }));
  }, [v.clientId, clients, id]);
  useEffect(() => {
    const p = projects.find((x) => x.id === v.projectId);
    if (p) setV((x) => ({ ...x, billingType: String(p.billingType ?? x.billingType), clientId: x.clientId || String(p.clientId ?? "") }));
  }, [v.projectId, projects]);
  useEffect(() => {
    if (!v.terms && company.invoiceTerms) setV((x) => ({ ...x, terms: company.invoiceTerms ?? "" }));
  }, [company.invoiceTerms, v.terms]);

  const gst = v.billingType === "gst";
  const intra = sameState(v.placeOfSupply, company.state);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!v.clientId) return setErr("Choose the client.");
    if (!v.lines.length) return setErr("Add at least one line.");
    if (gst && !company.state) return setErr("Set the company state under Settings → Company first (needed to choose CGST/SGST or IGST).");
    setBusy(true);
    try {
      const t = computeTotals(v.lines, v.adj, { gst, intraState: intra });
      const data = {
        ...v,
        lines: gst ? v.lines : v.lines.map((l) => ({ ...l, taxRate: 0, hsn: "" })),
        intraState: intra,
        total: t.total, taxable: t.taxable, tax: t.tax, cgst: t.cgst, sgst: t.sgst, igst: t.igst, due: t.due, byRate: t.byRate,
      };
      if (id) {
        await updateDoc("invoices", id, data);
        router.push(`/invoices/${id}`);
      } else {
        const client = await getDocOnce("clients", v.clientId);
        const newId = await createDoc("invoices", { ...data, status: "Draft", number: null, paid: 0, clientName: client?.displayName || client?.legalName || "" });
        router.push(`/invoices/${newId}`);
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
          <label className="label">Client *</label>
          <select className="input" required value={v.clientId} onChange={(e) => set({ clientId: e.target.value, placeOfSupply: "" })}>
            <option value="">—</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{String(c.displayName || c.legalName)}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Project</label>
          <select className="input" value={v.projectId} onChange={(e) => set({ projectId: e.target.value })}>
            <option value="">— none —</option>
            {projects.filter((p) => !v.clientId || p.clientId === v.clientId).map((p) => <option key={p.id} value={p.id}>{String(p.code)} · {String(p.name)}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Billing type</label>
          <select className="input" value={v.billingType} onChange={(e) => set({ billingType: e.target.value })}>
            <option value="gst">GST invoice</option>
            {nonGst && <option value="nonGst">Non-GST bill</option>}
          </select>
        </div>
        <div>
          <label className="label">Place of supply (state)</label>
          <input className="input" value={v.placeOfSupply} onChange={(e) => set({ placeOfSupply: e.target.value })} />
          {gst && <div className="mt-1 text-xs text-muted">{intra ? "Same state: CGST + SGST" : "Other state: IGST"}</div>}
        </div>
        <div><label className="label">Invoice date</label><input className="input" type="date" value={v.date} onChange={(e) => set({ date: e.target.value })} /></div>
        <div><label className="label">Due date</label><input className="input" type="date" value={v.dueDate} onChange={(e) => set({ dueDate: e.target.value })} /></div>
      </div>
      <div className="card p-4">
        <h2 className="mb-2 text-sm font-semibold">Items</h2>
        <LineItems lines={v.lines} onChange={(lines) => set({ lines })} gst={gst} defaultTax={company.defaultGstRate ?? 18} />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="card p-4">
          <h2 className="mb-2 text-sm font-semibold">Discounts and adjustments</h2>
          <AdjustmentsEditor adj={v.adj} onChange={(adj) => set({ adj })} gst={gst} allowAdvance />
        </div>
        <div className="card p-4">
          <h2 className="mb-2 text-sm font-semibold">Totals</h2>
          <TotalsPanel lines={v.lines} adj={v.adj} gst={gst} intraState={intra} />
        </div>
      </div>
      <div className="card grid gap-3 p-4 sm:grid-cols-2">
        <div><label className="label">Notes</label><textarea className="input min-h-20" value={v.notes} onChange={(e) => set({ notes: e.target.value })} /></div>
        <div><label className="label">Terms</label><textarea className="input min-h-20" value={v.terms} onChange={(e) => set({ terms: e.target.value })} /></div>
      </div>
      {err && <ErrorBox>{err}</ErrorBox>}
      <div className="flex gap-2">
        <button className="btn-primary" disabled={busy}>{busy ? "Saving…" : id ? "Save draft" : "Create draft"}</button>
        <button type="button" className="btn" onClick={() => router.back()}>Cancel</button>
      </div>
    </form>
  );
}
