"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { arrayUnion, where } from "firebase/firestore";
import { ArrowRight, ExternalLink, FileText, Pencil, Send } from "lucide-react";
import { LineItems, TotalsPanel } from "@/components/line-items";
import { Badge, Empty, ErrorBox, GstBadge, NoAccess, PageHeader, Spinner, Stat } from "@/components/ui";
import { useAuth } from "@/lib/auth-context";
import { useCollection, useDoc } from "@/lib/hooks";
import { api } from "@/lib/api";
import { getCompany, getRules, requestApproval } from "@/lib/business";
import { createDoc, fmtDate, getDocOnce, inr, updateDoc } from "@/lib/data";
import { commercialDocHtml } from "@/lib/doc-html";
import { openDrive } from "@/lib/files";
import { clientFolder } from "@/lib/docs";
import { ENTITIES } from "@/lib/entities";
import { maxDiscountPct, type Line } from "@/lib/tax";
import { QuotationEditor } from "../editor";

async function quotationHtml(q: Record<string, unknown>) {
  const company = await getCompany();
  const client = await getDocOnce("clients", String(q.clientId));
  const gst = q.billingType === "gst";
  return commercialDocHtml({
    company,
    title: "Quotation",
    partyLabel: "To",
    party: { name: String(client?.legalName ?? ""), address: String(client?.billingAddress ?? ""), gstin: gst ? String(client?.gstin ?? "") : "", state: String(q.placeOfSupply ?? "") },
    meta: [["Quotation", `${q.number} R${q.rev ?? 0}`], ["Date", fmtDate(q.date)], ["Valid until", fmtDate(q.validUntil)], ["Subject", q.title]],
    extra: q.scope ? `<h2>Scope</h2><p>${String(q.scope).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/\n/g, "<br>")}</p>` : "",
    lines: q.lines as Line[],
    adj: (q.adj ?? {}) as never,
    gst,
    intraState: Boolean(q.intraState),
    terms: String(q.terms ?? ""),
  });
}

export default function QuotationPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { can, isAdmin } = useAuth();
  const { data: q, loading, error } = useDoc("quotations", id);
  const project = useDoc("projects", q?.projectId ?? undefined);
  const docs = useCollection("docs", [where("linked.id", "==", id)], { gstAware: true }, [id]);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  if (!can("quotations", "view")) return <NoAccess />;
  if (loading) return <Spinner />;
  if (error) return <ErrorBox>{error}</ErrorBox>;
  if (!q) return <Empty>Quotation not found.</Empty>;

  const editable = can("quotations", "edit") && (q.status === "Draft" || q.status === "Rejected");
  if (editing && editable) {
    return (
      <div>
        <PageHeader title={`Edit ${q.number} R${q.rev ?? 0}`} back={`/quotations/${id}`} />
        <QuotationEditor id={id} initial={q as never} />
      </div>
    );
  }

  async function run(label: string, fn: () => Promise<unknown>) {
    setBusy(label);
    setErr(null);
    try {
      await fn();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
    setBusy(null);
  }

  const openGoogleDoc = () =>
    run("gdoc", async () => {
      const client = await getDocOnce("clients", String(q.clientId));
      const html = q.googleDocId ? undefined : await quotationHtml(q);
      const r = await api<{ url: string }>("/api/docs/gdoc", "POST", { quotationId: id, html, name: `${q.number} R${q.rev ?? 0} ${q.title}`, folder: `${clientFolder(client)}/Quotations/Working` });
      window.open(r.url, "_blank");
    });

  /** Release = status Sent. The Google Doc is converted to PDF and kept as a version (§5). */
  const release = () =>
    run("release", async () => {
      const pct = maxDiscountPct(q.lines as Line[], (q.adj ?? {}) as never);
      const rule = (await getRules()).find((r) => r.type === "quotationDiscount");
      const approvalStatus = (q.approval as { status?: string } | undefined)?.status;
      if (!isAdmin && rule?.enabled && pct > rule.threshold && approvalStatus !== "approved") {
        if (approvalStatus === "pending") throw new Error("The discount is waiting for approval.");
        await updateDoc("quotations", id, { approval: { status: "pending", pct } }, q);
        await requestApproval({ type: "quotationDiscount", col: "quotations", docId: id, amount: pct, summary: `${q.number} R${q.rev ?? 0} for ${q.clientName}: ${pct}% discount on ${inr(Number(q.total))}`, link: `/quotations/${id}` });
        throw new Error(`The ${pct}% discount needs approval. It has been sent; release again once approved.`);
      }
      if (!q.googleDocId) {
        const client = await getDocOnce("clients", String(q.clientId));
        await api("/api/docs/gdoc", "POST", { quotationId: id, html: await quotationHtml(q), name: `${q.number} R${q.rev ?? 0} ${q.title}`, folder: `${clientFolder(client)}/Quotations/Working` });
      }
      const client = await getDocOnce("clients", String(q.clientId));
      const r = await api<{ driveId: string }>("/api/docs/release", "POST", { quotationId: id, clientFolder: `${clientFolder(client)}/Quotations` });
      await openDrive(r.driveId);
    });

  const newRevision = () =>
    run("rev", async () => {
      if (!confirm(`Start revision R${Number(q.rev ?? 0) + 1}? The current revision and its released PDF are kept.`)) return;
      const snap = { rev: q.rev ?? 0, lines: q.lines, adj: q.adj ?? {}, total: q.total, status: q.status, at: new Date().toISOString(), googleDocId: q.googleDocId ?? null };
      await updateDoc("quotations", id, { rev: Number(q.rev ?? 0) + 1, status: "Draft", googleDocId: null, approval: null, revisions: arrayUnion(snap) }, q);
    });

  const setStatus = (status: string) => run(status, () => updateDoc("quotations", id, { status }, q));

  /** One click: accepted quotation → project, carrying client, scope, value and billing type (§5). */
  const toProject = () =>
    run("project", async () => {
      const pid = await createDoc("projects", {
        name: q.title, projectType: "Client project", clientId: q.clientId, status: "Planned",
        value: Number(q.taxable ?? q.total), billingType: q.billingType, scope: q.scope ?? "",
        quotationId: id, requirementId: q.requirementId ?? null,
      }, ENTITIES.projects.code);
      await updateDoc("quotations", id, { projectId: pid }, q);
      if (q.requirementId) await updateDoc("requirements", String(q.requirementId), { status: "Closed - won", projectId: pid });
      for (const d of docs.rows) await updateDoc("docs", d.id, { projectId: pid }, d);
      router.push(`/projects/${pid}`);
    });

  const gst = q.billingType === "gst";
  const approval = q.approval as { status?: string; pct?: number } | undefined;
  const releases = ((q.releases ?? []) as { rev: number; driveId: string; at: string }[]).slice().reverse();
  const margin = Number(q.taxable ?? 0) - Number(q.estCost ?? 0);

  return (
    <div className="space-y-4">
      <PageHeader
        back="/quotations"
        title={`${q.number} R${q.rev ?? 0}`}
        subtitle={<span className="flex flex-wrap items-center gap-2">{String(q.title)} · <Link className="text-brand hover:underline" href={`/clients/${q.clientId}`}>{String(q.clientName)}</Link><GstBadge type={String(q.billingType)} /><Badge>{String(q.status)}</Badge>{approval?.status ? <Badge kind={approval.status === "approved" ? "ok" : approval.status === "pending" ? "warn" : "danger"}>{`Discount ${approval.pct ?? ""}% ${approval.status}`}</Badge> : null}</span>}
        actions={
          <>
            {editable && <button className="btn" onClick={() => setEditing(true)}><Pencil size={14} /> Edit</button>}
            {can("quotations", "edit") && <button className="btn" disabled={!!busy} onClick={openGoogleDoc}><ExternalLink size={14} /> {busy === "gdoc" ? "Opening…" : q.googleDocId ? "Open Google Doc" : "Create Google Doc"}</button>}
            {can("quotations", "edit") && q.status === "Draft" && <button className="btn-primary" disabled={!!busy} onClick={release}><Send size={14} /> {busy === "release" ? "Releasing…" : "Release (Sent)"}</button>}
            {can("quotations", "edit") && q.status === "Sent" && (
              <>
                <button className="btn" disabled={!!busy} onClick={() => setStatus("Accepted")}>Accepted</button>
                <button className="btn" disabled={!!busy} onClick={() => setStatus("Rejected")}>Rejected</button>
              </>
            )}
            {can("quotations", "edit") && q.status !== "Draft" && q.status !== "Accepted" && <button className="btn" disabled={!!busy} onClick={newRevision}>New revision</button>}
            {q.status === "Accepted" && !q.projectId && can("projects", "create") && <button className="btn-primary" disabled={!!busy} onClick={toProject}>Convert to project <ArrowRight size={14} /></button>}
            {q.projectId ? <Link className="btn" href={`/projects/${q.projectId}`}>Project {String(project.data?.code ?? "")} <ArrowRight size={14} /></Link> : null}
            {q.status === "Accepted" && can("invoices", "create") && <Link className="btn" href={`/invoices/new?quotationId=${id}`}>Create invoice</Link>}
          </>
        }
      />
      {err && <ErrorBox>{err}</ErrorBox>}
      {q.googleDocId ? <p className="text-xs text-muted">The Google Doc is the working copy you can edit freely. Releasing converts its current content to PDF. Changes to the items here aren’t copied into an existing Doc; start a new revision to regenerate it.</p> : null}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Quotation value" value={inr(Number(q.total))} />
        <Stat label="Taxable value" value={inr(Number(q.taxable))} />
        <Stat label="Estimated cost (BOM)" value={inr(Number(q.estCost ?? 0))} />
        <Stat label="Margin" value={inr(margin)} hint={q.taxable ? `${Math.round((margin / Number(q.taxable)) * 100)}%` : undefined} tone={margin < 0 ? "danger" : "ok"} />
      </div>
      <div className="card p-4">
        <LineItems lines={q.lines as Line[]} onChange={() => {}} gst={gst} readOnly showCost />
        <div className="ml-auto mt-3 max-w-sm"><TotalsPanel lines={q.lines as Line[]} adj={(q.adj ?? {}) as never} gst={gst} intraState={Boolean(q.intraState)} showCost /></div>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="card p-4">
          <h2 className="mb-2 text-sm font-semibold">Released versions</h2>
          {!releases.length ? <div className="text-sm text-muted">Not released yet.</div> : releases.map((r, i) => (
            <button key={i} className="flex w-full items-center justify-between py-1 text-left text-sm hover:text-brand" onClick={() => openDrive(r.driveId)}>
              <span><FileText size={13} className="mr-1 inline" />R{r.rev}</span><span className="text-muted">{new Date(r.at).toLocaleString("en-IN")}</span>
            </button>
          ))}
        </div>
        <div className="card p-4 text-sm">
          <h2 className="mb-2 text-sm font-semibold">Details</h2>
          <div className="grid grid-cols-2 gap-2">
            <div><div className="text-xs text-muted">Date</div>{fmtDate(q.date)}</div>
            <div><div className="text-xs text-muted">Valid until</div>{fmtDate(q.validUntil)}</div>
            {q.requirementId ? <Link className="text-brand hover:underline" href={`/requirements/${q.requirementId}`}>Requirement →</Link> : null}
            {q.proposalId ? <Link className="text-brand hover:underline" href={`/proposals/${q.proposalId}`}>Proposal →</Link> : null}
            {q.bomId ? <Link className="text-brand hover:underline" href={`/boms/${q.bomId}`}>BOM →</Link> : null}
          </div>
          {q.scope ? <><div className="mt-3 text-xs text-muted">Scope</div><div className="whitespace-pre-wrap">{String(q.scope)}</div></> : null}
        </div>
      </div>
    </div>
  );
}
