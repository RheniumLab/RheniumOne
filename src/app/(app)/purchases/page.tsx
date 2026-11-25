"use client";

import Link from "next/link";
import { useState } from "react";
import { Plus } from "lucide-react";
import { Badge, Empty, GstBadge, NoAccess, PageHeader, Spinner, Stat } from "@/components/ui";
import { useAuth } from "@/lib/auth-context";
import { useCollection } from "@/lib/hooks";
import { fmtDate, inr } from "@/lib/data";

export default function PurchasesPage() {
  const { can } = useAuth();
  const ok = can("purchases", "view");
  const pos = useCollection("pos", [], { gstAware: true, enabled: ok });
  const bills = useCollection("purchaseBills", [], { gstAware: true, enabled: ok });
  const grns = useCollection("grns", [], { enabled: ok });
  const [tab, setTab] = useState<"pos" | "grns" | "bills">("pos");
  const [status, setStatus] = useState("");
  if (!ok) return <NoAccess />;
  const payable = bills.rows.filter((b) => b.status !== "Paid").reduce((s, b) => s + Number(b.total || 0) - Number(b.paid || 0), 0);
  const overdue = bills.rows.filter((b) => b.status !== "Paid" && String(b.dueDate) < new Date().toISOString().slice(0, 10)).reduce((s, b) => s + Number(b.total || 0) - Number(b.paid || 0), 0);
  const open = pos.rows.filter((p) => ["Approved", "Sent", "Partly received"].includes(String(p.status))).length;

  return (
    <div className="space-y-4">
      <PageHeader title="Purchase orders & goods receipt" actions={can("purchases", "create") && <Link className="btn-primary" href="/purchases/new"><Plus size={15} /> New PO</Link>} />
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Open POs" value={open} />
        <Stat label="Payable to vendors" value={inr(payable)} />
        <Stat label="Overdue to vendors" value={inr(overdue)} tone={overdue > 0 ? "danger" : undefined} />
      </div>
      <div className="flex gap-1 border-b border-border">
        {([["pos", "Purchase orders"], ["grns", "Goods receipts"], ["bills", "Vendor bills"]] as const).map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className={`-mb-px border-b-2 px-3 py-2 text-sm ${tab === k ? "border-brand font-medium text-brand" : "border-transparent text-muted"}`}>{l}</button>
        ))}
      </div>
      {tab === "pos" && (
        <div className="card">
          <div className="border-b border-border p-3">
            <select className="input !w-auto" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All statuses</option>
              {["Draft", "Pending approval", "Approved", "Rejected", "Sent", "Partly received", "Received", "Closed", "Cancelled"].map((s) => <option key={s}>{s}</option>)}
            </select>
          </div>
          {pos.loading ? <Spinner /> : (
            <div className="overflow-x-auto">
              <table className="table">
                <thead><tr><th>PO</th><th>Date</th><th>Vendor</th><th>Type</th><th className="text-right">Total</th><th>Status</th></tr></thead>
                <tbody>
                  {pos.rows.filter((p) => !status || p.status === status).sort((a, b) => String(b.date).localeCompare(String(a.date))).map((p) => (
                    <tr key={p.id}>
                      <td><Link className="font-medium text-brand hover:underline" href={`/purchases/${p.id}`}>{String(p.number ?? "Draft")}</Link></td>
                      <td>{fmtDate(p.date)}</td>
                      <td>{String(p.vendorName ?? "")}</td>
                      <td><GstBadge type={String(p.billingType)} /></td>
                      <td className="text-right tabular-nums">{inr(Number(p.total))}</td>
                      <td><Badge>{String(p.status)}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!pos.rows.length && <Empty>No purchase orders yet.</Empty>}
            </div>
          )}
        </div>
      )}
      {tab === "grns" && (
        <div className="card overflow-x-auto">
          {!grns.rows.length ? <Empty>No goods received yet.</Empty> : (
            <table className="table">
              <thead><tr><th>GRN</th><th>Date</th><th>Vendor</th><th>PO</th><th>Items</th></tr></thead>
              <tbody>
                {grns.rows.sort((a, b) => String(b.date).localeCompare(String(a.date))).map((g) => (
                  <tr key={g.id}>
                    <td>{String(g.number)}</td>
                    <td>{fmtDate(g.date)}</td>
                    <td>{String(g.vendorName ?? "")}</td>
                    <td><Link className="text-brand hover:underline" href={`/purchases/${g.poId}`}>{String(g.poNumber ?? "")}</Link></td>
                    <td className="text-xs">{((g.lines ?? []) as Record<string, unknown>[]).map((l) => `${l.description} × ${l.qty}`).join(", ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
      {tab === "bills" && (
        <div className="card overflow-x-auto">
          {!bills.rows.length ? <Empty>No vendor bills yet. Record a bill from its PO.</Empty> : (
            <table className="table">
              <thead><tr><th>Vendor</th><th>Bill no.</th><th>Date</th><th>Due</th><th>PO</th><th className="text-right">Total</th><th className="text-right">Balance</th><th>Status</th></tr></thead>
              <tbody>
                {bills.rows.sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate))).map((b) => {
                  const bal = Number(b.total || 0) - Number(b.paid || 0);
                  const late = b.status !== "Paid" && String(b.dueDate) < new Date().toISOString().slice(0, 10);
                  return (
                    <tr key={b.id}>
                      <td>{String(b.vendorName)}</td>
                      <td>{String(b.billNo)}</td>
                      <td>{fmtDate(b.billDate)}</td>
                      <td className={late ? "text-danger" : ""}>{fmtDate(b.dueDate)}</td>
                      <td>{b.poId ? <Link className="text-brand hover:underline" href={`/purchases/${b.poId}`}>{String(b.poNumber ?? "PO")}</Link> : "—"}</td>
                      <td className="text-right tabular-nums">{inr(Number(b.total))}</td>
                      <td className="text-right tabular-nums">{inr(bal)}</td>
                      <td><Badge>{String(b.status)}</Badge></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
