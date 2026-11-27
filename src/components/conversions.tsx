"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { arrayUnion, collection as fsCollection, getDocs, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { ArrowRight } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useCollection } from "@/lib/hooks";
import { createDoc, fmtDate, getDocOnce, inr, updateDoc } from "@/lib/data";
import { invoiceDue } from "@/lib/money";
import type { Snapshot } from "@/lib/snapshot";
import { DocsPanel } from "./docs-panel";
import { ENTITIES } from "@/lib/entities";
import { getCompany } from "@/lib/business";
import { sectionsDocHtml } from "@/lib/doc-html";
import { makePdf, openDrive, shareDoc } from "@/lib/files";
import { addDocRecord, clientFolder, projectFolder } from "@/lib/docs";
import { Badge, GstBadge, Stat } from "./ui";

type D = Record<string, unknown>;

/** One-click steps along idea → requirement → project (§5, §6.3). */
export function ConversionActions({ collection, id, data }: { collection: string; id: string; data: D }) {
  const { can } = useAuth();
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<string>) {
    setBusy(true);
    try {
      router.push(await fn());
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  if (collection === "ideas" && data.stage === "Approved" && !data.requirementId && can("requirements", "create")) {
    return (
      <button className="btn-primary" disabled={busy} onClick={() => run(async () => {
        const rid = await createDoc("requirements", {
          kind: "Internal", title: data.title, ideaId: id, status: "New",
          description: data.description, specifications: "", targetUsers: data.targetCustomers,
          targetCost: data.roughCost ?? null,
        }, ENTITIES.requirements.code);
        await updateDoc("ideas", id, { requirementId: rid }, data);
        return `/requirements/${rid}`;
      })}>
        Create product requirement <ArrowRight size={14} />
      </button>
    );
  }

  const convertible = data.kind === "Internal" ? data.status === "Approved" : data.status === "Closed - won";
  if (collection === "requirements" && convertible && !data.projectId && can("projects", "create")) {
    return (
      <button className="btn-primary" disabled={busy} onClick={() => run(async () => {
        const internal = data.kind === "Internal";
        let budget: number | null = null;
        if (internal) {
          const b = prompt("Development budget for this product (₹):");
          if (b === null) throw new Error("Cancelled");
          budget = Number(b) || 0;
        }
        const client = !internal && data.clientId ? await getDocOnce("clients", String(data.clientId)) : null;
        const pid = await createDoc("projects", {
          name: data.title,
          projectType: internal ? "Internal product" : "Client project",
          clientId: internal ? null : data.clientId,
          status: "Planned",
          targetDate: data.targetDate ?? null,
          scope: [data.description, data.specifications].filter(Boolean).join("\n\n"),
          billingType: client?.billingType === "nonGst" ? "nonGst" : "gst",
          budget,
          requirementId: id,
          ideaId: data.ideaId ?? null,
        }, ENTITIES.projects.code);
        await updateDoc("requirements", id, { projectId: pid, status: internal ? "Converted to project" : data.status }, data);
        if (data.ideaId) await updateDoc("ideas", String(data.ideaId), { stage: "In development", projectId: pid });
        return `/projects/${pid}`;
      })}>
        Convert to project <ArrowRight size={14} />
      </button>
    );
  }

  const out: React.ReactNode[] = [];
  // Requirement → proposal / quotation (§5): opens the new record pre-filled, ready to attach files.
  const q = (p: Record<string, unknown>) => new URLSearchParams(Object.entries(p).filter(([, v]) => v).map(([k, v]) => [k, String(v)])).toString();
  if (collection === "requirements" && data.kind !== "Internal" && data.clientId) {
    if (can("proposals", "create"))
      out.push(<Link key="prop" className="btn" href={`/proposals/new?${q({ clientId: data.clientId, requirementId: id, title: data.title })}`}>Create proposal <ArrowRight size={14} /></Link>);
    if (can("quotations", "create"))
      out.push(<Link key="q" className="btn" href={`/quotations/new?${q({ clientId: data.clientId, requirementId: id, title: data.title })}`}>Create quotation <ArrowRight size={14} /></Link>);
  }
  if (collection === "proposals" && can("quotations", "create"))
    out.push(<Link key="q" className="btn-primary" href={`/quotations/new?${q({ clientId: data.clientId, requirementId: data.requirementId, proposalId: id, title: data.title })}`}>Create quotation <ArrowRight size={14} /></Link>);
  // Accepted quotation → project in one click, carrying client, value and billing type (§5).
  if (collection === "quotations" && data.status === "Accepted" && !data.projectId && can("projects", "create"))
    out.push(
      <button key="proj" className="btn-primary" disabled={busy} onClick={() => run(async () => {
        const pid = await createDoc("projects", {
          name: data.title, projectType: "Client project", clientId: data.clientId, status: "Planned",
          value: Number(data.value ?? data.taxable ?? 0), billingType: data.billingType === "nonGst" ? "nonGst" : "gst",
          quotationId: id, requirementId: data.requirementId ?? null,
        }, ENTITIES.projects.code);
        await updateDoc("quotations", id, { projectId: pid }, data);
        if (data.requirementId) await updateDoc("requirements", String(data.requirementId), { status: "Closed - won", projectId: pid });
        return `/projects/${pid}`;
      })}>Convert to project <ArrowRight size={14} /></button>,
    );
  if (collection === "quotations" && data.status === "Accepted" && can("invoices", "create"))
    out.push(<Link key="inv" className="btn" href={`/invoices/new?quotationId=${id}`}>Create invoice</Link>);
  // Issuing the MOM: branded PDF saved to the project / client documents, shared with attendees (§6.4).
  if (collection === "meetings" && can("meetings", "edit") && data.status !== "Cancelled") {
    const issued = data.status === "MOM issued";
    out.push(
      <button key="mom" className={issued ? "btn" : "btn-primary"} disabled={busy} onClick={() => run(async () => {
        if (!confirm(issued ? "Issue a new version of the MOM with the current minutes?" : "Mark the minutes final and issue the MOM?")) throw new Error("Cancelled");
        const company = await getCompany();
        const users = (await getDocs(fsCollection(db(), "users"))).docs.map((d) => ({ id: d.id, ...d.data() }) as Record<string, unknown>);
        const uname = (u: unknown) => String(users.find((x) => x.id === u)?.name ?? "");
        const version = Number(data.momVersion ?? 0) + 1;
        const html = sectionsDocHtml({
          company, title: "Minutes of Meeting",
          meta: [["Meeting", data.title], ["Type", data.meetingType], ["Date", `${data.date ?? ""} ${data.time ?? ""}`], ["Place", data.place ?? ""], ["Chair", uname(data.chair)], ["Attendees", data.attendees ?? ""], ["MOM version", `v${version}`]],
          sections: [["Agenda", String(data.agenda ?? "")], ["Points discussed", String(data.discussed ?? "")], ["Decisions taken", String(data.decisions ?? "")]],
          tables: [{ title: "Action items", head: ["#", "Action", "Owner", "Due", "Status"], rows: ((data.actions ?? []) as Record<string, unknown>[]).map((a, i) => [i + 1, a.description, uname(a.owner), a.due ?? "", a.status ?? "Open"]) }],
        });
        const project = data.projectId ? await getDocOnce("projects", String(data.projectId)) : null;
        const client = data.clientId ? await getDocOnce("clients", String(data.clientId)) : null;
        const folder = project ? `${projectFolder(project)}/MOM` : client ? `${clientFolder(client)}/MOM` : "MOM";
        const name = `MOM ${data.date ?? ""} ${data.title} v${version}`;
        const { driveId, fileId } = await makePdf(html, name, { folder, linked: { col: "meetings", id } });
        await updateDoc("meetings", id, { status: "MOM issued", momVersion: version, momDriveId: driveId, momIssuedAt: new Date().toISOString(), moms: arrayUnion({ version, driveId, at: new Date().toISOString() }) }, data);
        if (project || client) await addDocRecord({ name: `${name}.pdf`, folder: "MOM", projectId: (data.projectId as string) || null, clientId: (data.clientId as string) || (project?.clientId as string) || null, linked: { col: "meetings", id }, fileId, driveId, mime: "application/pdf" });
        await openDrive(driveId);
        return `/meetings/${id}`;
      })}>{issued ? `Re-issue MOM (v${Number(data.momVersion ?? 1) + 1})` : "Issue MOM"}</button>,
    );
  }
  if (collection === "meetings" && data.momDriveId) {
    out.push(<button key="mompdf" className="btn" onClick={() => openDrive(String(data.momDriveId))}>MOM v{String(data.momVersion)}</button>);
    out.push(<button key="momwa" className="btn" onClick={() => shareDoc(String(data.momDriveId), "whatsapp", `MOM: ${data.title} (${data.date})`)}>WhatsApp</button>);
    out.push(<button key="momem" className="btn" onClick={() => shareDoc(String(data.momDriveId), "email", `MOM: ${data.title} (${data.date})`)}>Email</button>);
  }
  return out.length ? <>{out}</> : null;
}

export function LinkedRecords({ collection, id, data }: { collection: string; id: string; data: D }) {
  if (collection === "clients") return <ClientLinks id={id} />;
  if (collection === "vendors") return <VendorLinks id={id} />;
  if (collection === "items") return <ItemLinks id={id} />;
  if (collection === "meetings") return <MeetingSnapshot data={data} />;
  const links: { href: string; label: string }[] = [];
  if (data.requirementId) links.push({ href: `/requirements/${data.requirementId}`, label: "Requirement" });
  if (data.proposalId) links.push({ href: `/proposals/${data.proposalId}`, label: "Proposal" });
  if (data.projectId) links.push({ href: `/projects/${data.projectId}`, label: "Project" });
  if (data.ideaId) links.push({ href: `/ideas/${data.ideaId}`, label: "Product idea" });
  if (data.clientId) links.push({ href: `/clients/${data.clientId}`, label: "Client" });
  if (!links.length) return null;
  return (
    <div className="mb-4 flex flex-wrap gap-2">
      {links.map((l) => (
        <Link key={l.href} href={l.href} className="btn">{l.label} <ArrowRight size={14} /></Link>
      ))}
    </div>
  );
}

function ClientLinks({ id }: { id: string }) {
  const { can } = useAuth();
  const projects = useCollection("projects", [where("clientId", "==", id)], { gstAware: true, enabled: can("projects", "view") }, [id]);
  const reqs = useCollection("requirements", [where("clientId", "==", id)], { enabled: can("requirements", "view") }, [id]);
  const quotes = useCollection("quotations", [where("clientId", "==", id)], { gstAware: true, enabled: can("quotations", "view") }, [id]);
  const invoices = useCollection("invoices", [where("clientId", "==", id)], { gstAware: true, enabled: can("invoices", "view") }, [id]);
  const payments = useCollection("payments", [where("clientId", "==", id)], { gstAware: true, enabled: can("invoices", "view") }, [id]);
  const live = invoices.rows.filter((i) => i.status !== "Draft" && i.status !== "Cancelled");
  const billed = live.reduce((s, i) => s + Number(i.total || 0), 0);
  const received = payments.rows.reduce((s, p) => s + Number(p.amount || 0) + Number(p.tds || 0), 0);
  const outstanding = live.reduce((s, i) => s + invoiceDue(i), 0);
  const list = (title: string, rows: Record<string, unknown>[], href: (r: Record<string, unknown>) => string, label: (r: Record<string, unknown>) => string, right: (r: Record<string, unknown>) => React.ReactNode) => (
    <div className="card p-4">
      <h2 className="mb-2 text-sm font-semibold">{title}</h2>
      {rows.length ? rows.map((r) => (
        <Link key={String(r.id)} href={href(r)} className="flex items-center justify-between gap-2 py-1 text-sm hover:text-brand">
          <span>{label(r)}</span><span className="flex gap-1">{right(r)}</span>
        </Link>
      )) : <div className="text-sm text-muted">None yet</div>}
    </div>
  );
  return (
    <div className="mb-4 space-y-4">
      {can("invoices", "view") && (
        <div className="grid grid-cols-3 gap-3">
          <Stat label="Total billed" value={inr(billed)} />
          <Stat label="Total received (incl. TDS)" value={inr(received)} />
          <Stat label="Outstanding" value={inr(outstanding)} tone={outstanding > 0 ? "danger" : undefined} />
        </div>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        {list("Projects", projects.rows, (p) => `/projects/${p.id}`, (p) => `${p.code} · ${p.name}`, (p) => <><GstBadge type={String(p.billingType)} /><Badge>{String(p.status)}</Badge></>)}
        {list("Requirements", reqs.rows, (r) => `/requirements/${r.id}`, (r) => `${r.code} · ${r.title}`, (r) => <Badge>{String(r.status)}</Badge>)}
        {can("quotations", "view") && list("Quotations", quotes.rows, (q) => `/quotations/${q.id}`, (q) => `${q.number} · ${q.title}`, (q) => <><span className="whitespace-nowrap tabular-nums">{inr(Number(q.value ?? q.taxable ?? 0))}</span><Badge>{String(q.status)}</Badge></>)}
        {can("invoices", "view") && list("Invoices", invoices.rows, (i) => `/invoices/${i.id}`, (i) => `${i.number ?? "Draft"} · ${fmtDate(i.date)}`, (i) => <><span className="whitespace-nowrap tabular-nums">{inr(Number(i.total))}</span><Badge>{String(i.status)}</Badge></>)}
      </div>
      <DocsPanel filter={{ clientId: id }} />
    </div>
  );
}

function VendorLinks({ id }: { id: string }) {
  const { can } = useAuth();
  const pos = useCollection("pos", [where("vendorId", "==", id)], { gstAware: true, enabled: can("purchases", "view") }, [id]);
  const bills = useCollection("purchaseBills", [where("vendorId", "==", id)], { gstAware: true, enabled: can("purchases", "view") }, [id]);
  if (!can("purchases", "view")) return null;
  const payable = bills.rows.reduce((s, b) => s + Number(b.total || 0) - Number(b.paid || 0), 0);
  const paid = bills.rows.reduce((s, b) => s + Number(b.paid || 0), 0);
  return (
    <div className="mb-4 space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Purchase orders" value={pos.rows.length} />
        <Stat label="Paid to vendor" value={inr(paid)} />
        <Stat label="Amount payable" value={inr(payable)} tone={payable > 0 ? "danger" : undefined} />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="card p-4">
          <h2 className="mb-2 text-sm font-semibold">Purchase orders</h2>
          {pos.rows.map((p) => <Link key={p.id} href={`/purchases/${p.id}`} className="flex justify-between py-1 text-sm hover:text-brand"><span>{String(p.number ?? "Draft")} · {fmtDate(p.date)}</span><span className="flex gap-1"><span className="whitespace-nowrap tabular-nums">{inr(Number(p.total))}</span><Badge>{String(p.status)}</Badge></span></Link>)}
          {!pos.rows.length && <div className="text-sm text-muted">None yet</div>}
        </div>
        <div className="card p-4">
          <h2 className="mb-2 text-sm font-semibold">Bills</h2>
          {bills.rows.map((b) => <Link key={b.id} href={`/purchases/${b.poId}`} className="flex justify-between py-1 text-sm hover:text-brand"><span>{String(b.billNo)} · due {fmtDate(b.dueDate)}</span><span className="flex gap-1"><span className="whitespace-nowrap tabular-nums">{inr(Number(b.total))}</span><Badge>{String(b.status)}</Badge></span></Link>)}
          {!bills.rows.length && <div className="text-sm text-muted">None yet</div>}
        </div>
      </div>
      <PriceHistory vendorId={id} pos={pos.rows} />
    </div>
  );
}

function PriceHistory({ pos, vendorId }: { pos: Record<string, unknown>[]; vendorId?: string; itemId?: string }) {
  const rows = pos.filter((p) => p.status !== "Cancelled" && p.status !== "Rejected").flatMap((p) => ((p.lines ?? []) as Record<string, unknown>[]).map((l) => ({ p, l })));
  if (!rows.length) return null;
  return (
    <div className="card overflow-x-auto p-4">
      <h2 className="mb-2 text-sm font-semibold">Price history{vendorId ? " per item" : ""}</h2>
      <table className="table">
        <thead><tr><th>Date</th><th>PO</th>{vendorId ? <th>Item</th> : <th>Vendor</th>}<th className="text-right">Qty</th><th className="text-right">Rate</th></tr></thead>
        <tbody>
          {rows.sort((a, b) => String(b.p.date).localeCompare(String(a.p.date))).map(({ p, l }, i) => (
            <tr key={i}><td>{fmtDate(p.date)}</td><td>{String(p.number ?? "Draft")}</td><td>{vendorId ? String(l.description) : String(p.vendorName)}</td><td className="text-right">{String(l.qty)}</td><td className="whitespace-nowrap text-right tabular-nums">{inr(Number(l.rate))}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ItemLinks({ id }: { id: string }) {
  const { can } = useAuth();
  const moves = useCollection("stockMoves", [where("itemId", "==", id)], {}, [id]);
  const pos = useCollection("pos", [], { gstAware: true, enabled: can("purchases", "view") });
  const byLoc: Record<string, number> = {};
  for (const m of moves.rows) byLoc[String(m.location)] = (byLoc[String(m.location)] ?? 0) + Number(m.qty);
  const total = Object.values(byLoc).reduce((s, x) => s + x, 0);
  const itemPos = pos.rows.filter((p) => ((p.lines ?? []) as Record<string, unknown>[]).some((l) => l.itemId === id)).map((p) => ({ ...p, lines: ((p.lines ?? []) as Record<string, unknown>[]).filter((l) => l.itemId === id) }));
  return (
    <div className="mb-4 space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="In stock" value={total} />
        {Object.entries(byLoc).map(([l, q]) => <Stat key={l} label={l} value={q} />)}
      </div>
      <div className="card overflow-x-auto p-4">
        <h2 className="mb-2 text-sm font-semibold">Movements</h2>
        {!moves.rows.length ? <div className="text-sm text-muted">No movements yet.</div> : (
          <table className="table">
            <thead><tr><th>Date</th><th>Type</th><th>Location</th><th className="text-right">Qty</th><th>Note</th></tr></thead>
            <tbody>{[...moves.rows].sort((a, b) => String(b.date).localeCompare(String(a.date))).map((m) => <tr key={m.id}><td>{fmtDate(m.date)}</td><td>{String(m.type)}</td><td>{String(m.location)}</td><td className="text-right tabular-nums">{String(m.qty)}</td><td>{String(m.note ?? "")}</td></tr>)}</tbody>
          </table>
        )}
      </div>
      <PriceHistory pos={itemPos} itemId={id} />
    </div>
  );
}

function MeetingSnapshot({ data }: { data: D }) {
  const { nonGst, money } = useAuth();
  // Figures are money: only roles with "Can see money" see the snapshot.
  const snap = (money ? (nonGst && data.snapshotFull ? data.snapshotFull : data.snapshot) : undefined) as Snapshot | undefined;
  const links: React.ReactNode[] = [];
  if (data.projectId) links.push(<Link key="p" href={`/projects/${data.projectId}`} className="btn">Project <ArrowRight size={14} /></Link>);
  if (data.clientId) links.push(<Link key="c" href={`/clients/${data.clientId}`} className="btn">Client <ArrowRight size={14} /></Link>);
  if (!snap) return links.length ? <div className="mb-4 flex gap-2">{links}</div> : null;
  return (
    <div className="mb-4 space-y-3">
      {links.length > 0 && <div className="flex gap-2">{links}</div>}
      <details className="card p-4">
        <summary className="cursor-pointer text-sm font-semibold">Figures as on {new Date(snap.at).toLocaleDateString("en-IN")}{snap.includesNonGst ? " (incl. non-GST)" : " (GST only)"}</summary>
        <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Cash position" value={inr(snap.cash.total)} />
          <Stat label="Receivables" value={inr(snap.receivables)} hint={`overdue ${inr(snap.overdueReceivables)}`} />
          <Stat label="Payables" value={inr(snap.payables)} />
          <Stat label="Quotations out" value={inr(snap.pipeline.quotationsSentValue)} hint={`${snap.pipeline.quotationsSent} sent`} />
        </div>
        <table className="table mt-3">
          <thead><tr><th>Project</th><th>Status</th><th className="text-right">Received</th><th className="text-right">Cost</th><th className="text-right">Profit</th></tr></thead>
          <tbody>{snap.projects.map((p) => <tr key={p.code}><td>{p.code} {p.name}</td><td>{p.status}</td><td className="text-right">{inr(p.received)}</td><td className="text-right">{inr(p.cost)}</td><td className="text-right">{inr(p.profit)}</td></tr>)}</tbody>
        </table>
      </details>
    </div>
  );
}
