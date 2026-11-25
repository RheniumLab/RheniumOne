"use client";

import { useMemo, useState } from "react";
import { ArrowRightLeft, Check, Landmark, Plus, Wallet } from "lucide-react";
import { Badge, Empty, ErrorBox, PageHeader, Stat } from "@/components/ui";
import { useAuth } from "@/lib/auth-context";
import { useCollection } from "@/lib/hooks";
import { balances, useEntries, useTransfers } from "@/lib/money";
import { createDoc, fmtDate, inr, today, updateDoc } from "@/lib/data";

export default function AccountsPage() {
  const { can, isAdmin, user } = useAuth();
  const { rows: accountsAll } = useCollection("accounts");
  const { rows: users } = useCollection("users");
  const entries = useEntries();
  const transfers = useTransfers();
  const [showTransfer, setShowTransfer] = useState(false);
  const [showBank, setShowBank] = useState(false);

  const seeAll = isAdmin || can("custody", "approve");
  const accounts = accountsAll.filter((a) => a.active !== false);
  const visible = accounts.filter((a) => seeAll || a.holderId === user?.uid);
  const bal = useMemo(() => balances(accounts, entries.rows, transfers.rows), [accounts, entries.rows, transfers.rows]);
  const total = visible.reduce((s, a) => s + (bal.get(a.id) ?? 0), 0);
  const bankTotal = visible.filter((a) => a.kind === "bank").reduce((s, a) => s + (bal.get(a.id) ?? 0), 0);
  const name = (id: unknown) => String(accountsAll.find((a) => a.id === id)?.name ?? "—");
  const toConfirm = transfers.rows.filter((t) => t.status === "pending" && t.toHolder === user?.uid);
  const sortedTransfers = [...transfers.rows].sort((a, b) => String(b.date).localeCompare(String(a.date)));

  return (
    <div className="space-y-5">
      <PageHeader
        title="Accounts & cash custody"
        subtitle={seeAll ? "Every bank account and every person’s cash wallet" : "Your cash wallet"}
        actions={
          <>
            {can("custody", "create") && <button className="btn-primary" onClick={() => setShowTransfer((x) => !x)}><ArrowRightLeft size={15} /> Transfer / handover</button>}
            {isAdmin && <button className="btn" onClick={() => setShowBank((x) => !x)}><Plus size={15} /> Bank account</button>}
          </>
        }
      />

      {toConfirm.length > 0 && (
        <div className="card border-warn/50 p-4">
          <h2 className="mb-2 text-sm font-semibold">Handovers waiting for your confirmation</h2>
          {toConfirm.map((t) => (
            <div key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-1 text-sm">
              <span>{fmtDate(t.date)} · {inr(Number(t.amount))} from {name(t.fromAccountId)} {t.note ? `· ${t.note}` : ""}</span>
              <span className="flex gap-2">
                <button className="btn-primary !py-1" onClick={() => updateDoc("transfers", t.id, { status: "confirmed", confirmedAt: new Date().toISOString() }, t)}><Check size={14} /> Received</button>
                <button className="btn-danger !py-1" onClick={() => updateDoc("transfers", t.id, { status: "disputed" }, t)}>Not received</button>
              </span>
            </div>
          ))}
        </div>
      )}

      {showBank && <BankForm onDone={() => setShowBank(false)} />}
      {showTransfer && <TransferForm accounts={accounts} onDone={() => setShowTransfer(false)} />}

      {seeAll && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <Stat label="Total cash position" value={inr(total)} />
          <Stat label="In banks" value={inr(bankTotal)} />
          <Stat label="With people (cash)" value={inr(total - bankTotal)} />
        </div>
      )}

      {entries.error && <ErrorBox>{entries.error}</ErrorBox>}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {visible.map((a) => (
          <div key={a.id} className="card flex items-center gap-3 p-4">
            <div className="rounded-full bg-surface-2 p-2 text-muted">{a.kind === "bank" ? <Landmark size={18} /> : <Wallet size={18} />}</div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{String(a.name)}</div>
              <div className="text-xs text-muted">{a.kind === "bank" ? "Bank account" : `Cash wallet · ${String(users.find((u) => u.id === a.holderId)?.name ?? "")}`}</div>
            </div>
            <div className={`text-right font-semibold tabular-nums ${(bal.get(a.id) ?? 0) < 0 ? "text-danger" : ""}`}>{inr(bal.get(a.id))}</div>
          </div>
        ))}
        {!visible.length && <Empty>No accounts yet.{isAdmin ? " Add a bank account to get started." : ""}</Empty>}
      </div>

      <div className="card">
        <h2 className="border-b border-border px-4 py-3 text-sm font-semibold">Transfers and handovers</h2>
        {!sortedTransfers.length ? <Empty>No transfers yet.</Empty> : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead><tr><th>Date</th><th>From</th><th>To</th><th>Kind</th><th className="text-right">Amount</th><th>Status</th></tr></thead>
              <tbody>
                {sortedTransfers.map((t) => (
                  <tr key={t.id}>
                    <td>{fmtDate(t.date)}</td>
                    <td>{name(t.fromAccountId)}</td>
                    <td>{name(t.toAccountId)}</td>
                    <td>{String(t.kind)}</td>
                    <td className="text-right tabular-nums">{inr(Number(t.amount))}</td>
                    <td><Badge>{t.status === "pending" ? "Awaiting receiver" : String(t.status)}</Badge></td>
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

function BankForm({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState("");
  const [opening, setOpening] = useState("");
  return (
    <form
      className="card grid gap-3 p-4 sm:grid-cols-[2fr_1fr_auto]"
      onSubmit={async (e) => {
        e.preventDefault();
        await createDoc("accounts", { name, kind: "bank", openingBalance: Number(opening || 0), holderId: null, active: true });
        onDone();
      }}
    >
      <div><label className="label">Bank account name</label><input className="input" required placeholder="e.g. HDFC Current ••1234" value={name} onChange={(e) => setName(e.target.value)} /></div>
      <div><label className="label">Opening balance (₹)</label><input className="input" type="number" step="0.01" value={opening} onChange={(e) => setOpening(e.target.value)} /></div>
      <button className="btn-primary self-end">Add</button>
    </form>
  );
}

/** Transfers are not income or expense (§8.5). Person-to-person handovers count only after the receiver confirms. */
function TransferForm({ accounts, onDone }: { accounts: Record<string, unknown>[]; onDone: () => void }) {
  const { user, can } = useAuth();
  const fromOptions = accounts.filter((a) => can("cashflow", "create") || a.holderId === user?.uid);
  const [v, setV] = useState({ date: today(), from: "", to: "", amount: "", note: "" });
  const [err, setErr] = useState<string | null>(null);
  return (
    <form
      className="card grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-5"
      onSubmit={async (e) => {
        e.preventDefault();
        const from = accounts.find((a) => a.id === v.from);
        const to = accounts.find((a) => a.id === v.to);
        if (!from || !to || from === to) return setErr("Choose two different accounts.");
        const kind =
          from.kind === "cash" && to.kind === "cash" ? "Handover" : from.kind === "cash" ? "Cash deposit" : to.kind === "cash" ? "Cash withdrawal" : "Bank transfer";
        // A handover to someone else waits for them to confirm.
        const needsConfirm = to.kind === "cash" && to.holderId !== user?.uid;
        await createDoc("transfers", {
          date: v.date,
          amount: Number(v.amount),
          fromAccountId: v.from,
          toAccountId: v.to,
          fromHolder: from.holderId ?? null,
          toHolder: to.holderId ?? null,
          kind,
          note: v.note,
          status: needsConfirm ? "pending" : "confirmed",
        });
        onDone();
      }}
    >
      <div><label className="label">Date</label><input className="input" type="date" value={v.date} onChange={(e) => setV({ ...v, date: e.target.value })} /></div>
      <div>
        <label className="label">From</label>
        <select className="input" required value={v.from} onChange={(e) => setV({ ...v, from: e.target.value })}>
          <option value="">—</option>
          {fromOptions.map((a) => <option key={String(a.id)} value={String(a.id)}>{String(a.name)}</option>)}
        </select>
      </div>
      <div>
        <label className="label">To</label>
        <select className="input" required value={v.to} onChange={(e) => setV({ ...v, to: e.target.value })}>
          <option value="">—</option>
          {accounts.map((a) => <option key={String(a.id)} value={String(a.id)}>{String(a.name)}</option>)}
        </select>
      </div>
      <div><label className="label">Amount (₹)</label><input className="input" type="number" step="0.01" min="0.01" required value={v.amount} onChange={(e) => setV({ ...v, amount: e.target.value })} /></div>
      <div><label className="label">Note</label><input className="input" value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} /></div>
      {err && <div className="sm:col-span-2 lg:col-span-5"><ErrorBox>{err}</ErrorBox></div>}
      <div className="sm:col-span-2 lg:col-span-5"><button className="btn-primary">Record transfer</button></div>
    </form>
  );
}
