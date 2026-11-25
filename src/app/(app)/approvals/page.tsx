"use client";

import Link from "next/link";
import { useState } from "react";
import { where } from "firebase/firestore";
import { Check, X } from "lucide-react";
import { Badge, Empty, ErrorBox, NoAccess, PageHeader } from "@/components/ui";
import { useAuth } from "@/lib/auth-context";
import { useCollection } from "@/lib/hooks";
import { api } from "@/lib/api";
import { APPROVAL_LABELS, type ApprovalType } from "@/lib/business";
import { inr } from "@/lib/data";

/** §10.1 Approvers approve or reject with a comment, also from the phone. */
export default function ApprovalsPage() {
  const { can, isAdmin, profile, user } = useAuth();
  const mineQ = useCollection("approvals", isAdmin ? [] : [where("approverRole", "==", profile?.roleId ?? "-")], { includeDeleted: true }, [profile?.roleId, isAdmin]);
  const myReq = useCollection("approvals", [where("requestedBy", "==", user?.uid ?? "-")], { includeDeleted: true }, [user?.uid]);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  if (!can("approvals", "view") && !mineQ.rows.length && !myReq.rows.length) return <NoAccess />;

  const pending = mineQ.rows.filter((a) => a.status === "pending").sort((a, b) => (a.at?.seconds ?? 0) - (b.at?.seconds ?? 0));
  const decided = mineQ.rows.filter((a) => a.status !== "pending").sort((a, b) => (b.decidedAt?.seconds ?? 0) - (a.decidedAt?.seconds ?? 0)).slice(0, 50);
  const requests = myReq.rows.sort((a, b) => (b.at?.seconds ?? 0) - (a.at?.seconds ?? 0)).slice(0, 30);

  async function decide(id: string, decision: "approve" | "reject") {
    const comment = prompt(decision === "approve" ? "Comment (optional)" : "Reason for rejecting");
    if (comment === null) return;
    setBusy(id);
    setErr(null);
    try {
      await api("/api/approvals/decide", "POST", { approvalId: id, decision, comment });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
    setBusy(null);
  }

  const amount = (a: Record<string, unknown>) => (a.type === "quotationDiscount" ? `${a.amount}%` : a.amount ? inr(Number(a.amount)) : "");

  return (
    <div className="space-y-5">
      <PageHeader title="Approvals" subtitle="Entries waiting for approval don’t count in balances until approved" />
      {err && <ErrorBox>{err}</ErrorBox>}
      <div className="card">
        <h2 className="border-b border-border px-4 py-3 text-sm font-semibold">Waiting for you ({pending.length})</h2>
        {!pending.length ? <Empty>Nothing to approve.</Empty> : pending.map((a) => (
          <div key={a.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3 last:border-0">
            <div className="min-w-0">
              <div className="text-sm font-medium"><Link className="hover:text-brand" href={String(a.link ?? "#")}>{String(a.summary)}</Link></div>
              <div className="text-xs text-muted">{APPROVAL_LABELS[a.type as ApprovalType]?.replace(/ above.*| ₹| %/g, "") ?? String(a.type)} · {amount(a)} · requested by {String(a.requestedByName)} · {a.at?.toDate?.().toLocaleString("en-IN") ?? ""}</div>
            </div>
            <div className="flex gap-2">
              <button className="btn-primary" disabled={busy === a.id || (a.requestedBy === user?.uid && !isAdmin)} onClick={() => decide(a.id, "approve")}><Check size={14} /> Approve</button>
              <button className="btn-danger" disabled={busy === a.id} onClick={() => decide(a.id, "reject")}><X size={14} /> Reject</button>
            </div>
          </div>
        ))}
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="card">
          <h2 className="border-b border-border px-4 py-3 text-sm font-semibold">Your requests</h2>
          {!requests.length ? <Empty>None.</Empty> : requests.map((a) => (
            <div key={a.id} className="flex items-center justify-between gap-2 border-b border-border px-4 py-2 text-sm last:border-0">
              <Link className="min-w-0 truncate hover:text-brand" href={String(a.link ?? "#")}>{String(a.summary)}</Link>
              <Badge>{String(a.status)}</Badge>
            </div>
          ))}
        </div>
        <div className="card">
          <h2 className="border-b border-border px-4 py-3 text-sm font-semibold">Recently decided</h2>
          {!decided.length ? <Empty>None yet.</Empty> : decided.map((a) => (
            <div key={a.id} className="border-b border-border px-4 py-2 text-sm last:border-0">
              <div className="flex justify-between gap-2"><span className="truncate">{String(a.summary)}</span><Badge>{String(a.status)}</Badge></div>
              <div className="text-xs text-muted">{String(a.decidedByName ?? "")}{a.comment ? ` — “${a.comment}”` : ""}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
