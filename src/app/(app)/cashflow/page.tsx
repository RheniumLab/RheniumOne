"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Paperclip, Plus, Trash2 } from "lucide-react";
import { Badge, Empty, ErrorBox, GstBadge, PageHeader, Spinner, Stat } from "@/components/ui";
import { useAuth } from "@/lib/auth-context";
import { useCollection } from "@/lib/hooks";
import { useEntries } from "@/lib/money";
import { fmtDate, inr, softDelete } from "@/lib/data";
import { openFile } from "@/lib/files";
import { requestApproval } from "@/lib/business";

async function deleteEntry(e: Record<string, unknown> & { id: string }, isAdmin: boolean) {
  if (!confirm("Delete this entry? It is marked deleted and stays in the audit log.")) return;
  if (isAdmin) return softDelete("entries", e.id);
  const r = await requestApproval({
    type: "entryDelete", col: "entries", docId: e.id, amount: Number(e.amount),
    summary: `Delete ${e.direction === "in" ? "receipt" : "payment"} of ₹${e.amount} (${e.category}) dated ${e.date}`, link: "/cashflow",
  });
  if (r === "none") await softDelete("entries", e.id);
  else alert("Sent for approval. The entry stays until it is approved.");
}

export default function CashFlowPage() {
  const { can, nonGst, isAdmin } = useAuth();
  const { rows, loading, error } = useEntries();
  const { rows: accounts } = useCollection("accounts");
  const { rows: projects } = useCollection("projects", [], { gstAware: true, enabled: can("projects", "view") });
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [dir, setDir] = useState("");
  const [scope, setScope] = useState("");
  const [gst, setGst] = useState("");

  const filtered = useMemo(
    () =>
      rows
        .filter((e) => !month || String(e.date).startsWith(month))
        .filter((e) => !dir || e.direction === dir)
        .filter((e) => !scope || e.scope === scope)
        .filter((e) => !gst || e.billingType === gst)
        .sort((a, b) => String(b.date).localeCompare(String(a.date))),
    [rows, month, dir, scope, gst],
  );
  const counted = filtered.filter((e) => e.status !== "pending");
  const totIn = counted.filter((e) => e.direction === "in").reduce((s, e) => s + Number(e.amount), 0);
  const totOut = counted.filter((e) => e.direction === "out").reduce((s, e) => s + Number(e.amount), 0);
  const acct = (id: unknown) => String(accounts.find((a) => a.id === id)?.name ?? "—");
  const proj = (id: unknown) => projects.find((p) => p.id === id);

  return (
    <div>
      <PageHeader
        title="Cash flow"
        subtitle="Every rupee in or out, tagged to a project or the company"
        actions={(can("cashflow", "create") || can("custody", "create")) && <Link href="/cashflow/new" className="btn-primary"><Plus size={15} /> New entry</Link>}
      />
      <div className="mb-4 grid grid-cols-3 gap-3">
        <Stat label="Money in" value={inr(totIn)} />
        <Stat label="Money out" value={inr(totOut)} />
        <Stat label="Net" value={inr(totIn - totOut)} tone={totIn - totOut < 0 ? "danger" : "ok"} />
      </div>
      <div className="card">
        <div className="flex flex-wrap gap-2 border-b border-border p-3">
          <input type="month" className="input !w-auto" value={month} onChange={(e) => setMonth(e.target.value)} />
          <select className="input !w-auto" value={dir} onChange={(e) => setDir(e.target.value)}>
            <option value="">In and out</option><option value="in">In</option><option value="out">Out</option>
          </select>
          <select className="input !w-auto" value={scope} onChange={(e) => setScope(e.target.value)}>
            <option value="">Project and company</option><option value="project">Project</option><option value="company">Company</option>
          </select>
          {nonGst && (
            <select className="input !w-auto" value={gst} onChange={(e) => setGst(e.target.value)}>
              <option value="">GST and non-GST</option><option value="gst">GST</option><option value="nonGst">Non-GST</option>
            </select>
          )}
        </div>
        {error && <div className="p-3"><ErrorBox>{error}</ErrorBox></div>}
        {loading ? <Spinner /> : !filtered.length ? <Empty>No entries for this filter.</Empty> : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr><th>Date</th><th>Category</th><th>Project / company</th><th>Account</th><th>Mode</th><th>Type</th><th className="text-right">Amount</th><th></th></tr>
              </thead>
              <tbody>
                {filtered.map((e) => (
                  <tr key={e.id}>
                    <td className="whitespace-nowrap">{fmtDate(e.date)}</td>
                    <td>
                      {String(e.category ?? "")}
                      {e.notes ? <div className="text-xs text-muted">{String(e.notes)}</div> : null}
                    </td>
                    <td>{e.scope === "project" ? (proj(e.projectId) ? <Link className="text-brand hover:underline" href={`/projects/${e.projectId}`}>{String(proj(e.projectId)!.name)}</Link> : "Project") : "Company"}</td>
                    <td>{acct(e.accountId)}</td>
                    <td>{String(e.mode ?? "")}</td>
                    <td className="space-x-1 whitespace-nowrap"><GstBadge type={String(e.billingType)} />{e.status === "pending" && <Badge kind="warn">Pending</Badge>}</td>
                    <td className={`whitespace-nowrap text-right tabular-nums ${e.direction === "in" ? "text-ok" : ""}`}>
                      {e.direction === "in" ? "+" : "−"}{inr(Number(e.amount))}
                    </td>
                    <td className="whitespace-nowrap text-right">
                      {e.billId ? <button className="text-muted hover:text-brand" title="View bill" onClick={() => openFile(String(e.billId))}><Paperclip size={14} /></button> : null}
                      {e.pendingApproval ? <Badge kind="warn">Delete pending</Badge> : can("cashflow", "delete") && (
                        <button className="ml-2 text-muted hover:text-danger" title="Delete" onClick={() => deleteEntry(e, isAdmin)}>
                          <Trash2 size={14} />
                        </button>
                      )}
                    </td>
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
