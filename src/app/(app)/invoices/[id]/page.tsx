"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { where } from "firebase/firestore";
import { FileText, Mail, MessageCircle, Pencil, Send, Wallet, XCircle } from "lucide-react";
import { LineItems, TotalsPanel } from "@/components/line-items";
import { Badge, Empty, ErrorBox, GstBadge, NoAccess, PageHeader, Spinner, Stat } from "@/components/ui";
import { useAuth } from "@/lib/auth-context";
import { useCollection, useDoc } from "@/lib/hooks";
import { assignNumber, getCompany, invoiceSeries, requestApproval, useCompany } from "@/lib/business";
import { fmtDate, getDocOnce, inr, updateDoc } from "@/lib/data";
import { commercialDocHtml, docName } from "@/lib/doc-html";
import { makePdf, openDrive, shareDoc } from "@/lib/files";
import { addDocRecord, clientFolder } from "@/lib/docs";
import { invoiceDue } from "@/lib/money";
import type { Line } from "@/lib/tax";
import { InvoiceEditor } from "../editor";
import { EwayBill } from "@/components/eway";

async function renderInvoicePdf(inv: Record<string, unknown> & { id: string }) {
  const company = await getCompany();
  const client = await getDocOnce("clients", String(inv.clientId));
  const project = inv.projectId ? await getDocOnce("projects", String(inv.projectId)) : null;
  const gst = inv.billingType === "gst";
  const eway = inv.eway as Record<string, string> | undefined;
  const html = commercialDocHtml({
    company,
    title: gst ? "Tax Invoice" : "Bill of Supply",
    party: { name: String(client?.legalName ?? ""), address: String(client?.billingAddress ?? ""), gstin: gst ? String(client?.gstin ?? "") : "", state: String(inv.placeOfSupply ?? "") },
    meta: [
      ["Invoice no.", inv.number],
      ["Date", fmtDate(inv.date)],
      ["Due date", fmtDate(inv.dueDate)],
      ...(project ? ([["Project", `${project.code} ${project.name}`]] as [string, unknown][]) : []),
      ...(gst ? ([["Place of supply", inv.placeOfSupply]] as [string, unknown][]) : []),
      ...(eway?.no ? ([["E-way bill", `${eway.no}${eway.vehicle ? ` · ${eway.vehicle}` : ""}`]] as [string, unknown][]) : []),
    ],
    lines: inv.lines as Line[],
    adj: (inv.adj ?? {}) as never,
    gst,
    intraState: Boolean(inv.intraState),
    notes: String(inv.notes ?? ""),
    terms: String(inv.terms ?? ""),
    showBank: true,
  });
  const folder = `${clientFolder(client)}/Invoices`;
  const name = String(inv.number).replace(/\//g, "-");
  const { driveId, fileId } = await makePdf(html, name, { folder, billingType: String(inv.billingType), linked: { col: "invoices", id: inv.id } });
  await updateDoc("invoices", inv.id, { pdfDriveId: driveId, pdfFileId: fileId });
  await addDocRecord({ name: `${name}.pdf`, folder: "Invoices", clientId: String(inv.clientId), projectId: (inv.projectId as string) || null, linked: { col: "invoices", id: inv.id }, fileId, driveId, billingType: String(inv.billingType), mime: "application/pdf" });
  return driveId;
}

export default function InvoicePage() {
  const { id } = useParams<{ id: string }>();
  const { can, isAdmin } = useAuth();
  const { data: inv, loading, error } = useDoc("invoices", id);
  const company = useCompany();
  const payments = useCollection("payments", [where("invoiceIds", "array-contains", id)], { gstAware: true }, [id]);
  const { data: client } = useDoc("clients", inv?.clientId);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  if (!can("invoices", "view")) return <NoAccess />;
  if (loading) return <Spinner />;
  if (error) return <ErrorBox>{error}</ErrorBox>;
  if (!inv) return <Empty>Invoice not found.</Empty>;

  if (editing && inv.status === "Draft") {
    return (
      <div>
        <PageHeader title="Edit draft invoice" back={`/invoices/${id}`} />
        <InvoiceEditor id={id} initial={inv as never} />
      </div>
    );
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

  const issue = () =>
    run("issue", async () => {
      if (!confirm("Issue this invoice? It gets its number and can no longer be edited.")) return;
      const c = await getCompany();
      const number = await assignNumber("invoices", id, invoiceSeries(c, String(inv.billingType), new Date(String(inv.date))), { status: "Issued", issuedAt: new Date().toISOString() });
      await renderInvoicePdf({ ...inv, number, id });
    });

  const cancel = () =>
    run("cancel", async () => {
      if (!confirm("Cancel this invoice? It keeps its number and is marked cancelled.")) return;
      if (isAdmin) return updateDoc("invoices", id, { status: "Cancelled", cancelledAt: new Date().toISOString() }, inv);
      await updateDoc("invoices", id, { cancelRequested: true }, inv);
      const r = await requestApproval({ type: "invoiceCancel", col: "invoices", docId: id, amount: Number(inv.total), summary: `Cancel invoice ${inv.number} (${inr(Number(inv.total))}) — ${inv.clientName}`, link: `/invoices/${id}` });
      if (r === "none") await updateDoc("invoices", id, { status: "Cancelled", cancelledAt: new Date().toISOString() });
    });

  const share = (via: "whatsapp" | "email") =>
    run(via, async () => {
      const contacts = (client?.contacts ?? []) as Record<string, string>[];
      const primary = contacts.find((c) => c.roleTag === "Accounts") ?? contacts.find((c) => c.primary) ?? contacts[0];
      await shareDoc(String(inv.pdfDriveId), via, `Invoice ${inv.number} from ${docName(company)} — ${inr(Number(inv.total))}, due ${fmtDate(inv.dueDate)}`, { phone: primary?.whatsapp || primary?.phone, email: primary?.email });
    });

  const balance = invoiceDue(inv);
  const gst = inv.billingType === "gst";
  const eway = (inv.eway ?? {}) as Record<string, string>;

  return (
    <div className="space-y-4">
      <PageHeader
        back="/invoices"
        title={inv.number ? String(inv.number) : "Draft invoice"}
        subtitle={<span className="flex flex-wrap items-center gap-2"><Link className="text-brand hover:underline" href={`/clients/${inv.clientId}`}>{String(inv.clientName)}</Link><GstBadge type={String(inv.billingType)} /><Badge>{String(inv.status)}</Badge>{inv.pendingApproval ? <Badge kind="warn">Cancellation pending approval</Badge> : null}</span>}
        actions={
          <>
            {inv.status === "Draft" && can("invoices", "edit") && <button className="btn" onClick={() => setEditing(true)}><Pencil size={14} /> Edit</button>}
            {inv.status === "Draft" && can("invoices", "edit") && <button className="btn-primary" disabled={!!busy} onClick={issue}><Send size={14} /> {busy === "issue" ? "Issuing…" : "Issue"}</button>}
            {inv.number && inv.status !== "Draft" && (
              <>
                {inv.pdfDriveId
                  ? <button className="btn" onClick={() => openDrive(String(inv.pdfDriveId))}><FileText size={14} /> PDF</button>
                  : <button className="btn" disabled={!!busy} onClick={() => run("pdf", () => renderInvoicePdf({ ...inv, id }))}><FileText size={14} /> {busy === "pdf" ? "Making PDF…" : "Make PDF"}</button>}
                {inv.pdfDriveId ? <button className="btn" disabled={!!busy} onClick={() => share("whatsapp")}><MessageCircle size={14} /> WhatsApp</button> : null}
                {inv.pdfDriveId ? <button className="btn" disabled={!!busy} onClick={() => share("email")}><Mail size={14} /> Email</button> : null}
              </>
            )}
            {balance > 0 && can("invoices", "edit") && <Link className="btn-primary" href={`/payments/new?clientId=${inv.clientId}&invoiceId=${id}`}><Wallet size={14} /> Record payment</Link>}
            {inv.status !== "Cancelled" && inv.status !== "Draft" && !inv.pendingApproval && Number(inv.paid || 0) === 0 && can("invoices", "delete") && (
              <button className="btn-danger" disabled={!!busy} onClick={cancel}><XCircle size={14} /> Cancel</button>
            )}
          </>
        }
      />
      {err && <ErrorBox>{err}</ErrorBox>}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Total" value={inr(Number(inv.total))} />
        <Stat label="Received (incl. TDS)" value={inr(Number(inv.paid || 0))} />
        <Stat label="Balance" value={inr(balance)} tone={balance > 0 && String(inv.dueDate) < new Date().toISOString().slice(0, 10) ? "danger" : undefined} />
        <Stat label="Dates" value={<span className="text-sm">{fmtDate(inv.date)} → due {fmtDate(inv.dueDate)}</span>} />
      </div>
      <div className="card p-4">
        <h2 className="mb-2 text-sm font-semibold">Items</h2>
        <LineItems lines={inv.lines as Line[]} onChange={() => {}} gst={gst} readOnly />
        <div className="mt-3 ml-auto max-w-sm"><TotalsPanel lines={inv.lines as Line[]} adj={(inv.adj ?? {}) as never} gst={gst} intraState={Boolean(inv.intraState)} /></div>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="card p-4">
          <h2 className="mb-2 text-sm font-semibold">Payments</h2>
          {!payments.rows.length ? <div className="text-sm text-muted">No payments recorded.</div> : (
            <table className="table">
              <thead><tr><th>Date</th><th>Mode</th><th className="text-right">Amount</th><th className="text-right">TDS</th></tr></thead>
              <tbody>
                {payments.rows.map((p) => {
                  const a = ((p.allocations ?? []) as Record<string, unknown>[]).find((x) => x.invoiceId === id);
                  return <tr key={p.id}><td>{fmtDate(p.date)}</td><td>{String(p.mode)}</td><td className="whitespace-nowrap text-right tabular-nums">{inr(Number(a?.amount ?? 0))}</td><td className="whitespace-nowrap text-right tabular-nums">{inr(Number(a?.tds ?? 0))}</td></tr>;
                })}
              </tbody>
            </table>
          )}
        </div>
        <EwayBill id={id} eway={eway} editable={can("invoices", "edit") && inv.status !== "Cancelled"} />
      </div>
      {(inv.notes || inv.terms) ? (
        <div className="card grid gap-4 p-4 md:grid-cols-2 text-sm">
          <div><div className="text-xs text-muted">Notes</div><div className="whitespace-pre-wrap">{String(inv.notes || "—")}</div></div>
          <div><div className="text-xs text-muted">Terms</div><div className="whitespace-pre-wrap">{String(inv.terms || "—")}</div></div>
        </div>
      ) : null}
    </div>
  );
}
