"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { Badge, Empty, GstBadge, NoAccess, PageHeader, Stat } from "@/components/ui";
import { useAuth } from "@/lib/auth-context";
import { useCollection } from "@/lib/hooks";
import { fmtDate, inr, updateDoc } from "@/lib/data";
import { AGE_BUCKETS, ageBucket, ageDays, invoiceDue } from "@/lib/money";

/** Client payments, receivables ageing (§8.2) and TDS receivable (§8.3). */
export default function PaymentsPage() {
  const { can } = useAuth();
  const ok = can("invoices", "view") || can("tds", "view");
  const payments = useCollection("payments", [], { gstAware: true, enabled: ok });
  const invoices = useCollection("invoices", [], { gstAware: true, enabled: ok });
  const [tab, setTab] = useState<"payments" | "ageing" | "tds">("payments");
  if (!ok) return <NoAccess />;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Payments, dues & TDS"
        actions={can("invoices", "edit") && can("cashflow", "create") && <Link href="/payments/new" className="btn-primary"><Plus size={15} /> Record payment</Link>}
      />
      <div className="flex gap-1 border-b border-border">
        {([["payments", "Payments received"], ["ageing", "Dues & ageing"], ["tds", "TDS receivable"]] as const).map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className={`-mb-px border-b-2 px-3 py-2 text-sm ${tab === k ? "border-brand font-medium text-brand" : "border-transparent text-muted"}`}>{l}</button>
        ))}
      </div>
      {tab === "payments" && <PaymentsList rows={payments.rows} />}
      {tab === "ageing" && <Ageing invoices={invoices.rows} />}
      {tab === "tds" && <Tds rows={payments.rows} editable={can("tds", "edit") || can("invoices", "edit")} />}
    </div>
  );
}

function PaymentsList({ rows }: { rows: Record<string, unknown>[] }) {
  const sorted = [...rows].sort((a, b) => String(b.date).localeCompare(String(a.date)));
  if (!sorted.length) return <div className="card"><Empty>No payments recorded yet.</Empty></div>;
  return (
    <div className="card overflow-x-auto">
      <table className="table">
        <thead><tr><th>Date</th><th>Client</th><th>Against</th><th>Mode</th><th>Type</th><th className="text-right">Received</th><th className="text-right">TDS</th></tr></thead>
        <tbody>
          {sorted.map((p) => (
            <tr key={String(p.id)}>
              <td className="whitespace-nowrap">{fmtDate(p.date)}</td>
              <td>{String(p.clientName)}</td>
              <td className="text-xs">
                {((p.allocations ?? []) as Record<string, unknown>[]).map((a) => <Link key={String(a.invoiceId)} href={`/invoices/${a.invoiceId}`} className="mr-2 text-brand hover:underline">{String(a.number)}</Link>)}
                {Number(p.advance) > 0 && <Badge kind="brand">Advance {inr(Number(p.advance))}</Badge>}
              </td>
              <td>{String(p.mode)}</td>
              <td><GstBadge type={String(p.billingType)} /></td>
              <td className="text-right tabular-nums">{inr(Number(p.amount))}</td>
              <td className="text-right tabular-nums">{Number(p.tds) ? inr(Number(p.tds)) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Ageing({ invoices }: { invoices: Record<string, unknown>[] }) {
  const open = invoices.filter((i) => invoiceDue(i) > 0);
  const byClient = useMemo(() => {
    const m = new Map<string, { name: string; buckets: Record<string, number>; total: number }>();
    for (const i of open) {
      const k = String(i.clientId);
      const e = m.get(k) ?? { name: String(i.clientName), buckets: {}, total: 0 };
      const b = ageBucket(ageDays(i.date));
      e.buckets[b] = (e.buckets[b] ?? 0) + invoiceDue(i);
      e.total += invoiceDue(i);
      m.set(k, e);
    }
    return [...m.entries()].sort((a, b) => b[1].total - a[1].total);
  }, [open]);
  const totals = Object.fromEntries(AGE_BUCKETS.map((b) => [b, byClient.reduce((s, [, e]) => s + (e.buckets[b] ?? 0), 0)]));
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {AGE_BUCKETS.map((b) => <Stat key={b} label={`${b} days`} value={inr(totals[b])} tone={b === "90+" && totals[b] > 0 ? "danger" : undefined} />)}
      </div>
      <div className="card overflow-x-auto">
        {!byClient.length ? <Empty>Nothing outstanding.</Empty> : (
          <table className="table">
            <thead><tr><th>Client</th>{AGE_BUCKETS.map((b) => <th key={b} className="text-right">{b}</th>)}<th className="text-right">Total due</th></tr></thead>
            <tbody>
              {byClient.map(([id, e]) => (
                <tr key={id}>
                  <td><Link href={`/clients/${id}`} className="text-brand hover:underline">{e.name}</Link></td>
                  {AGE_BUCKETS.map((b) => <td key={b} className="text-right tabular-nums">{e.buckets[b] ? inr(e.buckets[b]) : "—"}</td>)}
                  <td className="text-right font-medium tabular-nums">{inr(e.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function Tds({ rows, editable }: { rows: Record<string, unknown>[]; editable: boolean }) {
  const withTds = rows.filter((p) => Number(p.tds) > 0).sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const groups = useMemo(() => {
    const m = new Map<string, { client: string; quarter: string; tds: number; pending: number }>();
    for (const p of withTds) {
      const k = `${p.clientId}|${p.quarter}`;
      const e = m.get(k) ?? { client: String(p.clientName), quarter: String(p.quarter), tds: 0, pending: 0 };
      e.tds += Number(p.tds);
      if (!p.tds26AS) e.pending += Number(p.tds);
      m.set(k, e);
    }
    return [...m.values()].sort((a, b) => b.quarter.localeCompare(a.quarter));
  }, [withTds]);
  const total = withTds.reduce((s, p) => s + Number(p.tds), 0);
  const pending = withTds.filter((p) => !p.tds26AS).reduce((s, p) => s + Number(p.tds), 0);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Stat label="TDS deducted by clients" value={inr(total)} />
        <Stat label="Not yet in Form 26AS" value={inr(pending)} tone={pending > 0 ? "danger" : "ok"} />
      </div>
      <div className="card overflow-x-auto">
        <h2 className="border-b border-border px-4 py-3 text-sm font-semibold">By client and quarter</h2>
        {!groups.length ? <Empty>No TDS recorded.</Empty> : (
          <table className="table">
            <thead><tr><th>Quarter</th><th>Client</th><th className="text-right">TDS</th><th className="text-right">Pending in 26AS</th></tr></thead>
            <tbody>{groups.map((g) => <tr key={g.client + g.quarter}><td>{g.quarter}</td><td>{g.client}</td><td className="text-right tabular-nums">{inr(g.tds)}</td><td className="text-right tabular-nums">{g.pending ? inr(g.pending) : "—"}</td></tr>)}</tbody>
          </table>
        )}
      </div>
      <div className="card overflow-x-auto">
        <h2 className="border-b border-border px-4 py-3 text-sm font-semibold">Each deduction</h2>
        {withTds.length > 0 && (
          <table className="table">
            <thead><tr><th>Date</th><th>Client</th><th>Invoices</th><th className="text-right">TDS</th><th>Shows in 26AS</th><th>Certificate received</th></tr></thead>
            <tbody>
              {withTds.map((p) => (
                <tr key={String(p.id)}>
                  <td>{fmtDate(p.date)}</td>
                  <td>{String(p.clientName)}</td>
                  <td className="text-xs">{((p.allocations ?? []) as Record<string, unknown>[]).map((a) => String(a.number)).join(", ")}</td>
                  <td className="text-right tabular-nums">{inr(Number(p.tds))}</td>
                  <td><input type="checkbox" disabled={!editable} checked={Boolean(p.tds26AS)} onChange={(e) => updateDoc("payments", String(p.id), { tds26AS: e.target.checked }, p)} /></td>
                  <td><input type="checkbox" disabled={!editable} checked={Boolean(p.tdsCertReceived)} onChange={(e) => updateDoc("payments", String(p.id), { tdsCertReceived: e.target.checked }, p)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
