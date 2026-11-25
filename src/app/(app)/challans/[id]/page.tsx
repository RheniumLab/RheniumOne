"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { FileText, RotateCcw } from "lucide-react";
import { EwayBill } from "@/components/eway";
import { Badge, Empty, ErrorBox, NoAccess, PageHeader, Spinner } from "@/components/ui";
import { useAuth } from "@/lib/auth-context";
import { useDoc } from "@/lib/hooks";
import { getCompany } from "@/lib/business";
import { createDoc, fmtDate, today, updateDoc } from "@/lib/data";
import { sectionsDocHtml } from "@/lib/doc-html";
import { makePdf, openDrive } from "@/lib/files";
import { addDocRecord } from "@/lib/docs";
import { LOCATIONS } from "@/lib/stock";

interface CLine { itemId?: string; description: string; qty: number; unit?: string; returned?: number }

export default function ChallanPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useAuth();
  const { data: c, loading } = useDoc("challans", id);
  const [ret, setRet] = useState<number[] | null>(null);
  const [loc, setLoc] = useState("Store");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!can("challans", "view")) return <NoAccess />;
  if (loading) return <Spinner />;
  if (!c) return <Empty>Challan not found.</Empty>;
  const lines = c.lines as CLine[];

  const pdf = async () => {
    setBusy(true);
    setErr(null);
    try {
      const company = await getCompany();
      const html = sectionsDocHtml({
        company, title: "Delivery Challan",
        meta: [["Challan no.", c.number], ["Date", fmtDate(c.date)], ["Consignee", c.consignee], ["Address", c.address], ["Purpose", c.purpose], ["Returnable", c.returnable ? `Yes, by ${fmtDate(c.expectedReturn)}` : "No"], ["Vehicle", c.vehicle || (c.eway as Record<string, string>)?.vehicle || ""], ["E-way bill", (c.eway as Record<string, string>)?.no ?? ""]],
        sections: [["Notes", "Not for sale. Goods sent for the purpose stated above."]],
        tables: [{ title: "Items", head: ["#", "Description", "Qty", "Unit"], rows: lines.map((l, i) => [i + 1, l.description, l.qty, l.unit ?? ""]) }],
      });
      const name = String(c.number).replace(/\//g, "-");
      const { driveId, fileId } = await makePdf(html, name, { folder: "Challans", linked: { col: "challans", id } });
      await updateDoc("challans", id, { pdfDriveId: driveId }, c);
      if (c.projectId) await addDocRecord({ name: `${name}.pdf`, folder: "Commercial", projectId: String(c.projectId), clientId: (c.clientId as string) ?? null, linked: { col: "challans", id }, fileId, driveId, mime: "application/pdf" });
      await openDrive(driveId);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
    setBusy(false);
  };

  const saveReturn = async () => {
    if (!ret) return;
    setBusy(true);
    for (let i = 0; i < lines.length; i++)
      if (ret[i] > 0 && lines[i].itemId) await createDoc("stockMoves", { itemId: lines[i].itemId, qty: ret[i], location: loc, type: "Return", projectId: c.projectId ?? null, ref: { col: "challans", id }, date: today(), note: `Returned on ${c.number}` });
    const nl = lines.map((l, i) => ({ ...l, returned: Number(l.returned || 0) + (ret[i] || 0) }));
    const all = nl.every((l) => l.returned >= l.qty);
    await updateDoc("challans", id, { lines: nl, status: all ? "Returned" : "Partly returned" }, c);
    setRet(null);
    setBusy(false);
  };

  return (
    <div className="space-y-4">
      <PageHeader
        back="/challans"
        title={String(c.number)}
        subtitle={<span className="flex flex-wrap items-center gap-2">{String(c.purpose)} · {String(c.consignee)} <Badge>{String(c.status)}</Badge>{c.projectId ? <Link className="text-brand hover:underline" href={`/projects/${c.projectId}`}>Project →</Link> : null}</span>}
        actions={
          <>
            {c.pdfDriveId ? <button className="btn" onClick={() => openDrive(String(c.pdfDriveId))}><FileText size={14} /> PDF</button> : <button className="btn-primary" disabled={busy} onClick={pdf}><FileText size={14} /> {busy ? "Working…" : "Make PDF"}</button>}
            {c.returnable && c.status !== "Returned" && can("challans", "edit") && <button className="btn" onClick={() => setRet(lines.map((l) => l.qty - Number(l.returned || 0)))}><RotateCcw size={14} /> Record return</button>}
            {!c.returnable && can("invoices", "create") && <Link className="btn" href={`/invoices/new?challanId=${id}`}>Create invoice</Link>}
            {c.status !== "Closed" && can("challans", "edit") && <button className="btn" onClick={() => updateDoc("challans", id, { status: "Closed" }, c)}>Close</button>}
          </>
        }
      />
      {err && <ErrorBox>{err}</ErrorBox>}
      {ret && (
        <div className="card space-y-3 p-4">
          <div className="flex items-center gap-2 text-sm">Returned into <select className="input !w-auto" value={loc} onChange={(e) => setLoc(e.target.value)}>{LOCATIONS.map((l) => <option key={l}>{l}</option>)}</select></div>
          <table className="table">
            <thead><tr><th>Item</th><th className="text-right">Sent</th><th className="text-right">Returned</th><th className="w-28">Now</th></tr></thead>
            <tbody>{lines.map((l, i) => <tr key={i}><td>{l.description}</td><td className="text-right">{l.qty}</td><td className="text-right">{Number(l.returned || 0)}</td><td><input className="input !py-1 text-right" type="number" step="any" value={ret[i]} onChange={(e) => setRet(ret.map((x, j) => (j === i ? Number(e.target.value) : x)))} /></td></tr>)}</tbody>
          </table>
          <button className="btn-primary" disabled={busy} onClick={saveReturn}>Save return</button>
        </div>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        <div className="card p-4 text-sm">
          <h2 className="mb-2 font-semibold">Items</h2>
          <table className="table">
            <thead><tr><th>Description</th><th className="text-right">Qty</th>{c.returnable ? <th className="text-right">Returned</th> : null}</tr></thead>
            <tbody>{lines.map((l, i) => <tr key={i}><td>{l.description}</td><td className="text-right">{l.qty} {l.unit}</td>{c.returnable ? <td className="text-right">{Number(l.returned || 0)}</td> : null}</tr>)}</tbody>
          </table>
          <div className="mt-3 text-xs text-muted">From {String(c.fromLocation)} · {fmtDate(c.date)}{c.address ? ` · to ${c.address}` : ""}</div>
        </div>
        <EwayBill id={id} col="challans" eway={(c.eway ?? {}) as Record<string, string>} editable={can("challans", "edit")} />
      </div>
    </div>
  );
}
