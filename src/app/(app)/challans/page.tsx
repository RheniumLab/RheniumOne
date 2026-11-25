"use client";

import Link from "next/link";
import { Plus } from "lucide-react";
import { Badge, Empty, NoAccess, PageHeader } from "@/components/ui";
import { useAuth } from "@/lib/auth-context";
import { useCollection } from "@/lib/hooks";
import { fmtDate } from "@/lib/data";

export default function ChallansPage() {
  const { can } = useAuth();
  const { rows } = useCollection("challans", [], { enabled: can("challans", "view") });
  if (!can("challans", "view")) return <NoAccess />;
  const today = new Date().toISOString().slice(0, 10);
  return (
    <div>
      <PageHeader title="Delivery challans & e-way bills" subtitle="Goods that move without a sale" actions={can("challans", "create") && <Link className="btn-primary" href="/challans/new"><Plus size={15} /> New challan</Link>} />
      <div className="card overflow-x-auto">
        {!rows.length ? <Empty>No challans yet.</Empty> : (
          <table className="table">
            <thead><tr><th>Number</th><th>Date</th><th>To</th><th>Purpose</th><th>Returnable</th><th>E-way bill</th><th>Status</th></tr></thead>
            <tbody>
              {rows.sort((a, b) => String(b.number).localeCompare(String(a.number))).map((c) => (
                <tr key={c.id}>
                  <td><Link className="font-medium text-brand hover:underline" href={`/challans/${c.id}`}>{String(c.number)}</Link></td>
                  <td>{fmtDate(c.date)}</td>
                  <td>{String(c.consignee ?? "")}</td>
                  <td>{String(c.purpose)}</td>
                  <td>{c.returnable ? <span className={c.status !== "Returned" && c.expectedReturn && String(c.expectedReturn) < today ? "text-danger" : ""}>by {fmtDate(c.expectedReturn)}</span> : "No"}</td>
                  <td>{String((c.eway as Record<string, string> | undefined)?.no ?? "—")}</td>
                  <td><Badge>{String(c.status)}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
