"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { Badge, Empty, NoAccess, PageHeader } from "@/components/ui";
import { useAuth } from "@/lib/auth-context";
import { useCollection } from "@/lib/hooks";
import { useCompany } from "@/lib/business";
import { createDoc, fmtDate, updateDoc } from "@/lib/data";
import { agendaText, buildSnapshot } from "@/lib/snapshot";

/** §6.4 Meetings, MOM register and action items. The monthly review is created automatically. */
export default function MeetingsPage() {
  const { can, nonGst, user } = useAuth();
  const { rows } = useCollection("meetings", [], { enabled: can("meetings", "view") });
  const { rows: users } = useCollection("users");
  const { rows: projects } = useCollection("projects", [], { gstAware: true });
  const { rows: clients } = useCollection("clients", [], { enabled: can("clients", "view") });
  const company = useCompany();
  const [tab, setTab] = useState<"register" | "actions">("register");
  const [type, setType] = useState("");
  const [proj, setProj] = useState("");
  const [mine, setMine] = useState(false);
  const created = useRef(false);

  // Monthly review: created on the admin-set day each month (§6.4).
  useEffect(() => {
    const day = Number(company.monthlyReviewDay || 0);
    if (!day || created.current || !can("meetings", "create") || !rows) return;
    const now = new Date();
    const month = now.toISOString().slice(0, 7);
    if (now.getDate() < day) return;
    if (rows.some((m) => m.meetingType === "Monthly review" && m.month === month)) return;
    created.current = true;
    (async () => {
      const snap = await buildSnapshot(false);
      const full = nonGst ? await buildSnapshot(true) : null;
      const date = `${month}-${String(Math.min(day, 28)).padStart(2, "0")}`;
      await createDoc("meetings", {
        title: `Monthly review — ${now.toLocaleString("en-IN", { month: "long", year: "numeric" })}`, meetingType: "Monthly review", month, date,
        status: "Scheduled", agenda: agendaText(snap), snapshot: snap, snapshotFull: full, chair: user?.uid ?? null,
        actions: snap.openActions.map((a) => ({ description: `[carried] ${a.description}`, owner: users.find((u) => u.name === a.owner)?.id ?? null, due: a.due || null, status: "Open" })),
      });
    })().catch(() => { created.current = false; });
  }, [company.monthlyReviewDay, rows, can, nonGst, user?.uid, users]);

  const actions = useMemo(
    () => rows.flatMap((m) => ((m.actions ?? []) as Record<string, unknown>[]).map((a, idx) => ({ ...a, idx, m }) as Record<string, unknown> & { idx: number; m: typeof m })).filter((a) => a.status !== "Done"),
    [rows],
  );

  if (!can("meetings", "view")) return <NoAccess />;
  const uname = (id: unknown) => String(users.find((u) => u.id === id)?.name ?? "—");
  const today = new Date().toISOString().slice(0, 10);
  const register = rows
    .filter((m) => !type || m.meetingType === type)
    .filter((m) => !proj || m.projectId === proj || m.clientId === proj)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const byMonth = register.reduce((acc, m) => {
    const k = String(m.date ?? "").slice(0, 7);
    (acc[k] ??= []).push(m);
    return acc;
  }, {} as Record<string, typeof register>);
  const shownActions = actions.filter((a) => !mine || a.owner === user?.uid).sort((a, b) => String(a.due ?? "9").localeCompare(String(b.due ?? "9")));

  return (
    <div className="space-y-4">
      <PageHeader title="Meetings & MOM" subtitle={company.monthlyReviewDay ? `Monthly review is created on day ${company.monthlyReviewDay} each month` : "Set the monthly review day under Settings → Company"}
        actions={can("meetings", "create") && <Link href="/meetings/new" className="btn-primary"><Plus size={15} /> New meeting</Link>} />
      <div className="flex gap-1 border-b border-border">
        {([["register", "MOM register"], ["actions", `Open action items (${actions.length})`]] as const).map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className={`-mb-px border-b-2 px-3 py-2 text-sm ${tab === k ? "border-brand font-medium text-brand" : "border-transparent text-muted"}`}>{l}</button>
        ))}
      </div>
      {tab === "register" ? (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <select className="input !w-auto" value={type} onChange={(e) => setType(e.target.value)}>
              <option value="">All types</option>{["Monthly review", "Project meeting", "Client meeting", "Internal meeting"].map((t) => <option key={t}>{t}</option>)}
            </select>
            <select className="input !w-auto" value={proj} onChange={(e) => setProj(e.target.value)}>
              <option value="">All projects & clients</option>
              <optgroup label="Projects">{projects.map((p) => <option key={p.id} value={p.id}>{String(p.name)}</option>)}</optgroup>
              <optgroup label="Clients">{clients.map((c) => <option key={c.id} value={c.id}>{String(c.displayName || c.legalName)}</option>)}</optgroup>
            </select>
          </div>
          {!register.length ? <div className="card"><Empty>No meetings yet.</Empty></div> : Object.entries(byMonth).map(([month, ms]) => (
            <div key={month} className="card">
              <h2 className="border-b border-border px-4 py-2 text-sm font-semibold">{month ? new Date(month + "-01").toLocaleString("en-IN", { month: "long", year: "numeric" }) : "No date"}</h2>
              {ms.map((m) => (
                <Link key={m.id} href={`/meetings/${m.id}`} className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2 text-sm last:border-0 hover:bg-surface-2">
                  <span><b>{String(m.title)}</b> <span className="text-muted">· {fmtDate(m.date)} · {String(m.meetingType)}</span></span>
                  <span className="flex gap-1">{m.momVersion ? <Badge kind="muted">{`MOM v${m.momVersion}`}</Badge> : null}<Badge>{String(m.status)}</Badge></span>
                </Link>
              ))}
            </div>
          ))}
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <div className="border-b border-border p-3"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> Only mine</label></div>
          {!shownActions.length ? <Empty>No open action items.</Empty> : (
            <table className="table">
              <thead><tr><th>Action</th><th>Owner</th><th>Due</th><th>Meeting</th><th>Status</th></tr></thead>
              <tbody>
                {shownActions.map((a, i) => {
                  const late = a.due && String(a.due) < today;
                  const canEdit = can("meetings", "edit") || a.owner === user?.uid;
                  return (
                    <tr key={i}>
                      <td>{String(a.description ?? "")}</td>
                      <td>{uname(a.owner)}</td>
                      <td className={late ? "text-danger" : ""}>{fmtDate(a.due)}{late ? " · overdue" : ""}</td>
                      <td><Link className="text-brand hover:underline" href={`/meetings/${a.m.id}`}>{String(a.m.title)}</Link></td>
                      <td>
                        <select className="input !w-auto !py-1" disabled={!canEdit} value={String(a.status ?? "Open")} onChange={(e) => {
                          const list = [...((a.m.actions ?? []) as Record<string, unknown>[])];
                          list[a.idx] = { ...list[a.idx], status: e.target.value };
                          void updateDoc("meetings", a.m.id, { actions: list }, a.m);
                        }}>
                          {["Open", "In progress", "Done"].map((s) => <option key={s}>{s}</option>)}
                        </select>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
