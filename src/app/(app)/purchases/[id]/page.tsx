"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { increment, where } from "firebase/firestore";
import { Camera, FileText, Mail, MessageCircle, PackageCheck, Paperclip, Pencil, Receipt, Send } from "lucide-react";
import { CategorySelect } from "@/components/category-select";
import { LineItems, TotalsPanel } from "@/components/line-items";
import { Badge, Empty, ErrorBox, GstBadge, NoAccess, PageHeader, Spinner, Stat } from "@/components/ui";
import { useAuth } from "@/lib/auth-context";
import { useCollection, useDoc } from "@/lib/hooks";
import { assignNumber, fySeries, getCompany, requestApproval } from "@/lib/business";
import { createDoc, fmtDate, getDocOnce, inr, today, updateDoc, type Doc } from "@/lib/data";
import { commercialDocHtml } from "@/lib/doc-html";
import { makePdf, openDrive, openFile, saveFile, shareDoc } from "@/lib/files";
import { addDocRecord, vendorFolder } from "@/lib/docs";
import { MODES } from "@/lib/money";
import type { Line } from "@/lib/tax";
import { PoEditor } from "../editor";
import { DateInput } from "@/components/date-input";

type PoLine = Line & { received?: number };

export default function PoPage() {
  const { id } = useParams<{ id: string }>();
  const { can, isAdmin } = useAuth();
  const { data: po, loading, error } = useDoc("pos", id);
  const { data: vendor } = useDoc("vendors", po?.vendorId);
  const grns = useCollection("grns", [where("poId", "==", id)], {}, [id]);
  const bills = useCollection("purchaseBills", [where("poId", "==", id)], { gstAware: true }, [id]);
  const [editing, setEditing] = useState(false);
  const [panel, setPanel] = useState<"grn" | "bill" | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  if (!can("purchases", "view")) return <NoAccess />;
  if (loading) return <Spinner />;
  if (error) return <ErrorBox>{error}</ErrorBox>;
  if (!po) return <Empty>Purchase order not found.</Empty>;

  if (editing && po.status === "Draft") {
    return <div><PageHeader title="Edit draft PO" back={`/purchases/${id}`} /><PoEditor id={id} initial={po as never} /></div>;
  }

  async function run(label: string, fn: () => Promise<unknown>) {
    setBusy(label);
    setErr(null);
    try {
      await fn();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
    setBusy(null);
  }

  /** Numbered on submit; above the set amount it waits for approval (§7.3, §10.1). */
  const submit = () =>
    run("submit", async () => {
      const number = await assignNumber("pos", id, fySeries("po", "PO", new Date(String(po.date))), { status: "Pending approval" });
      if (isAdmin) return updateDoc("pos", id, { status: "Approved" });
      const r = await requestApproval({ type: "po", col: "pos", docId: id, amount: Number(po.total), summary: `${number} to ${po.vendorName} — ${inr(Number(po.total))}`, link: `/purchases/${id}` });
      if (r === "none") await updateDoc("pos", id, { status: "Approved" });
    });

  const makePoPdf = () =>
    run("pdf", async () => {
      const company = await getCompany();
      const v = await getDocOnce("vendors", String(po.vendorId));
      const project = po.projectId ? await getDocOnce("projects", String(po.projectId)) : null;
      const gst = po.billingType === "gst";
      const html = commercialDocHtml({
        company, title: "Purchase Order", partyLabel: "Vendor",
        party: { name: String(v?.name ?? ""), address: String(v?.address ?? ""), gstin: gst ? String(v?.gstin ?? "") : "", state: String(v?.state ?? "") },
        meta: [["PO no.", po.number], ["Date", fmtDate(po.date)], ["Delivery by", fmtDate(po.expectedDate)], ["Deliver to", po.deliveryAddress], ...(project ? ([["Project", `${project.code} ${project.name}`]] as [string, unknown][]) : [])],
        lines: po.lines as Line[], adj: (po.adj ?? {}) as never, gst, intraState: Boolean(po.intraState), notes: String(po.notes ?? ""), terms: String(po.terms ?? ""),
      });
      const name = String(po.number).replace(/\//g, "-");
      const { driveId, fileId } = await makePdf(html, name, { folder: `${vendorFolder(v)}/Purchase orders`, billingType: String(po.billingType), linked: { col: "pos", id } });
      await updateDoc("pos", id, { pdfDriveId: driveId, status: po.status === "Approved" ? "Sent" : po.status }, po);
      if (po.projectId) await addDocRecord({ name: `${name}.pdf`, folder: "Commercial", projectId: String(po.projectId), linked: { col: "pos", id }, fileId, driveId, billingType: String(po.billingType), mime: "application/pdf" });
      await openDrive(driveId);
    });

  const share = (via: "whatsapp" | "email") =>
    run(via, async () => {
      const c = ((vendor?.contacts ?? []) as Record<string, string>[])[0];
      await shareDoc(String(po.pdfDriveId), via, `Purchase order ${po.number}`, { phone: c?.phone, email: c?.email });
    });

  const lines = po.lines as PoLine[];
  const gst = po.billingType === "gst";
  const canReceive = ["Approved", "Sent", "Partly received"].includes(String(po.status)) && can("purchases", "edit");
  const billed = bills.rows.reduce((s, b) => s + Number(b.total || 0), 0);
  const paid = bills.rows.reduce((s, b) => s + Number(b.paid || 0), 0);

  return (
    <div className="space-y-4">
      <PageHeader
        back="/purchases"
        title={po.number ? String(po.number) : "Draft PO"}
        subtitle={<span className="flex flex-wrap items-center gap-2">{String(po.vendorName)}<GstBadge type={String(po.billingType)} /><Badge>{String(po.status)}</Badge>{po.projectId ? <Link className="text-brand hover:underline" href={`/projects/${po.projectId}`}>Project →</Link> : <span className="text-muted">Company</span>}</span>}
        actions={
          <>
            {po.status === "Draft" && can("purchases", "edit") && <button className="btn" onClick={() => setEditing(true)}><Pencil size={14} /> Edit</button>}
            {po.status === "Draft" && can("purchases", "edit") && <button className="btn-primary" disabled={!!busy} onClick={submit}><Send size={14} /> Submit</button>}
            {["Approved", "Sent", "Partly received", "Received"].includes(String(po.status)) && (
              po.pdfDriveId
                ? <button className="btn" onClick={() => openDrive(String(po.pdfDriveId))}><FileText size={14} /> PDF</button>
                : <button className="btn-primary" disabled={!!busy} onClick={makePoPdf}><FileText size={14} /> {busy === "pdf" ? "Making PDF…" : "Make PDF & mark sent"}</button>
            )}
            {po.pdfDriveId ? <><button className="btn" onClick={() => share("whatsapp")}><MessageCircle size={14} /> WhatsApp</button><button className="btn" onClick={() => share("email")}><Mail size={14} /> Email</button></> : null}
            {canReceive && <button className="btn-primary" onClick={() => setPanel(panel === "grn" ? null : "grn")}><PackageCheck size={14} /> Receive goods</button>}
            {["Sent", "Partly received", "Received", "Approved"].includes(String(po.status)) && can("purchases", "edit") && <button className="btn" onClick={() => setPanel(panel === "bill" ? null : "bill")}><Receipt size={14} /> Record vendor bill</button>}
            {["Draft", "Approved", "Sent"].includes(String(po.status)) && !grns.rows.length && can("purchases", "delete") && (
              <button className="btn-danger" onClick={() => confirm("Cancel this PO?") && run("cancel", () => updateDoc("pos", id, { status: "Cancelled" }, po))}>Cancel PO</button>
            )}
          </>
        }
      />
      {err && <ErrorBox>{err}</ErrorBox>}
      {po.status === "Pending approval" && <div className="rounded-md bg-warn/15 px-3 py-2 text-sm text-warn">Waiting for approval. It can be sent to the vendor once approved.</div>}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="PO value" value={inr(Number(po.total))} />
        <Stat label="Billed by vendor" value={inr(billed)} />
        <Stat label="Paid" value={inr(paid)} />
        <Stat label="Payable" value={inr(billed - paid)} />
      </div>
      {panel === "grn" && <GrnForm po={po} lines={lines} onDone={() => setPanel(null)} />}
      {panel === "bill" && <BillForm po={po} vendor={vendor} onDone={() => setPanel(null)} />}
      <div className="card p-4">
        <LineItems lines={lines} onChange={() => {}} gst={gst} readOnly />
        <div className="mt-3 grid gap-4 md:grid-cols-2">
          <table className="table">
            <thead><tr><th>Line</th><th className="text-right">Ordered</th><th className="text-right">Received</th></tr></thead>
            <tbody>{lines.map((l, i) => <tr key={i}><td>{l.description}</td><td className="text-right">{l.qty}</td><td className={`text-right ${Number(l.received || 0) >= l.qty ? "text-ok" : ""}`}>{Number(l.received || 0)}</td></tr>)}</tbody>
          </table>
          <TotalsPanel lines={lines} adj={(po.adj ?? {}) as never} gst={gst} intraState={Boolean(po.intraState)} />
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="card p-4">
          <h2 className="mb-2 text-sm font-semibold">Goods receipts</h2>
          {!grns.rows.length ? <div className="text-sm text-muted">Nothing received yet.</div> : grns.rows.map((g) => (
            <div key={g.id} className="border-b border-border py-1.5 text-sm last:border-0">
              <b>{String(g.number)}</b> · {fmtDate(g.date)} · {String(g.location)}
              <div className="text-xs text-muted">{((g.lines ?? []) as Record<string, unknown>[]).map((l) => `${l.description} × ${l.qty}`).join(", ")}</div>
            </div>
          ))}
        </div>
        <div className="card p-4">
          <h2 className="mb-2 text-sm font-semibold">Vendor bills</h2>
          {!bills.rows.length ? <div className="text-sm text-muted">No bills recorded.</div> : bills.rows.map((b) => <BillRow key={b.id} bill={b} po={po} />)}
        </div>
      </div>
    </div>
  );
}

/** GRN: what actually arrived, incl. partial deliveries. Items go into stock (§7.3). */
function GrnForm({ po, lines, onDone }: { po: Doc; lines: PoLine[]; onDone: () => void }) {
  const [qty, setQty] = useState<number[]>(lines.map((l) => Math.max(0, l.qty - Number(l.received || 0))));
  const [location, setLocation] = useState(po.projectId ? "Site" : "Store");
  const [date, setDate] = useState(today());
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form className="card space-y-3 p-4" onSubmit={async (e) => {
      e.preventDefault();
      if (!qty.some((q) => q > 0)) return setErr("Enter the quantity received.");
      setBusy(true);
      try {
        const grnLines = lines.map((l, i) => ({ poLine: i, itemId: l.itemId ?? null, description: l.description, qty: qty[i], unit: l.unit ?? "" })).filter((l) => l.qty > 0);
        const grnId = await createDoc("grns", { poId: po.id, poNumber: po.number, vendorId: po.vendorId, vendorName: po.vendorName, projectId: po.projectId ?? null, date, location, lines: grnLines }, fySeries("grn", "GRN", new Date(date)));
        for (const l of grnLines)
          if (l.itemId) await createDoc("stockMoves", { itemId: l.itemId, qty: l.qty, location, type: "GRN", projectId: po.projectId ?? null, ref: { col: "grns", id: grnId }, date, note: `${po.number}` });
        const newLines = lines.map((l, i) => ({ ...l, received: Number(l.received || 0) + (qty[i] || 0) }));
        const all = newLines.every((l) => l.received >= l.qty);
        await updateDoc("pos", po.id, { lines: newLines, status: all ? "Received" : "Partly received" }, po);
        // Required-asset purchases: add to the asset register and close the request (§7.5).
        if (po.assetRequestId && all) {
          const req = await getDocOnce("assetRequests", String(po.assetRequestId));
          await createDoc("assets", { name: String(req?.item ?? lines[0].description), status: "In use", purchaseDate: date, value: Number(po.taxable ?? po.total), vendorId: po.vendorId, location, assetType: "Other", notes: `From ${po.number}`, poId: po.id }, { counter: "asset", field: "code", format: (n) => `RA-${String(n).padStart(4, "0")}` });
          await updateDoc("assetRequests", String(po.assetRequestId), { status: "Received" });
        }
        onDone();
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
        setBusy(false);
      }
    }}>
      <h2 className="text-sm font-semibold">Receive goods</h2>
      <div className="flex flex-wrap gap-3">
        <div><label className="label">Date</label><DateInput value={date} onChange={(val) => setDate(val)} /></div>
        <div><label className="label">Into location</label><select className="input" value={location} onChange={(e) => setLocation(e.target.value)}>{["Office", "Store", "Site"].map((l) => <option key={l}>{l}</option>)}</select></div>
      </div>
      <table className="table">
        <thead><tr><th>Line</th><th className="text-right">Ordered</th><th className="text-right">Already received</th><th className="w-32">Received now</th></tr></thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={i}>
              <td>{l.description}{!l.itemId && <span className="ml-1 text-xs text-muted">(not a stock item)</span>}</td>
              <td className="text-right">{l.qty}</td>
              <td className="text-right">{Number(l.received || 0)}</td>
              <td><input className="input !py-1 text-right" type="number" step="any" min={0} value={qty[i]} onChange={(e) => setQty(qty.map((q, j) => (j === i ? Number(e.target.value) : q)))} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      {err && <ErrorBox>{err}</ErrorBox>}
      <button className="btn-primary" disabled={busy}>{busy ? "Saving…" : "Save goods receipt"}</button>
    </form>
  );
}

/** The vendor's bill against the PO, with a mandatory bill photo or PDF (§7.3). */
function BillForm({ po, vendor, onDone }: { po: Doc; vendor: Doc | null; onDone: () => void }) {
  const due = new Date();
  due.setDate(due.getDate() + Number(vendor?.paymentTermsDays ?? 30));
  const [v, setV] = useState({ billNo: "", billDate: today(), dueDate: due.toISOString().slice(0, 10), taxable: String(po.taxable ?? ""), tax: String(po.tax ?? ""), category: po.projectId ? "Raw material & components" : "Office supplies" });
  const [file, setFile] = useState<File | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const total = (Number(v.taxable) || 0) + (Number(v.tax) || 0);
  return (
    <form className="card grid gap-3 p-4 sm:grid-cols-3" onSubmit={async (e) => {
      e.preventDefault();
      if (!file) return setErr("Attach the vendor’s bill (photo or PDF).");
      setBusy(true);
      try {
        const fileId = await saveFile(file, { folder: `${vendorFolder(vendor)}/Bills`, billingType: String(po.billingType) });
        await createDoc("purchaseBills", {
          vendorId: po.vendorId, vendorName: po.vendorName, vendorGstin: vendor?.gstin ?? null, poId: po.id, poNumber: po.number,
          projectId: po.projectId ?? null, scope: po.projectId ? "project" : "company", category: v.category,
          billNo: v.billNo, billDate: v.billDate, dueDate: v.dueDate, taxable: Number(v.taxable) || 0, tax: Number(v.tax) || 0, total,
          billingType: po.billingType, fileId, paid: 0, status: "Unpaid",
        });
        onDone();
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
        setBusy(false);
      }
    }}>
      <h2 className="text-sm font-semibold sm:col-span-3">Record vendor bill</h2>
      <div><label className="label">Bill number *</label><input className="input" required value={v.billNo} onChange={(e) => setV({ ...v, billNo: e.target.value })} /></div>
      <div><label className="label">Bill date</label><DateInput value={v.billDate} onChange={(val) => setV({ ...v, billDate: val })} /></div>
      <div><label className="label">Due date</label><DateInput value={v.dueDate} onChange={(val) => setV({ ...v, dueDate: val })} /></div>
      <div><label className="label">Taxable value</label><input className="input" type="number" step="0.01" required value={v.taxable} onChange={(e) => setV({ ...v, taxable: e.target.value })} /></div>
      <div><label className="label">Tax (GST)</label><input className="input" type="number" step="0.01" value={v.tax} onChange={(e) => setV({ ...v, tax: e.target.value })} /></div>
      <div><label className="label">Total</label><div className="whitespace-nowrap input bg-surface-2 tabular-nums">{inr(total)}</div></div>
      <div><label className="label">Expense head</label><CategorySelect type={po.projectId ? "project" : "company"} value={v.category} onChange={(x) => setV({ ...v, category: x })} /></div>
      <div className="sm:col-span-2 self-end">
        <label className="btn cursor-pointer"><Camera size={15} /> {file ? file.name : "Bill photo / PDF *"}<input type="file" className="hidden" accept="image/*,application/pdf" capture="environment" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></label>
      </div>
      {err && <div className="sm:col-span-3"><ErrorBox>{err}</ErrorBox></div>}
      <div className="sm:col-span-3"><button className="btn-primary" disabled={busy}>{busy ? "Saving…" : "Save bill"}</button></div>
    </form>
  );
}

/** Paying a vendor bill posts to cash flow (§7.3, §8.4). */
function BillRow({ bill, po }: { bill: Doc; po: Doc }) {
  const { can } = useAuth();
  const { rows: accounts } = useCollection("accounts");
  const [paying, setPaying] = useState(false);
  const bal = Number(bill.total) - Number(bill.paid || 0);
  const [v, setV] = useState({ amount: String(bal), accountId: "", mode: "Bank transfer", date: today() });
  return (
    <div className="border-b border-border py-2 text-sm last:border-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span><b>{String(bill.billNo)}</b> · {fmtDate(bill.billDate)} · {inr(Number(bill.total))} <Badge>{String(bill.status)}</Badge></span>
        <span className="flex gap-2">
          <button className="text-muted hover:text-brand" title="View bill" onClick={() => openFile(String(bill.fileId))}><Paperclip size={14} /></button>
          {bal > 0 && can("cashflow", "create") && <button className="btn !py-1" onClick={() => setPaying(!paying)}>Pay</button>}
        </span>
      </div>
      {paying && (
        <form className="mt-2 flex flex-wrap gap-2" onSubmit={async (e) => {
          e.preventDefault();
          const acct = accounts.find((a) => a.id === v.accountId);
          if (!acct) return;
          const amt = Number(v.amount);
          await createDoc("entries", {
            date: v.date, direction: "out", amount: amt, scope: bill.scope, projectId: bill.projectId ?? null, category: bill.category,
            billingType: bill.billingType, accountId: acct.id, accountHolder: acct.holderId ?? null, mode: v.mode,
            notes: `${bill.vendorName} bill ${bill.billNo} (${po.number})`, billId: bill.fileId, isPurchase: true,
            linkedDoc: { type: "purchaseBill", id: bill.id }, vendorId: bill.vendorId, status: "approved",
          });
          const paid = Number(bill.paid || 0) + amt;
          await updateDoc("purchaseBills", bill.id, { paid: increment(amt), status: paid >= Number(bill.total) - 0.01 ? "Paid" : "Partly paid" }, bill);
          setPaying(false);
        }}>
          <input className="input !w-28 !py-1" type="number" step="0.01" value={v.amount} onChange={(e) => setV({ ...v, amount: e.target.value })} />
          <select className="input !w-auto !py-1" required value={v.accountId} onChange={(e) => setV({ ...v, accountId: e.target.value })}>
            <option value="">From account…</option>
            {accounts.filter((a) => a.active !== false).map((a) => <option key={a.id} value={a.id}>{String(a.name)}</option>)}
          </select>
          <select className="input !w-auto !py-1" value={v.mode} onChange={(e) => setV({ ...v, mode: e.target.value })}>{MODES.map((m) => <option key={m}>{m}</option>)}</select>
          <DateInput prefix="Paid on" className="!w-auto !py-1" value={v.date} onChange={(val) => setV({ ...v, date: val })} />
          <button className="btn-primary !py-1">Pay</button>
        </form>
      )}
    </div>
  );
}

