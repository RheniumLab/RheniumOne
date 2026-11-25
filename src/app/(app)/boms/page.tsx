"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Plus } from "lucide-react";
import { Badge, Empty, NoAccess, PageHeader, Spinner } from "@/components/ui";
import { useAuth } from "@/lib/auth-context";
import { useCollection } from "@/lib/hooks";
import { createDoc, inr, pad } from "@/lib/data";
import { bomTotal, type BomLine } from "@/lib/bom";

export default function BomsPage() {
  const { can } = useAuth();
  const router = useRouter();
  const { rows, loading } = useCollection("boms", [], { enabled: can("boms", "view") });
  const { rows: projects } = useCollection("projects", [], { gstAware: true });
  const [show, setShow] = useState(false);
  const [v, setV] = useState({ name: "", projectId: "", kind: "EBOM" });
  if (!can("boms", "view")) return <NoAccess />;
  const pname = (id: unknown) => projects.find((p) => p.id === id);
  return (
    <div>
      <PageHeader title="EBOM / MBOM" subtitle="Bills of materials per project, with revisions" actions={can("boms", "create") && <button className="btn-primary" onClick={() => setShow(!show)}><Plus size={15} /> New BOM</button>} />
      {show && (
        <form className="card mb-4 grid gap-3 p-4 sm:grid-cols-4" onSubmit={async (e) => {
          e.preventDefault();
          const id = await createDoc("boms", { ...v, rev: "A", revNote: "Initial", lines: [], revisions: [] }, { counter: "bom", field: "code", format: (n) => `BOM-${pad(n)}` });
          router.push(`/boms/${id}`);
        }}>
          <div className="sm:col-span-2"><label className="label">Name</label><input className="input" required value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} placeholder="e.g. Control panel assembly" /></div>
          <div>
            <label className="label">Project</label>
            <select className="input" required value={v.projectId} onChange={(e) => setV({ ...v, projectId: e.target.value })}>
              <option value="">—</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{String(p.code)} · {String(p.name)}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Kind</label>
            <select className="input" value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value })}><option>EBOM</option><option>MBOM</option></select>
          </div>
          <div><button className="btn-primary">Create</button></div>
        </form>
      )}
      <div className="card overflow-x-auto">
        {loading ? <Spinner /> : !rows.length ? <Empty>No BOMs yet.</Empty> : (
          <table className="table">
            <thead><tr><th>Code</th><th>Name</th><th>Kind</th><th>Rev</th><th>Project</th><th className="text-right">Est. cost</th></tr></thead>
            <tbody>
              {rows.sort((a, b) => String(b.code).localeCompare(String(a.code))).map((b) => (
                <tr key={b.id}>
                  <td>{String(b.code)}</td>
                  <td><Link className="font-medium text-brand hover:underline" href={`/boms/${b.id}`}>{String(b.name)}</Link></td>
                  <td><Badge kind={b.kind === "EBOM" ? "brand" : "muted"}>{String(b.kind)}</Badge></td>
                  <td>Rev {String(b.rev)}</td>
                  <td>{pname(b.projectId) ? `${pname(b.projectId)!.code} ${pname(b.projectId)!.name}` : "—"}</td>
                  <td className="text-right tabular-nums">{inr(bomTotal((b.lines ?? []) as BomLine[]))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
