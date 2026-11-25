"use client";

import { useState } from "react";
import { limit, orderBy } from "firebase/firestore";
import { Badge, Empty, ErrorBox, NoAccess, PageHeader, Spinner } from "@/components/ui";
import { useAuth } from "@/lib/auth-context";
import { useCollection } from "@/lib/hooks";

/** §10.2 Only the admin can view the full audit log. */
export default function AuditPage() {
  const { isAdmin } = useAuth();
  const [n, setN] = useState(200);
  const { rows, loading, error } = useCollection("auditLog", [orderBy("at", "desc"), limit(n)], { includeDeleted: true, enabled: isAdmin }, [n]);
  const [q, setQ] = useState("");
  if (!isAdmin) return <NoAccess />;
  const filtered = rows.filter((r) => !q || JSON.stringify(r).toLowerCase().includes(q.toLowerCase()));
  return (
    <div>
      <PageHeader title="Logs" subtitle="Every create, edit, delete, approval and login" />
      <div className="card">
        <div className="border-b border-border p-3"><input className="input" placeholder="Filter…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        {error && <div className="p-3"><ErrorBox>{error}</ErrorBox></div>}
        {loading ? <Spinner /> : !filtered.length ? <Empty>Nothing logged yet.</Empty> : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead><tr><th>When</th><th>User</th><th>Action</th><th>Record</th><th>Change</th></tr></thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.id} className="align-top">
                    <td className="whitespace-nowrap">{r.at?.toDate?.().toLocaleString("en-IN") ?? "pending sync"}</td>
                    <td>{String(r.userName)}</td>
                    <td><Badge kind={r.action === "delete" ? "danger" : r.action === "create" ? "ok" : "muted"}>{String(r.action)}</Badge></td>
                    <td className="font-mono text-xs">{String(r.collection)}/{String(r.docId).slice(0, 8)}</td>
                    <td className="max-w-md font-mono text-xs break-all">
                      {r.action === "edit"
                        ? Object.entries((r.after ?? {}) as Record<string, unknown>).map(([k, v]) => (
                            <div key={k}>{k}: {JSON.stringify((r.before as Record<string, unknown>)?.[k] ?? null)} → {JSON.stringify(v)}</div>
                          ))
                        : r.after ? JSON.stringify(r.after).slice(0, 200) : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length >= n && <div className="p-3 text-center"><button className="btn" onClick={() => setN(n + 200)}>Load more</button></div>}
          </div>
        )}
      </div>
    </div>
  );
}
