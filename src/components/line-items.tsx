"use client";

import { Plus, Trash2 } from "lucide-react";
import { useCollection } from "@/lib/hooks";
import { computeTotals, type Adjustments, type Charge, type Line } from "@/lib/tax";
import { inr } from "@/lib/data";

const GST_RATES = [0, 5, 12, 18, 28];

export function LineItems({
  lines,
  onChange,
  gst,
  showDiscount = true,
  showCost = false,
  defaultTax = 18,
  readOnly,
}: {
  lines: Line[];
  onChange: (l: Line[]) => void;
  gst: boolean;
  showDiscount?: boolean;
  showCost?: boolean;
  defaultTax?: number;
  readOnly?: boolean;
}) {
  const { rows: items } = useCollection("items");
  const set = (i: number, patch: Partial<Line>) => onChange(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const pickItem = (i: number, itemId: string) => {
    const it = items.find((x) => x.id === itemId);
    if (!it) return set(i, { itemId: null });
    set(i, { itemId, description: String(it.name), hsn: String(it.hsn ?? ""), unit: String(it.unit ?? "Nos"), rate: Number(it.rate ?? 0) || lines[i].rate });
  };
  return (
    <div className="overflow-x-auto">
      <table className="table min-w-[760px]">
        <thead>
          <tr>
            <th className="w-40">Item</th>
            <th>Description</th>
            {gst && <th className="w-24">HSN/SAC</th>}
            <th className="w-20 text-right">Qty</th>
            <th className="w-20">Unit</th>
            <th className="w-28 text-right">Rate</th>
            {showDiscount && <th className="w-32">Discount</th>}
            {gst && <th className="w-20">GST %</th>}
            {showCost && <th className="w-28 text-right">Est. cost</th>}
            <th className="w-28 text-right">Amount</th>
            {!readOnly && <th className="w-8" />}
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => {
            const gross = (Number(l.qty) || 0) * (Number(l.rate) || 0);
            const d = Number(l.disc) || 0;
            const net = gross - (l.discType === "amt" ? d : (gross * d) / 100);
            return (
              <tr key={i} className="align-top">
                <td>
                  <select className="input !py-1" disabled={readOnly} value={l.itemId ?? ""} onChange={(e) => pickItem(i, e.target.value)}>
                    <option value="">— free text —</option>
                    {items.map((it) => <option key={it.id} value={it.id}>{String(it.code ?? "")} {String(it.name)}</option>)}
                  </select>
                </td>
                <td><textarea className="input !py-1 min-h-9" rows={1} disabled={readOnly} value={l.description} onChange={(e) => set(i, { description: e.target.value })} required /></td>
                {gst && <td><input className="input !py-1" disabled={readOnly} value={l.hsn ?? ""} onChange={(e) => set(i, { hsn: e.target.value })} /></td>}
                <td><input className="input !py-1 text-right" type="number" step="any" disabled={readOnly} value={l.qty} onChange={(e) => set(i, { qty: Number(e.target.value) })} /></td>
                <td><input className="input !py-1" disabled={readOnly} value={l.unit ?? ""} onChange={(e) => set(i, { unit: e.target.value })} /></td>
                <td><input className="input !py-1 text-right" type="number" step="0.01" disabled={readOnly} value={l.rate} onChange={(e) => set(i, { rate: Number(e.target.value) })} /></td>
                {showDiscount && (
                  <td>
                    <div className="flex gap-1">
                      <input className="input !py-1 text-right" type="number" step="0.01" disabled={readOnly} value={l.disc ?? ""} onChange={(e) => set(i, { disc: Number(e.target.value) })} />
                      <select className="input !w-14 !px-1 !py-1" disabled={readOnly} value={l.discType ?? "pct"} onChange={(e) => set(i, { discType: e.target.value as "pct" | "amt" })}>
                        <option value="pct">%</option><option value="amt">₹</option>
                      </select>
                    </div>
                  </td>
                )}
                {gst && (
                  <td>
                    <select className="input !py-1" disabled={readOnly} value={l.taxRate ?? defaultTax} onChange={(e) => set(i, { taxRate: Number(e.target.value) })}>
                      {GST_RATES.map((r) => <option key={r} value={r}>{r}%</option>)}
                    </select>
                  </td>
                )}
                {showCost && <td><input className="input !py-1 text-right" type="number" step="0.01" disabled={readOnly} value={l.cost ?? ""} onChange={(e) => set(i, { cost: Number(e.target.value) })} /></td>}
                <td className="text-right tabular-nums">{inr(net)}</td>
                {!readOnly && <td><button type="button" className="text-muted hover:text-danger" onClick={() => onChange(lines.filter((_, j) => j !== i))} aria-label="Remove line"><Trash2 size={14} /></button></td>}
              </tr>
            );
          })}
        </tbody>
      </table>
      {!readOnly && (
        <button type="button" className="btn mt-2" onClick={() => onChange([...lines, { description: "", qty: 1, unit: "Nos", rate: 0, discType: "pct", disc: 0, taxRate: defaultTax }])}>
          <Plus size={14} /> Add line
        </button>
      )}
    </div>
  );
}

export function AdjustmentsEditor({ adj, onChange, gst, allowAdvance, readOnly }: { adj: Adjustments; onChange: (a: Adjustments) => void; gst: boolean; allowAdvance?: boolean; readOnly?: boolean }) {
  const charges = adj.charges ?? [];
  const setCharge = (i: number, p: Partial<Charge>) => onChange({ ...adj, charges: charges.map((c, j) => (j === i ? { ...c, ...p } : c)) });
  return (
    <div className="space-y-3 text-sm">
      <div className="flex items-center gap-2">
        <span className="w-32 text-muted">Overall discount</span>
        <input className="input !w-28 !py-1 text-right" type="number" step="0.01" disabled={readOnly} value={adj.overallDisc ?? ""} onChange={(e) => onChange({ ...adj, overallDisc: Number(e.target.value) })} />
        <select className="input !w-16 !py-1" disabled={readOnly} value={adj.overallDiscType ?? "pct"} onChange={(e) => onChange({ ...adj, overallDiscType: e.target.value as "pct" | "amt" })}>
          <option value="pct">%</option><option value="amt">₹</option>
        </select>
      </div>
      {charges.map((c, i) => (
        <div key={i} className="flex items-center gap-2">
          <select className="input !w-32 !py-1" disabled={readOnly} value={c.label} onChange={(e) => setCharge(i, { label: e.target.value })}>
            {["Freight", "Packing", "Installation", "Insurance", "Other charges"].map((x) => <option key={x}>{x}</option>)}
          </select>
          <input className="input !w-28 !py-1 text-right" type="number" step="0.01" disabled={readOnly} value={c.amount} onChange={(e) => setCharge(i, { amount: Number(e.target.value) })} />
          {gst && (
            <select className="input !w-20 !py-1" disabled={readOnly} value={c.taxRate ?? 18} onChange={(e) => setCharge(i, { taxRate: Number(e.target.value) })}>
              {GST_RATES.map((r) => <option key={r} value={r}>{r}%</option>)}
            </select>
          )}
          {!readOnly && <button type="button" className="text-muted hover:text-danger" onClick={() => onChange({ ...adj, charges: charges.filter((_, j) => j !== i) })}><Trash2 size={14} /></button>}
        </div>
      ))}
      {!readOnly && <button type="button" className="btn !py-1" onClick={() => onChange({ ...adj, charges: [...charges, { label: "Freight", amount: 0, taxRate: 18 }] })}><Plus size={13} /> Add charge</button>}
      <label className="flex items-center gap-2"><input type="checkbox" disabled={readOnly} checked={Boolean(adj.roundOff)} onChange={(e) => onChange({ ...adj, roundOff: e.target.checked })} /> Round off</label>
      {allowAdvance && (
        <div className="flex items-center gap-2">
          <span className="w-32 text-muted">Advance adjusted</span>
          <input className="input !w-28 !py-1 text-right" type="number" step="0.01" disabled={readOnly} value={adj.advance ?? ""} onChange={(e) => onChange({ ...adj, advance: Number(e.target.value) })} />
        </div>
      )}
    </div>
  );
}

export function TotalsPanel({ lines, adj, gst, intraState, showCost }: { lines: Line[]; adj: Adjustments; gst: boolean; intraState: boolean; showCost?: boolean }) {
  const t = computeTotals(lines, adj, { gst, intraState });
  const row = (k: string, v: number, strong?: boolean) => (
    <div className={`flex justify-between py-0.5 ${strong ? "border-t border-border pt-1.5 font-semibold" : ""}`}>
      <span className={strong ? "" : "text-muted"}>{k}</span>
      <span className="tabular-nums">{inr(v)}</span>
    </div>
  );
  const margin = t.taxable - t.cost;
  return (
    <div className="text-sm">
      {row("Subtotal", t.subtotal)}
      {t.overallDiscount > 0 && row("Overall discount", -t.overallDiscount)}
      {t.chargesTotal > 0 && row("Charges", t.chargesTotal)}
      {row("Taxable value", t.taxable)}
      {gst && (intraState ? <>{row("CGST", t.cgst)}{row("SGST", t.sgst)}</> : row("IGST", t.igst))}
      {t.roundOff !== 0 && row("Round off", t.roundOff)}
      {row("Total", t.total, true)}
      {t.advance > 0 && <>{row("Less advance", -t.advance)}{row("Amount due", t.due, true)}</>}
      {showCost && t.cost > 0 && (
        <div className="mt-2 rounded-md bg-surface-2 p-2 text-xs">
          Estimated cost {inr(t.cost)} · margin {inr(margin)} ({t.taxable ? Math.round((margin / t.taxable) * 100) : 0}%)
        </div>
      )}
    </div>
  );
}
