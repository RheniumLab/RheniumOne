"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { increment, where } from "firebase/firestore";
import { ErrorBox, NoAccess, PageHeader } from "@/components/ui";
import { useAuth } from "@/lib/auth-context";
import { useCollection } from "@/lib/hooks";
import { createDoc, fmtDate, inr, today, updateDoc } from "@/lib/data";
import { MODES, invoiceDue, tdsQuarter } from "@/lib/money";

export default function NewPaymentPage() {
  return <Suspense><NewPayment /></Suspense>;
}

/**
 * A client payment, recorded against one or more invoices or as an advance
 * (§8.2). When the client deducts TDS, amount received + TDS settles the
 * invoice in full (§8.3).
 */
function NewPayment() {
  const { can, nonGst, user } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const { rows: clients } = useCollection("clients");
  const { rows: accounts } = useCollection("accounts");
  const { rows: projects } = useCollection("projects", [], { gstAware: true });
  const [clientId, setClientId] = useState(params.get("clientId") ?? "");
  const invoices = useCollection("invoices", [where("clientId", "==", clientId || "-")], { gstAware: true, enabled: Boolean(clientId) }, [clientId]);
  const [billingType, setBillingType] = useState("gst");
  const [date, setDate] = useState(today());
  const [mode, setMode] = useState("Bank transfer");
  const [accountId, setAccountId] = useState("");
  const [alloc, setAlloc] = useState<Record<string, { amount: string; tds: string }>>({});
  const [advance, setAdvance] = useState("");
  const [advanceProject, setAdvanceProject] = useState("");
  const [notes, setNotes] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const open = useMemo(
    () => invoices.rows.filter((i) => i.billingType === billingType && invoiceDue(i) > 0).sort((a, b) => String(a.date).localeCompare(String(b.date))),
    [invoices.rows, billingType],
  );
  const client = clients.find((c) => c.id === clientId);

  // Preselect the invoice we came from, with TDS at the client's usual rate.
  useEffect(() => {
    const inv = params.get("invoiceId");
    const i = open.find((x) => x.id === inv);
    if (!i || alloc[i.id]) return;
    setBillingType(String(i.billingType));
    const due = invoiceDue(i);
    const rate = client?.tdsApplicable === "Yes" ? Number(client.tdsRate || 0) : 0;
    const tds = Math.round(Number(i.taxable || i.total) * rate) / 100;
    setAlloc((a) => ({ ...a, [i.id]: { amount: String(Math.round((due - tds) * 100) / 100), tds: tds ? String(tds) : "" } }));
  }, [open, params, client, alloc]);

  // GST receipts default to a bank; non-GST receipts to the person's cash wallet (§8.5).
  useEffect(() => {
    const wallet = accounts.find((a) => a.kind === "cash" && a.holderId === user?.uid);
    const bank = accounts.find((a) => a.kind === "bank" && a.active !== false);
    const pick = billingType === "nonGst" ? wallet ?? bank : bank ?? wallet;
    if (pick) setAccountId(pick.id);
    if (billingType === "nonGst") setMode("Cash");
  }, [billingType, accounts, user?.uid]);

  if (!can("invoices", "edit") || !can("cashflow", "create")) return <NoAccess />;

  const totalCash = Object.values(alloc).reduce((s, a) => s + (Number(a.amount) || 0), 0) + (Number(advance) || 0);
  const totalTds = Object.values(alloc).reduce((s, a) => s + (Number(a.tds) || 0), 0);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    const allocations = open
      .filter((i) => (Number(alloc[i.id]?.amount) || 0) + (Number(alloc[i.id]?.tds) || 0) > 0)
      .map((i) => ({ invoiceId: i.id, number: i.number, projectId: i.projectId ?? null, amount: Number(alloc[i.id].amount) || 0, tds: Number(alloc[i.id].tds) || 0, due: invoiceDue(i), paidBefore: Number(i.paid || 0), total: Number(i.due ?? i.total) }));
    for (const a of allocations) if (a.amount + a.tds > a.due + 0.01) return setErr(`${a.number}: more than the balance ${inr(a.due)}.`);
    if (!allocations.length && !(Number(advance) > 0)) return setErr("Enter an amount against an invoice or as an advance.");
    const account = accounts.find((a) => a.id === accountId);
    if (!account) return setErr("Choose the account the money went into.");
    setBusy(true);
    try {
      const payId = await createDoc("payments", {
        date, clientId, clientName: client?.displayName || client?.legalName || "", mode, accountId, accountHolder: account.holderId ?? null,
        amount: totalCash, tds: totalTds, allocations: allocations.map(({ invoiceId, number, amount, tds, projectId }) => ({ invoiceId, number, amount, tds, projectId })),
        invoiceIds: allocations.map((a) => a.invoiceId), advance: Number(advance) || 0, advanceProjectId: advanceProject || null,
        billingType, quarter: tdsQuarter(date), tds26AS: false, tdsCertReceived: false, notes,
      });
      for (const a of allocations) {
        const paid = a.paidBefore + a.amount + a.tds;
        await updateDoc("invoices", a.invoiceId, { paid: increment(a.amount + a.tds), status: paid >= a.total - 0.01 ? "Paid" : "Partly paid" });
        if (a.amount > 0)
          await createDoc("entries", {
            date, direction: "in", amount: a.amount, scope: a.projectId ? "project" : "company", projectId: a.projectId,
            category: "Client payment against invoice", billingType, accountId, accountHolder: account.holderId ?? null, mode,
            notes: `${client?.displayName ?? ""} — ${a.number}${a.tds ? ` (TDS ${inr(a.tds)})` : ""}`, linkedDoc: { type: "payment", id: payId }, status: "approved",
          });
      }
      if (Number(advance) > 0)
        await createDoc("entries", {
          date, direction: "in", amount: Number(advance), scope: advanceProject ? "project" : "company", projectId: advanceProject || null,
          category: "Client advance", billingType, accountId, accountHolder: account.holderId ?? null, mode,
          notes: `Advance from ${client?.displayName ?? ""}`, linkedDoc: { type: "payment", id: payId }, status: "approved",
        });
      router.push(params.get("invoiceId") ? `/invoices/${params.get("invoiceId")}` : "/payments");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <div className="max-w-4xl">
      <PageHeader title="Record client payment" back="/payments" />
      <form onSubmit={save} className="space-y-4">
        <div className="card grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <label className="label">Client *</label>
            <select className="input" required value={clientId} onChange={(e) => { setClientId(e.target.value); setAlloc({}); }}>
              <option value="">—</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{String(c.displayName || c.legalName)}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Invoices type</label>
            <select className="input" value={billingType} onChange={(e) => { setBillingType(e.target.value); setAlloc({}); }}>
              <option value="gst">GST</option>{nonGst && <option value="nonGst">Non-GST</option>}
            </select>
          </div>
          <div><label className="label">Date</label><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
          <div><label className="label">Mode</label><select className="input" value={mode} onChange={(e) => setMode(e.target.value)}>{MODES.map((m) => <option key={m}>{m}</option>)}</select></div>
          <div>
            <label className="label">Received into</label>
            <select className="input" required value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              <option value="">—</option>
              {accounts.filter((a) => a.active !== false).map((a) => <option key={a.id} value={a.id}>{String(a.name)}</option>)}
            </select>
          </div>
          <div><label className="label">Notes / reference</label><input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="UTR, cheque no." /></div>
        </div>

        <div className="card overflow-x-auto">
          <h2 className="border-b border-border px-4 py-3 text-sm font-semibold">Against invoices</h2>
          {!clientId ? <div className="p-4 text-sm text-muted">Choose a client.</div> : !open.length ? <div className="p-4 text-sm text-muted">No open {billingType === "gst" ? "GST" : "non-GST"} invoices.</div> : (
            <table className="table">
              <thead><tr><th>Invoice</th><th>Date</th><th className="text-right">Balance</th><th className="w-36">Amount received</th><th className="w-32">TDS deducted</th></tr></thead>
              <tbody>
                {open.map((i) => (
                  <tr key={i.id}>
                    <td>{String(i.number)}</td>
                    <td>{fmtDate(i.date)}</td>
                    <td className="text-right tabular-nums">{inr(invoiceDue(i))}</td>
                    <td><input className="input !py-1 text-right" type="number" step="0.01" value={alloc[i.id]?.amount ?? ""} onChange={(e) => setAlloc({ ...alloc, [i.id]: { amount: e.target.value, tds: alloc[i.id]?.tds ?? "" } })} /></td>
                    <td><input className="input !py-1 text-right" type="number" step="0.01" value={alloc[i.id]?.tds ?? ""} onChange={(e) => setAlloc({ ...alloc, [i.id]: { amount: alloc[i.id]?.amount ?? "", tds: e.target.value } })} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="card grid gap-3 p-4 sm:grid-cols-2">
          <div><label className="label">Advance (not against an invoice)</label><input className="input" type="number" step="0.01" value={advance} onChange={(e) => setAdvance(e.target.value)} /></div>
          <div>
            <label className="label">Advance for project</label>
            <select className="input" value={advanceProject} onChange={(e) => setAdvanceProject(e.target.value)}>
              <option value="">— company —</option>
              {projects.filter((p) => p.clientId === clientId).map((p) => <option key={p.id} value={p.id}>{String(p.name)}</option>)}
            </select>
          </div>
        </div>

        <div className="card flex flex-wrap gap-6 p-4 text-sm">
          <div>Cash received <b className="tabular-nums">{inr(totalCash)}</b></div>
          <div>TDS deducted <b className="tabular-nums">{inr(totalTds)}</b></div>
          <div>Settles <b className="tabular-nums">{inr(totalCash + totalTds - (Number(advance) || 0))}</b> of invoices</div>
        </div>
        {err && <ErrorBox>{err}</ErrorBox>}
        <button className="btn-primary" disabled={busy}>{busy ? "Saving…" : "Save payment"}</button>
      </form>
    </div>
  );
}
