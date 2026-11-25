"use client";

import { useState } from "react";
import { DocsPanel } from "@/components/docs-panel";
import { Empty, NoAccess, PageHeader } from "@/components/ui";
import { useAuth } from "@/lib/auth-context";
import { useCollection } from "@/lib/hooks";

export default function DocumentsPage() {
  const { can } = useAuth();
  const { rows: projects } = useCollection("projects", [], { gstAware: true, enabled: can("projects", "view") });
  const { rows: clients } = useCollection("clients", [], { enabled: can("clients", "view") });
  const [sel, setSel] = useState("");
  if (!can("documents", "view")) return <NoAccess />;
  const [kind, id] = sel.split(":");
  return (
    <div className="space-y-4">
      <PageHeader title="Documents" subtitle="Stored in Google Drive under RheniumOne. Code repositories are linked on each project." />
      <select className="input !w-auto" value={sel} onChange={(e) => setSel(e.target.value)}>
        <option value="">Choose a project or client…</option>
        <optgroup label="Projects">{projects.map((p) => <option key={p.id} value={`p:${p.id}`}>{String(p.code)} · {String(p.name)}</option>)}</optgroup>
        <optgroup label="Clients">{clients.map((c) => <option key={c.id} value={`c:${c.id}`}>{String(c.code)} · {String(c.displayName || c.legalName)}</option>)}</optgroup>
      </select>
      {!sel ? <div className="card"><Empty>Pick a project or client to see its documents.</Empty></div> : <DocsPanel key={sel} filter={kind === "p" ? { projectId: id } : { clientId: id }} />}
    </div>
  );
}
