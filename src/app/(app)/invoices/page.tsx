"use client";

import Link from "next/link";
import { useState } from "react";
import { Plus } from "lucide-react";
import { Badge, Empty, GstBadge, NoAccess, PageHeader, Spinner, Stat } from "@/components/ui";
import { useAuth } from "@/lib/auth-context";
import { useCollection } from "@/lib/hooks";
import { fmtDate, inr } from "@/lib/data";
import { ageDays, invoiceDue } from "@/lib/money";

export default function InvoicesPage() {
  const { can } = useAuth();
  const { rows, loading } = useCollection("invoices", [], { gstAware: true, enabled: can("invoices", "view") });
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  if (!can("invoices", "view")) return <NoAccess />;
  const list = rows
    .filter((i) => !status || i.status === status)
    .filter((i) => !q || JSON.stringify([i.number, i.clientName]).toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const live = rows.filter((i) => i.status !== "Draft" && i.status !== "Cancelled");
  const billed = live.reduce((s, i) => s + Number(i.total || 0), 0);
  const outstanding = live.reduce((s, i) => s + invoiceDue(i), 0);
  const overdue = live.filter((i) => invoiceDue(i) > 0 && String(i.dueDate) < new Date().toISOString().slice(0, 10)).reduce((s, i) => s + invoiceDue(i), 0);

  return (
    <div>
      <PageHeader
        title="Invoices"
        subtitle="GST invoices and non-GST bills"
        actions={<>
          {can("invoices", "view") && <Link href="/payments" className="btn">Payments & TDS</Link>}
          {can("invoices", "create") && <Link href="/invoices/new" className="btn-primary"><Plus size={15} /> New invoice</Link>}
        </>}
      />
      <div className="mb-4 grid grid-cols-3 gap-3">
        <Stat label="Billed (issued)" value={inr(billed)} />
        <Stat label="Outstanding" value={inr(outstanding)} />
        <Stat label="Overdue" value={inr(overdue)} tone={overdue > 0 ? "danger" : undefined} />
      </div>
      <div className="card">
        <div className="flex flex-wrap gap-2 border-b border-border p-3">
          <input className="input min-w-48 flex-1" placeholder="Search number or client…" value={q} onChange={(e) => setQ(e.target.value)} />
          <select className="input !w-auto" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            {["Draft", "Issued", "Partly paid", "Paid", "Cancelled"].map((s) => <option key={s}>{s}</option>)}
          </select>
        </div>
        {loading ? <Spinner /> : !list.length ? <Empty>No invoices yet.</Empty> : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead><tr><th>Number</th><th>Date</th><th>Client</th><th>Type</th><th className="text-right">Total</th><th className="text-right">Balance</th><th>Due</th><th>Status</th></tr></thead>
              <tbody>
                {list.map((i) => {
                  const bal = invoiceDue(i);
                  const late = bal > 0 && String(i.dueDate) < new Date().toISOString().slice(0, 10);
                  return (
                    <tr key={i.id}>
                      <td><Link href={`/invoices/${i.id}`} className="font-medium text-brand hover:underline">{String(i.number ?? "Draft")}</Link></td>
                      <td className="whitespace-nowrap">{fmtDate(i.date)}</td>
                      <td>{String(i.clientName ?? "")}</td>
                      <td><GstBadge type={String(i.billingType)} /></td>
                      <td className="text-right tabular-nums">{inr(Number(i.total))}</td>
                      <td className="text-right tabular-nums">{inr(bal)}</td>
                      <td className={`whitespace-nowrap ${late ? "text-danger" : ""}`}>{fmtDate(i.dueDate)}{late ? ` · ${ageDays(i.dueDate)}d late` : ""}</td>
                      <td><Badge>{String(i.status)}</Badge></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
