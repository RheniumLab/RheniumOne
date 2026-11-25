"use client";

import { useState } from "react";
import { where } from "firebase/firestore";
import { Camera, Paperclip, Plus } from "lucide-react";
import { CategorySelect } from "@/components/category-select";
import { Badge, Empty, ErrorBox, PageHeader } from "@/components/ui";
import { useAuth } from "@/lib/auth-context";
import { useCollection } from "@/lib/hooks";
import { createDoc, fmtDate, inr, today, updateDoc, type Doc } from "@/lib/data";
import { openAttachment, saveAttachment } from "@/lib/attachments";

/** §8.6 Expense claims: submitted → approved / rejected → paid (posts to cash flow). */
export default function ClaimsPage() {
  const { can, user } = useAuth();
  const manager = can("claims", "approve");
  const all = useCollection("claims", [], { enabled: manager });
  const mine = useCollection("claims", [where("claimant", "==", user?.uid ?? "-")], { enabled: !manager }, [user?.uid]);
  const { rows: users } = useCollection("users");
  const { rows: accounts } = useCollection("accounts");
  const [show, setShow] = useState(false);
  const rows = [...(manager ? all.rows : mine.rows)].sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const uname = (id: unknown) => String(users.find((u) => u.id === id)?.name ?? "");

  async function pay(c: Doc) {
    const options = accounts.filter((a) => a.active !== false).map((a, i) => `${i + 1}. ${a.name}`).join("\n");
    const pick = prompt(`Pay ${inr(Number(c.amount))} from which account?\n${options}`);
    const acct = accounts.filter((a) => a.active !== false)[Number(pick) - 1];
    if (!acct) return;
    const entryId = await createDoc("entries", {
      date: today(),
      direction: "out",
      amount: Number(c.amount),
      scope: c.scope,
      projectId: c.projectId ?? null,
      category: c.category,
      billingType: c.billingType ?? "gst",
      accountId: acct.id,
      accountHolder: acct.holderId ?? null,
      mode: acct.kind === "cash" ? "Cash" : "Bank transfer",
      notes: `Expense claim reimbursement — ${uname(c.claimant)}: ${c.description ?? ""}`,
      billId: c.billId ?? null,
      isPurchase: true,
      linkedDoc: { type: "claim", id: c.id },
      status: "approved",
    });
    await updateDoc("claims", c.id, { status: "paid", paidFromAccountId: acct.id, entryId }, c);
  }

  return (
    <div>
      <PageHeader
        title="Expense claims"
        subtitle={manager ? "All claims" : "Your claims"}
        actions={can("claims", "create") && <button className="btn-primary" onClick={() => setShow((s) => !s)}><Plus size={15} /> New claim</button>}
      />
      {show && <ClaimForm onDone={() => setShow(false)} />}
      <div className="card overflow-x-auto">
        {!rows.length ? <Empty>No claims yet.</Empty> : (
          <table className="table">
            <thead><tr><th>Date</th><th>Claimant</th><th>Category</th><th>Description</th><th className="text-right">Amount</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id}>
                  <td className="whitespace-nowrap">{fmtDate(c.date)}</td>
                  <td>{uname(c.claimant)}</td>
                  <td>{String(c.category)}</td>
                  <td>{String(c.description ?? "")}</td>
                  <td className="text-right tabular-nums">{inr(Number(c.amount))}</td>
                  <td><Badge>{String(c.status)}</Badge></td>
                  <td className="whitespace-nowrap text-right">
                    {c.billId ? <button className="mr-2 text-muted hover:text-brand" onClick={() => openAttachment(String(c.billId))} title="View bill"><Paperclip size={14} /></button> : null}
                    {manager && c.status === "submitted" && c.claimant !== user?.uid && (
                      <>
                        <button className="btn !py-1 mr-1" onClick={() => updateDoc("claims", c.id, { status: "approved", approvedBy: user?.uid }, c)}>Approve</button>
                        <button className="btn-danger !py-1" onClick={() => {
                          const reason = prompt("Reason for rejecting?");
                          if (reason !== null) updateDoc("claims", c.id, { status: "rejected", rejectReason: reason, approvedBy: user?.uid }, c);
                        }}>Reject</button>
                      </>
                    )}
                    {c.status === "approved" && can("cashflow", "create") && <button className="btn-primary !py-1" onClick={() => pay(c)}>Pay out</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function ClaimForm({ onDone }: { onDone: () => void }) {
  const { user, can } = useAuth();
  const { rows: projects } = useCollection("projects", [], { gstAware: true, enabled: can("projects", "view") });
  const [v, setV] = useState({ date: today(), amount: "", scope: "company", projectId: "", category: "", description: "" });
  const [bill, setBill] = useState<File | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="card mb-4 grid gap-3 p-4 sm:grid-cols-2"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!bill) return setErr("Attach the bill photo.");
        setBusy(true);
        try {
          const billId = await saveAttachment(bill, { linked: "claims" });
          await createDoc("claims", { ...v, amount: Number(v.amount), projectId: v.scope === "project" ? v.projectId : null, billId, claimant: user?.uid, status: "submitted" });
          onDone();
        } catch (e) {
          setErr(e instanceof Error ? e.message : String(e));
          setBusy(false);
        }
      }}
    >
      <div><label className="label">Date</label><input className="input" type="date" value={v.date} onChange={(e) => setV({ ...v, date: e.target.value })} /></div>
      <div><label className="label">Amount (₹) *</label><input className="input" type="number" step="0.01" min="0.01" required value={v.amount} onChange={(e) => setV({ ...v, amount: e.target.value })} /></div>
      <div>
        <label className="label">For</label>
        <select className="input" value={v.scope} onChange={(e) => setV({ ...v, scope: e.target.value })}><option value="company">Company</option><option value="project">Project</option></select>
      </div>
      {v.scope === "project" ? (
        <div>
          <label className="label">Project</label>
          <select className="input" required value={v.projectId} onChange={(e) => setV({ ...v, projectId: e.target.value })}>
            <option value="">—</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{String(p.name)}</option>)}
          </select>
        </div>
      ) : <div />}
      <div><label className="label">Category *</label><CategorySelect type={v.scope === "project" ? "project" : "company"} value={v.category} onChange={(x) => setV({ ...v, category: x })} required /></div>
      <div><label className="label">Description</label><input className="input" value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} /></div>
      <div className="sm:col-span-2">
        <label className="btn cursor-pointer">
          <Camera size={15} /> {bill ? bill.name : "Bill photo *"}
          <input type="file" accept="image/*,application/pdf" capture="environment" className="hidden" onChange={(e) => setBill(e.target.files?.[0] ?? null)} />
        </label>
      </div>
      {err && <div className="sm:col-span-2"><ErrorBox>{err}</ErrorBox></div>}
      <div className="sm:col-span-2"><button className="btn-primary" disabled={busy}>{busy ? "Submitting…" : "Submit claim"}</button></div>
    </form>
  );
}
