"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowDown, ArrowUp, Plus, ShoppingCart } from "lucide-react";
import { Badge, Empty, NoAccess, PageHeader, Stat } from "@/components/ui";
import { useAuth } from "@/lib/auth-context";
import { useCollection } from "@/lib/hooks";
import { useCompany } from "@/lib/business";
import { createDoc, fmtDate, inr, updateDoc, type Doc } from "@/lib/data";

const PRIORITIES = [
  { key: "P1", label: "P1 Urgent" },
  { key: "P2", label: "P2 Needed soon" },
  { key: "P3", label: "P3 Nice to have" },
];
const STATUSES = ["Requested", "Approved", "Ordered", "Received", "On hold", "Rejected"];

function sortRequests(rows: Doc[]) {
  return [...rows].sort((a, b) => String(a.priority).localeCompare(String(b.priority)) || Number(a.order ?? 999) - Number(b.order ?? 999));
}

/**
 * Required assets: what the company needs but hasn't bought yet, ranked so
 * that when money comes in the most important items are bought first (§7.5).
 */
export default function RequiredAssetsPage() {
  const { can, isAdmin, user } = useAuth();
  const { rows } = useCollection("assetRequests", [], { enabled: can("assets", "view") });
  const { rows: projects } = useCollection("projects", [], { gstAware: true });
  const company = useCompany();
  const [show, setShow] = useState(false);
  const [funds, setFunds] = useState<string>("");
  if (!can("assets", "view")) return <NoAccess />;

  const available = funds !== "" ? Number(funds) : Number(company.assetFunds ?? 0);
  const approved = sortRequests(rows.filter((r) => r.status === "Approved"));
  let running = 0;
  let left = available;
  const list = approved.map((r) => {
    running += Number(r.estCost || 0);
    const fits = Number(r.estCost || 0) <= left;
    if (fits) left -= Number(r.estCost || 0);
    return { r, running, fits };
  });
  const others = rows.filter((r) => r.status !== "Approved").sort((a, b) => STATUSES.indexOf(String(a.status)) - STATUSES.indexOf(String(b.status)));

  const move = async (r: Doc, dir: -1 | 1) => {
    const same = approved.filter((x) => x.priority === r.priority);
    const i = same.findIndex((x) => x.id === r.id);
    const j = i + dir;
    if (j < 0 || j >= same.length) return;
    const reordered = [...same];
    [reordered[i], reordered[j]] = [reordered[j], reordered[i]];
    for (let k = 0; k < reordered.length; k++) if (Number(reordered[k].order) !== k) await updateDoc("assetRequests", reordered[k].id, { order: k }, reordered[k]);
  };

  return (
    <div className="space-y-4">
      <PageHeader back="/assets" title="Required assets" subtitle="Approved items in priority order, with a running total"
        actions={can("assets", "create") && <button className="btn-primary" onClick={() => setShow(!show)}><Plus size={15} /> Request an asset</button>} />
      {show && <RequestForm projects={projects} uid={user?.uid} onDone={() => setShow(false)} />}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="card p-4">
          <div className="text-xs font-medium text-muted">Funds available for assets</div>
          <input className="input mt-1 tabular-nums" type="number" value={funds !== "" ? funds : String(company.assetFunds ?? "")} placeholder="₹" onChange={(e) => setFunds(e.target.value)}
            onBlur={() => isAdmin && funds !== "" && updateDoc("settings", "company", { assetFunds: Number(funds) })} disabled={!isAdmin} />
        </div>
        <Stat label="Approved list total" value={inr(running)} />
        <Stat label="Fits within funds" value={inr(available - left)} hint={`${list.filter((x) => x.fits).length} of ${list.length} items`} />
        <Stat label="Left after buying" value={inr(left)} />
      </div>
      <div className="card overflow-x-auto">
        {!list.length ? <Empty>No approved requests.</Empty> : (
          <table className="table">
            <thead><tr><th>Priority</th><th>Item</th><th className="text-right">Qty</th><th>Needed by</th><th className="text-right">Est. cost</th><th className="text-right">Running total</th><th>Funds</th><th></th></tr></thead>
            <tbody>
              {list.map(({ r, running: rt, fits }) => (
                <tr key={r.id}>
                  <td><Badge kind={r.priority === "P1" ? "danger" : r.priority === "P2" ? "warn" : "muted"}>{String(r.priority)}</Badge></td>
                  <td><div className="font-medium">{String(r.item)}</div><div className="text-xs text-muted">{String(r.spec ?? "")} {r.reason ? `· ${r.reason}` : ""}</div></td>
                  <td className="text-right">{String(r.qty)}</td>
                  <td>{fmtDate(r.neededBy)}</td>
                  <td className="text-right tabular-nums">{inr(Number(r.estCost))}</td>
                  <td className="text-right tabular-nums">{inr(rt)}</td>
                  <td>{fits ? <Badge kind="ok">Fits</Badge> : <Badge kind="muted">Wait</Badge>}</td>
                  <td className="whitespace-nowrap text-right">
                    {isAdmin && <><button className="text-muted hover:text-brand" onClick={() => move(r, -1)}><ArrowUp size={14} /></button><button className="ml-1 text-muted hover:text-brand" onClick={() => move(r, 1)}><ArrowDown size={14} /></button></>}
                    {can("purchases", "create") && <Link className="btn ml-2 !py-1" href={`/purchases/new?assetRequestId=${r.id}`}><ShoppingCart size={13} /> Buy</Link>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="card overflow-x-auto">
        <h2 className="border-b border-border px-4 py-3 text-sm font-semibold">All requests</h2>
        {!others.length ? <Empty>Nothing else.</Empty> : (
          <table className="table">
            <thead><tr><th>Item</th><th>Priority</th><th className="text-right">Est. cost</th><th>Project</th><th>Status</th></tr></thead>
            <tbody>
              {others.map((r) => (
                <tr key={r.id}>
                  <td>{String(r.item)} <span className="text-xs text-muted">× {String(r.qty)}</span>{r.links ? <div className="text-xs text-muted">{String(r.links)}</div> : null}</td>
                  <td>
                    <select className="input !w-auto !py-1" disabled={!isAdmin} value={String(r.priority)} onChange={(e) => updateDoc("assetRequests", r.id, { priority: e.target.value }, r)}>
                      {PRIORITIES.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
                    </select>
                  </td>
                  <td className="text-right tabular-nums">{inr(Number(r.estCost))}</td>
                  <td>{String(projects.find((p) => p.id === r.projectId)?.name ?? "—")}</td>
                  <td>
                    <select className="input !w-auto !py-1" disabled={!can("assets", "approve")} value={String(r.status)} onChange={(e) => updateDoc("assetRequests", r.id, { status: e.target.value, order: e.target.value === "Approved" ? 999 : r.order ?? null }, r)}>
                      {STATUSES.map((s) => <option key={s}>{s}</option>)}
                    </select>
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

function RequestForm({ projects, uid, onDone }: { projects: Doc[]; uid?: string; onDone: () => void }) {
  const [v, setV] = useState({ item: "", spec: "", qty: "1", estCost: "", reason: "", projectId: "", neededBy: "", links: "", priority: "P2" });
  return (
    <form className="card grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4" onSubmit={async (e) => {
      e.preventDefault();
      await createDoc("assetRequests", { ...v, qty: Number(v.qty) || 1, estCost: Number(v.estCost) || 0, requestedBy: uid, status: "Requested", order: 999 });
      onDone();
    }}>
      <div className="lg:col-span-2"><label className="label">Item *</label><input className="input" required placeholder="e.g. Electronic load" value={v.item} onChange={(e) => setV({ ...v, item: e.target.value })} /></div>
      <div className="lg:col-span-2"><label className="label">Specification</label><input className="input" value={v.spec} onChange={(e) => setV({ ...v, spec: e.target.value })} /></div>
      <div><label className="label">Quantity</label><input className="input" type="number" value={v.qty} onChange={(e) => setV({ ...v, qty: e.target.value })} /></div>
      <div><label className="label">Estimated cost (₹)</label><input className="input" type="number" required value={v.estCost} onChange={(e) => setV({ ...v, estCost: e.target.value })} /></div>
      <div><label className="label">Priority</label><select className="input" value={v.priority} onChange={(e) => setV({ ...v, priority: e.target.value })}>{PRIORITIES.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}</select></div>
      <div><label className="label">Needed by</label><input className="input" type="date" value={v.neededBy} onChange={(e) => setV({ ...v, neededBy: e.target.value })} /></div>
      <div className="lg:col-span-2"><label className="label">Reason</label><input className="input" value={v.reason} onChange={(e) => setV({ ...v, reason: e.target.value })} /></div>
      <div>
        <label className="label">Project (optional)</label>
        <select className="input" value={v.projectId} onChange={(e) => setV({ ...v, projectId: e.target.value })}><option value="">—</option>{projects.map((p) => <option key={p.id} value={p.id}>{String(p.name)}</option>)}</select>
      </div>
      <div><label className="label">Vendor quotes / links</label><input className="input" value={v.links} onChange={(e) => setV({ ...v, links: e.target.value })} /></div>
      <div><button className="btn-primary">Submit request</button></div>
    </form>
  );
}
