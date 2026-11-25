"use client";

import { useState } from "react";
import { updateDoc } from "@/lib/data";
import { DateInput } from "@/components/date-input";

/** E-way bill details recorded from the government portal (§7.6). */
export function EwayBill({ id, eway, editable, col = "invoices" }: { id: string; eway: Record<string, string>; editable: boolean; col?: string }) {
  const [v, setV] = useState({ no: eway.no ?? "", date: eway.date ?? "", vehicle: eway.vehicle ?? "", transporter: eway.transporter ?? "" });
  const [saved, setSaved] = useState(false);
  return (
    <form className="card space-y-2 p-4" onSubmit={async (e) => { e.preventDefault(); await updateDoc(col, id, { eway: v }); setSaved(true); }}>
      <h2 className="text-sm font-semibold">E-way bill</h2>
      <p className="text-xs text-muted">Generate it on ewaybillgst.gov.in, then record it here.</p>
      <div className="grid grid-cols-2 gap-2">
        <input className="input" placeholder="E-way bill no." disabled={!editable} value={v.no} onChange={(e) => { setV({ ...v, no: e.target.value }); setSaved(false); }} />
        <DateInput disabled={!editable} value={v.date} onChange={(val) => { setV({ ...v, date: val }); setSaved(false); }} />
        <input className="input" placeholder="Vehicle no." disabled={!editable} value={v.vehicle} onChange={(e) => { setV({ ...v, vehicle: e.target.value.toUpperCase() }); setSaved(false); }} />
        <input className="input" placeholder="Transporter" disabled={!editable} value={v.transporter} onChange={(e) => { setV({ ...v, transporter: e.target.value }); setSaved(false); }} />
      </div>
      {editable && <button className="btn">{saved ? "Saved" : "Save e-way bill"}</button>}
    </form>
  );
}
