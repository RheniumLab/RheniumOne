"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { where } from "firebase/firestore";
import { ArrowRight } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useCollection } from "@/lib/hooks";
import { createDoc, getDocOnce, updateDoc } from "@/lib/data";
import { ENTITIES } from "@/lib/entities";
import { Badge, GstBadge } from "./ui";

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
  return null;
}

export function LinkedRecords({ collection, id, data }: { collection: string; id: string; data: D }) {
  if (collection === "clients") return <ClientLinks id={id} />;
  const links: { href: string; label: string }[] = [];
  if (data.requirementId) links.push({ href: `/requirements/${data.requirementId}`, label: "Product requirement" });
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
  return (
    <div className="mb-4 grid gap-4 md:grid-cols-2">
      <div className="card p-4">
        <h2 className="mb-2 text-sm font-semibold">Projects</h2>
        {projects.rows.length ? projects.rows.map((p) => (
          <Link key={p.id} href={`/projects/${p.id}`} className="flex items-center justify-between gap-2 py-1 text-sm hover:text-brand">
            <span>{String(p.code)} · {String(p.name)}</span>
            <span className="flex gap-1"><GstBadge type={String(p.billingType)} /><Badge>{String(p.status)}</Badge></span>
          </Link>
        )) : <div className="text-sm text-muted">None yet</div>}
      </div>
      <div className="card p-4">
        <h2 className="mb-2 text-sm font-semibold">Requirements</h2>
        {reqs.rows.length ? reqs.rows.map((r) => (
          <Link key={r.id} href={`/requirements/${r.id}`} className="flex items-center justify-between gap-2 py-1 text-sm hover:text-brand">
            <span>{String(r.code)} · {String(r.title)}</span>
            <Badge>{String(r.status)}</Badge>
          </Link>
        )) : <div className="text-sm text-muted">None yet</div>}
      </div>
    </div>
  );
}
