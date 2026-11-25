"use client";

import Link from "next/link";
import { useState } from "react";
import { Plus } from "lucide-react";
import { Badge, Empty, GstBadge, NoAccess, PageHeader, Spinner } from "@/components/ui";
import { useAuth } from "@/lib/auth-context";
import { useCollection } from "@/lib/hooks";
import { fmtDate, inr } from "@/lib/data";

export default function QuotationsPage() {
  const { can } = useAuth();
  const { rows, loading } = useCollection("quotations", [], { gstAware: true, enabled: can("quotations", "view") });
  const [status, setStatus] = useState("");
  if (!can("quotations", "view")) return <NoAccess />;
  const todayS = new Date().toISOString().slice(0, 10);
  const shown = rows
    .map((q): typeof q => ({ ...q, status: q.status === "Sent" && q.validUntil && String(q.validUntil) < todayS ? "Expired" : q.status }))
    .filter((q) => !status || q.status === status)
    .sort((a, b) => String(b.number).localeCompare(String(a.number)));
  return (
    <div>
      <PageHeader title="Quotations" actions={can("quotations", "create") && <Link href="/quotations/new" className="btn-primary"><Plus size={15} /> New quotation</Link>} />
      <div className="card">
        <div className="border-b border-border p-3">
          <select className="input !w-auto" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            {["Draft", "Sent", "Accepted", "Rejected", "Expired"].map((s) => <option key={s}>{s}</option>)}
          </select>
        </div>
        {loading ? <Spinner /> : !shown.length ? <Empty>No quotations yet.</Empty> : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead><tr><th>Number</th><th>Subject</th><th>Client</th><th>Type</th><th className="text-right">Value</th><th>Valid until</th><th>Status</th></tr></thead>
              <tbody>
                {shown.map((q) => (
                  <tr key={q.id}>
                    <td className="whitespace-nowrap"><Link className="font-medium text-brand hover:underline" href={`/quotations/${q.id}`}>{String(q.number)} R{String(q.rev ?? 0)}</Link></td>
                    <td>{String(q.title)}</td>
                    <td>{String(q.clientName ?? "")}</td>
                    <td><GstBadge type={String(q.billingType)} /></td>
                    <td className="text-right tabular-nums">{inr(Number(q.total))}</td>
                    <td>{fmtDate(q.validUntil)}</td>
                    <td><Badge>{String(q.status)}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
