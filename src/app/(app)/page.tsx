"use client";

import Link from "next/link";
import { useMemo } from "react";
import { Badge, Empty, PageHeader, Stat } from "@/components/ui";
import { useAuth } from "@/lib/auth-context";
import { useCollection } from "@/lib/hooks";
import { balances, useEntries, useTransfers } from "@/lib/money";
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
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
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
                <span className="tabular-nums">{inr(bal.get(a.id))}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-muted">Who owes us</h2>
        <div className="card"><Empty>Receivables and ageing appear here once invoicing (module 15) is built in the next phase.</Empty></div>
      </section>

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
                          <td className="text-right tabular-nums">{inr(received)}</td>
                          <td className="text-right tabular-nums">{inr(cost)}</td>
                          <td className={`text-right tabular-nums ${profit < 0 ? "text-danger" : "text-ok"}`}>{inr(profit)}</td>
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
