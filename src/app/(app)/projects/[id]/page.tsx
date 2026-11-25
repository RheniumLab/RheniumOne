"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { addDoc, collection, deleteDoc, doc, orderBy, serverTimestamp, updateDoc as fsUpdate, where } from "firebase/firestore";
import { ExternalLink, Plus, Trash2 } from "lucide-react";
import { EntityDetail } from "@/components/entity";
import { LinkedRecords } from "@/components/conversions";
import { UserSelect } from "@/components/fields";
import { Badge, Cell, Empty, Stat } from "@/components/ui";
import { useAuth } from "@/lib/auth-context";
import { ENTITIES } from "@/lib/entities";
import { db } from "@/lib/firebase";
import { useCollection } from "@/lib/hooks";
import { fmtDate, inr, type Doc } from "@/lib/data";
import { projectTransform } from "../transform";
import { DocsPanel } from "@/components/docs-panel";
import { invoiceDue } from "@/lib/money";
import { DateInput } from "@/components/date-input";

export default function ProjectPage() {
  const { id } = useParams<{ id: string }>();
  const [tab, setTab] = useState<"overview" | "tasks" | "money" | "documents" | "build" | "comments">("overview");
  return (
    <EntityDetail def={ENTITIES.projects} id={id} transform={projectTransform}>
      {(p) => (
        <div className="mb-4 space-y-4">
          <LinkedRecords collection="projects" id={id} data={p} />
          <MoneyView project={p} id={id} />
          <div className="flex gap-1 border-b border-border">
            {(["overview", "tasks", "money", "documents", "build", "comments"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`-mb-px border-b-2 px-3 py-2 text-sm capitalize ${tab === t ? "border-brand font-medium text-brand" : "border-transparent text-muted hover:text-text"}`}
              >
                {t}
              </button>
            ))}
          </div>
          {tab === "overview" && <Overview p={p} />}
          {tab === "tasks" && <Tasks projectId={id} />}
          {tab === "money" && <ProjectEntries projectId={id} />}
          {tab === "documents" && <DocsPanel filter={{ projectId: id }} />}
          {tab === "build" && <Build projectId={id} />}
          {tab === "comments" && <Comments projectId={id} />}
        </div>
      )}
    </EntityDetail>
  );
}

function useProjectEntries(projectId: string) {
  const { can } = useAuth();
  return useCollection("entries", [where("projectId", "==", projectId)], { gstAware: true, enabled: can("cashflow", "view") }, [projectId]);
}

/** §6.1 money view: quoted, invoiced, received, outstanding, direct costs, direct profit. */
function MoneyView({ project, id }: { project: Record<string, unknown>; id: string }) {
  const { can } = useAuth();
  const { rows } = useProjectEntries(id);
  const invoices = useCollection("invoices", [where("projectId", "==", id)], { gstAware: true, enabled: can("invoices", "view") }, [id]);
  const live = invoices.rows.filter((i) => i.status !== "Draft" && i.status !== "Cancelled");
  const invoiced = live.reduce((s, i) => s + Number(i.total || 0), 0);
  const dues = live.reduce((s, i) => s + invoiceDue(i), 0);
  const counted = rows.filter((e) => e.status !== "pending");
  const received = counted.filter((e) => e.direction === "in").reduce((s, e) => s + Number(e.amount || 0), 0);
  const costs = counted.filter((e) => e.direction === "out").reduce((s, e) => s + Number(e.amount || 0), 0);
  if (project.projectType === "Internal product") {
    const budget = Number(project.budget || 0);
    return (
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Development budget" value={inr(budget)} />
        <Stat label="Spent to date" value={inr(costs)} />
        <Stat label="Remaining" value={inr(budget - costs)} tone={budget - costs < 0 ? "danger" : "ok"} />
        <Stat label="Used" value={budget ? `${Math.round((costs / budget) * 100)}%` : "—"} />
      </div>
    );
  }
  const value = Number(project.value || 0);
  const profit = received - costs;
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
      <Stat label="Quoted value" value={inr(value)} />
      <Stat label="Invoiced" value={inr(invoiced)} hint={value ? `${Math.round((invoiced / value) * 100)}% of value` : undefined} />
      <Stat label="Received" value={inr(received)} />
      <Stat label="Outstanding dues" value={inr(dues)} tone={dues > 0 ? "danger" : undefined} />
      <Stat label="Direct costs" value={inr(costs)} />
      <Stat label="Direct profit" value={inr(profit)} tone={profit < 0 ? "danger" : "ok"} hint={received ? `${Math.round((profit / received) * 100)}% margin on received` : undefined} />
    </div>
  );
}

function Overview({ p }: { p: Record<string, unknown> }) {
  const repos = (p.repos as { url?: string; branch?: string }[]) ?? [];
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="card p-4">
        <h2 className="mb-2 text-sm font-semibold">Scope</h2>
        <p className="whitespace-pre-wrap text-sm">{String(p.scope || "—")}</p>
      </div>
      <div className="card p-4">
        <h2 className="mb-2 text-sm font-semibold">Code repositories</h2>
        {repos.length ? (
          <ul className="space-y-1 text-sm">
            {repos.map((r, i) => (
              <li key={i} className="flex items-center gap-2">
                <a className="flex items-center gap-1 text-brand hover:underline" href={r.url} target="_blank" rel="noreferrer">
                  {r.url} <ExternalLink size={12} />
                </a>
                {r.branch && <Badge kind="muted">{r.branch}</Badge>}
              </li>
            ))}
          </ul>
        ) : (
          <div className="text-sm text-muted">No repositories linked. Edit the project to add one.</div>
        )}
      </div>
    </div>
  );
}

const TASK_STATUSES = [
  { key: "todo", label: "To do" },
  { key: "doing", label: "Doing" },
  { key: "done", label: "Done" },
];

function Tasks({ projectId }: { projectId: string }) {
  const { can, user } = useAuth();
  const { rows } = useCollection(`projects/${projectId}/tasks`, [], {}, [projectId]);
  const { rows: users } = useCollection("users");
  const [view, setView] = useState<"board" | "list">("board");
  const [title, setTitle] = useState("");
  const [assignee, setAssignee] = useState("");
  const [due, setDue] = useState("");
  const [milestone, setMilestone] = useState("");
  const editable = can("projects", "edit");
  const col = () => collection(db(), "projects", projectId, "tasks");
  const name = (uid: unknown) => String(users.find((u) => u.id === uid)?.name ?? "");

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    void addDoc(col(), { title, assignee: assignee || null, due: due || null, milestone: milestone || null, status: "todo", createdBy: user?.uid, createdAt: serverTimestamp() });
    setTitle(""); setDue("");
  }
  const move = (t: Doc, status: string) => void fsUpdate(doc(col(), t.id), { status });
  const remove = (t: Doc) => confirm("Delete task?") && void deleteDoc(doc(col(), t.id));
  const overdue = (t: Doc) => t.status !== "done" && t.due && String(t.due) < new Date().toISOString().slice(0, 10);
  const meetings = useCollection("meetings", [where("projectId", "==", projectId)], { enabled: can("meetings", "view") }, [projectId]);
  const actionItems = meetings.rows.flatMap((m) => ((m.actions ?? []) as Record<string, unknown>[]).map((a, i): Record<string, unknown> => ({ ...a, meeting: m, idx: i })));

  const card = (t: Doc) => (
    <div key={t.id} className="rounded-md border border-border bg-surface p-2 text-sm">
      <div className="flex items-start justify-between gap-2">
        <span className="font-medium">{String(t.title)}</span>
        {editable && <button onClick={() => remove(t)} className="text-muted hover:text-danger" aria-label="Delete task"><Trash2 size={13} /></button>}
      </div>
      <div className="mt-1 flex flex-wrap gap-1 text-xs text-muted">
        {t.milestone ? <Badge kind="brand">{String(t.milestone)}</Badge> : null}
        {t.assignee ? <span>{name(t.assignee)}</span> : null}
        {t.due ? <span className={overdue(t) ? "text-danger" : ""}>· due {fmtDate(t.due)}</span> : null}
      </div>
      {editable && (
        <select className="input mt-2 !py-1 text-xs" value={String(t.status)} onChange={(e) => move(t, e.target.value)}>
          {TASK_STATUSES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
      )}
    </div>
  );

  return (
    <div className="space-y-3">
      {editable && (
        <form onSubmit={add} className="card grid gap-2 p-3 sm:grid-cols-[2fr_1fr_1fr_1fr_auto]">
          <input className="input" placeholder="New task" value={title} onChange={(e) => setTitle(e.target.value)} />
          <input className="input" placeholder="Milestone" value={milestone} onChange={(e) => setMilestone(e.target.value)} />
          <UserSelect value={assignee} onChange={setAssignee} />
          <DateInput placeholder="Due date" value={due} onChange={(val) => setDue(val)} />
          <button className="btn-primary"><Plus size={14} /> Add</button>
        </form>
      )}
      {actionItems.length > 0 && (
        <div className="card p-3">
          <h3 className="mb-2 text-xs font-semibold text-muted">Action items from meetings</h3>
          {actionItems.map((a, i) => (
            <Link key={i} href={`/meetings/${(a.meeting as Doc).id}`} className="flex flex-wrap items-center justify-between gap-2 py-1 text-sm hover:text-brand">
              <span>{String(a.description ?? "")} <span className="text-xs text-muted">· {name(a.owner)} · {String((a.meeting as Doc).title)}</span></span>
              <span className="flex gap-1">{a.due ? <span className={a.status !== "Done" && String(a.due) < new Date().toISOString().slice(0, 10) ? "text-xs text-danger" : "text-xs text-muted"}>{fmtDate(a.due)}</span> : null}<Badge>{String(a.status ?? "Open")}</Badge></span>
            </Link>
          ))}
        </div>
      )}
      <div className="flex gap-1">
        <button className={view === "board" ? "btn-primary" : "btn"} onClick={() => setView("board")}>Board</button>
        <button className={view === "list" ? "btn-primary" : "btn"} onClick={() => setView("list")}>List</button>
      </div>
      {view === "board" ? (
        <div className="grid gap-3 md:grid-cols-3">
          {TASK_STATUSES.map((s) => (
            <div key={s.key} className="rounded-lg bg-surface-2 p-2">
              <div className="mb-2 px-1 text-xs font-semibold text-muted">{s.label} · {rows.filter((t) => t.status === s.key).length}</div>
              <div className="space-y-2">{rows.filter((t) => t.status === s.key).map(card)}</div>
            </div>
          ))}
        </div>
      ) : (
        <div className="card overflow-x-auto">
          {!rows.length ? <Empty>No tasks yet.</Empty> : (
            <table className="table">
              <thead><tr><th>Task</th><th>Milestone</th><th>Assignee</th><th>Due</th><th>Status</th></tr></thead>
              <tbody>
                {rows.map((t) => (
                  <tr key={t.id}>
                    <td>{String(t.title)}</td>
                    <td><Cell value={t.milestone} /></td>
                    <td>{name(t.assignee) || "—"}</td>
                    <td className={overdue(t) ? "text-danger" : ""}><Cell value={t.due} kind="date" /></td>
                    <td><Badge>{TASK_STATUSES.find((s) => s.key === t.status)?.label ?? String(t.status)}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

function ProjectEntries({ projectId }: { projectId: string }) {
  const { can } = useAuth();
  const { rows } = useProjectEntries(projectId);
  if (!can("cashflow", "view")) return <Empty>You don’t have access to cash flow.</Empty>;
  const sorted = [...rows].sort((a, b) => String(b.date).localeCompare(String(a.date)));
  return (
    <div className="card overflow-x-auto">
      <div className="flex justify-end border-b border-border p-2">
        {can("cashflow", "create") && <Link className="btn" href={`/cashflow/new?projectId=${projectId}`}><Plus size={14} /> New entry</Link>}
      </div>
      {!sorted.length ? <Empty>No money entries linked to this project.</Empty> : (
        <table className="table">
          <thead><tr><th>Date</th><th>Category</th><th>In / out</th><th className="text-right">Amount</th><th>Status</th></tr></thead>
          <tbody>
            {sorted.map((e) => (
              <tr key={e.id}>
                <td>{fmtDate(e.date)}</td>
                <td>{String(e.category ?? "")}</td>
                <td>{e.direction === "in" ? <Badge kind="ok">In</Badge> : <Badge kind="danger">Out</Badge>}</td>
                <td className="whitespace-nowrap text-right tabular-nums">{inr(Number(e.amount))}</td>
                <td><Badge>{String(e.status ?? "approved")}</Badge></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function Comments({ projectId }: { projectId: string }) {
  const { profile, user } = useAuth();
  const { rows } = useCollection(`projects/${projectId}/comments`, [orderBy("at", "desc")], {}, [projectId]);
  const [text, setText] = useState("");
  async function post(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    void addDoc(collection(db(), "projects", projectId, "comments"), { text, uid: user?.uid, name: profile?.name, at: serverTimestamp() });
    setText("");
  }
  return (
    <div className="space-y-3">
      <form onSubmit={post} className="flex gap-2">
        <input className="input" placeholder="Post an update…" value={text} onChange={(e) => setText(e.target.value)} />
        <button className="btn-primary">Post</button>
      </form>
      {rows.map((c) => (
        <div key={c.id} className="card p-3 text-sm">
          <div className="mb-1 text-xs text-muted">{String(c.name)} · {c.at?.toDate?.().toLocaleString("en-IN") ?? "just now"}</div>
          <div className="whitespace-pre-wrap">{String(c.text)}</div>
        </div>
      ))}
    </div>
  );
}

/** BOMs, purchase orders and invoices linked to this project. */
function Build({ projectId }: { projectId: string }) {
  const { can } = useAuth();
  const boms = useCollection("boms", [where("projectId", "==", projectId)], { enabled: can("boms", "view") }, [projectId]);
  const pos = useCollection("pos", [where("projectId", "==", projectId)], { gstAware: true, enabled: can("purchases", "view") }, [projectId]);
  const invoices = useCollection("invoices", [where("projectId", "==", projectId)], { gstAware: true, enabled: can("invoices", "view") }, [projectId]);
  const challans = useCollection("challans", [where("projectId", "==", projectId)], { enabled: can("challans", "view") }, [projectId]);
  const box = (title: string, newHref: string | null, rows: Doc[], href: (r: Doc) => string, label: (r: Doc) => string, right: (r: Doc) => React.ReactNode) => (
    <div className="card p-4">
      <div className="mb-2 flex items-center justify-between"><h2 className="text-sm font-semibold">{title}</h2>{newHref && <Link className="btn !py-1" href={newHref}><Plus size={13} /> New</Link>}</div>
      {rows.length ? rows.map((r) => <Link key={r.id} href={href(r)} className="flex justify-between gap-2 py-1 text-sm hover:text-brand"><span>{label(r)}</span><span className="flex gap-1">{right(r)}</span></Link>) : <div className="text-sm text-muted">None yet</div>}
    </div>
  );
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {can("boms", "view") && box("BOMs", can("boms", "create") ? "/boms" : null, boms.rows, (b) => `/boms/${b.id}`, (b) => `${b.code} · ${b.name} (Rev ${b.rev})`, (b) => <Badge kind="brand">{String(b.kind)}</Badge>)}
      {can("purchases", "view") && box("Purchase orders", can("purchases", "create") ? `/purchases/new?projectId=${projectId}` : null, pos.rows, (p) => `/purchases/${p.id}`, (p) => `${p.number ?? "Draft"} · ${p.vendorName}`, (p) => <><span className="whitespace-nowrap tabular-nums">{inr(Number(p.total))}</span><Badge>{String(p.status)}</Badge></>)}
      {can("invoices", "view") && box("Invoices", can("invoices", "create") ? `/invoices/new?projectId=${projectId}` : null, invoices.rows, (i) => `/invoices/${i.id}`, (i) => `${i.number ?? "Draft"} · ${fmtDate(i.date)}`, (i) => <><span className="whitespace-nowrap tabular-nums">{inr(Number(i.total))}</span><Badge>{String(i.status)}</Badge></>)}
      {can("challans", "view") && box("Delivery challans", can("challans", "create") ? `/challans/new?projectId=${projectId}` : null, challans.rows, (c) => `/challans/${c.id}`, (c) => `${c.number} · ${fmtDate(c.date)}`, (c) => <Badge>{String(c.status)}</Badge>)}
    </div>
  );
}
