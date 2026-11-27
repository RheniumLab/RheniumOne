"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { collectionGroup, onSnapshot, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useStock } from "@/lib/stock";
import { Badge, Empty, PageHeader, Stat } from "@/components/ui";
import { useAuth } from "@/lib/auth-context";
import { useCollection } from "@/lib/hooks";
import { AGE_BUCKETS, ageBucket, ageDays, balances, invoiceDue, useEntries, useTransfers } from "@/lib/money";
import { fmtDate, inr } from "@/lib/data";
import { PROJECT_STATUSES } from "@/lib/seed";

/** Home dashboard (§11): how much money we have and where, who owes us, how each project is doing. */
export default function Dashboard() {
  const { can, isAdmin, profile, user } = useAuth();
  const { rows: accounts } = useCollection("accounts");
  const entries = useEntries();
  const transfers = useTransfers();
  const projects = useCollection("projects", [], { gstAware: true, enabled: can("projects", "view") });
  const seeAll = isAdmin || can("custody", "approve");

  const bal = useMemo(() => balances(accounts, entries.rows, transfers.rows), [accounts, entries.rows, transfers.rows]);
  const visibleAccts = accounts.filter((a) => a.active !== false && (seeAll || a.holderId === user?.uid));
  const total = visibleAccts.reduce((s, a) => s + (bal.get(a.id) ?? 0), 0);

  const month = new Date().toISOString().slice(0, 7);
  const thisMonth = entries.rows.filter((e) => String(e.date).startsWith(month) && e.status !== "pending");
  const mIn = thisMonth.filter((e) => e.direction === "in").reduce((s, e) => s + Number(e.amount), 0);
  const mOut = thisMonth.filter((e) => e.direction === "out").reduce((s, e) => s + Number(e.amount), 0);

  const projectStats = useMemo(() => {
    return projects.rows
      .filter((p) => p.status !== "Completed" && p.status !== "Cancelled")
      .map((p) => {
        const es = entries.rows.filter((e) => e.projectId === p.id && e.status !== "pending");
        const received = es.filter((e) => e.direction === "in").reduce((s, e) => s + Number(e.amount), 0);
        const cost = es.filter((e) => e.direction === "out").reduce((s, e) => s + Number(e.amount), 0);
        return { p, received, cost, profit: received - cost };
      });
  }, [projects.rows, entries.rows]);

  return (
    <div className="space-y-6">
      <PageHeader title={`Hello, ${profile?.name?.split(" ")[0] ?? ""}`} subtitle="Money, dues and projects at a glance" />

      <section>
        <h2 className="mb-2 text-sm font-semibold text-muted">Money — where it sits</h2>
        <div className="stat-row">
          <Stat label={seeAll ? "Total cash position" : "Your wallet"} value={inr(total)} />
          {can("cashflow", "view") && <Stat label="In this month" value={inr(mIn)} />}
          {can("cashflow", "view") && <Stat label="Out this month" value={inr(mOut)} />}
          {can("cashflow", "view") && <Stat label="Net this month" value={inr(mIn - mOut)} tone={mIn - mOut < 0 ? "danger" : "ok"} />}
        </div>
        {seeAll && visibleAccts.length > 0 && (
          <div className="card mt-3 divide-y divide-border">
            {visibleAccts.map((a) => (
              <div key={a.id} className="flex justify-between px-4 py-2 text-sm">
                <span>{String(a.name)}</span>
                <span className="whitespace-nowrap tabular-nums">{inr(bal.get(a.id))}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      {can("invoices", "view") && <Receivables />}
      <Alerts />

      {can("projects", "view") && (
        <section>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-muted">Projects</h2>
            <div className="flex flex-wrap gap-1">
              {PROJECT_STATUSES.map((s) => {
                const n = projects.rows.filter((p) => p.status === s).length;
                return n ? <Badge key={s}>{`${s}: ${n}`}</Badge> : null;
              })}
            </div>
          </div>
          <div className="card overflow-x-auto">
            {!projectStats.length ? <Empty>No active projects.</Empty> : (
              <table className="table">
                <thead><tr><th>Project</th><th>Status</th><th>Target</th>{can("cashflow", "view") && <><th className="text-right">Received</th><th className="text-right">Direct cost</th><th className="text-right">Direct profit</th></>}</tr></thead>
                <tbody>
                  {projectStats.map(({ p, received, cost, profit }) => (
                    <tr key={p.id}>
                      <td><Link href={`/projects/${p.id}`} className="font-medium text-brand hover:underline">{String(p.name)}</Link><div className="text-xs text-muted">{String(p.code)} · {String(p.projectType)}</div></td>
                      <td><Badge>{String(p.status)}</Badge></td>
                      <td className={p.targetDate && String(p.targetDate) < new Date().toISOString().slice(0, 10) ? "text-danger" : ""}>{fmtDate(p.targetDate)}</td>
                      {can("cashflow", "view") && (
                        <>
                          <td className="whitespace-nowrap text-right tabular-nums">{inr(received)}</td>
                          <td className="whitespace-nowrap text-right tabular-nums">{inr(cost)}</td>
                          <td className={`whitespace-nowrap text-right tabular-nums ${profit < 0 ? "text-danger" : "text-ok"}`}>{inr(profit)}</td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

function Receivables() {
  const invoices = useCollection("invoices", [], { gstAware: true });
  const open = invoices.rows.filter((i) => invoiceDue(i) > 0);
  const total = open.reduce((s, i) => s + invoiceDue(i), 0);
  const buckets = Object.fromEntries(AGE_BUCKETS.map((b) => [b, open.filter((i) => ageBucket(ageDays(i.date)) === b).reduce((s, i) => s + invoiceDue(i), 0)]));
  const byClient = new Map<string, { id: string; due: number }>();
  for (const i of open) { const e = byClient.get(String(i.clientName)) ?? { id: String(i.clientId), due: 0 }; e.due += invoiceDue(i); byClient.set(String(i.clientName), e); }
  return (
    <section>
      <div className="mb-2 flex items-center justify-between"><h2 className="text-sm font-semibold text-muted">Who owes us</h2><Link className="text-xs text-brand" href="/payments">Dues & ageing →</Link></div>
      <div className="stat-row">
        <Stat label="Outstanding" value={inr(total)} />
        {AGE_BUCKETS.map((b) => <Stat key={b} label={`${b} days`} value={inr(buckets[b])} tone={b === "90+" && buckets[b] > 0 ? "danger" : undefined} />)}
      </div>
      {byClient.size > 0 && (
        <div className="card mt-3 divide-y divide-border">
          {[...byClient.entries()].sort((a, b) => b[1].due - a[1].due).slice(0, 6).map(([n, e]) => (
            <Link key={n} href={`/clients/${e.id}`} className="flex justify-between px-4 py-2 text-sm hover:bg-surface-2"><span>{n}</span><span className="whitespace-nowrap tabular-nums">{inr(e.due)}</span></Link>
          ))}
        </div>
      )}
    </section>
  );
}

/** Alerts and my work: approvals, handovers, low stock, asset service, my tasks and action items. */
function Alerts() {
  const { can, user } = useAuth();
  const { low } = useStock();
  const assets = useCollection("assets", [], { enabled: can("assets", "view") });
  const meetings = useCollection("meetings", [], { enabled: can("meetings", "view") });
  const myTasks = useMyTasks(user?.uid);
  const in30 = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);
  const assetsDue = assets.rows.filter((a) => a.status !== "Disposed" && ["serviceDue", "calibrationDue", "warrantyUntil"].some((k) => a[k] && String(a[k]) <= in30));
  const myActions = meetings.rows.flatMap((m) => ((m.actions ?? []) as Record<string, unknown>[]).filter((a) => a.owner === user?.uid && a.status !== "Done").map((a): Record<string, unknown> => ({ ...a, m })));
  const items: { href: string; text: string; danger?: boolean }[] = [
    ...low.map((it) => ({ href: `/inventory/${it.id}`, text: `Low stock: ${it.name}`, danger: true })),
    ...assetsDue.map((a) => ({ href: `/assets/${a.id}`, text: `Service / calibration / warranty due: ${a.name}` })),
    ...myTasks.map((t) => ({ href: `/projects/${t.projectId}`, text: `Task: ${t.title}${t.due ? ` (due ${fmtDate(t.due)})` : ""}`, danger: Boolean(t.due && String(t.due) < today) })),
    ...myActions.map((a) => ({ href: `/meetings/${(a.m as { id: string }).id}`, text: `Action: ${a.description}${a.due ? ` (due ${fmtDate(a.due)})` : ""}`, danger: Boolean(a.due && String(a.due) < today) })),
  ];
  if (!items.length) return null;
  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold text-muted">Needs attention</h2>
      <div className="card divide-y divide-border">
        {items.slice(0, 15).map((x, i) => (
          <Link key={i} href={x.href} className={`block px-4 py-2 text-sm hover:bg-surface-2 ${x.danger ? "text-danger" : ""}`}>{x.text}</Link>
        ))}
      </div>
    </section>
  );
}

/** Tasks assigned to me across projects (collection group query). */
function useMyTasks(uid?: string) {
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  useEffect(() => {
    if (!uid) return;
    return onSnapshot(
      query(collectionGroup(db(), "tasks"), where("assignee", "==", uid)),
      (s) => setRows(s.docs.map((d) => ({ id: d.id, projectId: d.ref.parent.parent?.id, ...d.data() })).filter((t) => (t as Record<string, unknown>).status !== "done")),
      () => setRows([]),
    );
  }, [uid]);
  return rows as (Record<string, unknown> & { projectId?: string; title?: string; due?: string })[];
}
