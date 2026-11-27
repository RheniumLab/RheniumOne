"use client";

import { useState } from "react";
import { where } from "firebase/firestore";
import { Camera, FileText, FolderOpen, History, Plus, Upload } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useCollection, useDoc } from "@/lib/hooks";
import { fmtDate, softDelete, updateDoc } from "@/lib/data";
import { openFile, saveFile } from "@/lib/files";
import { addDocRecord, addDocVersion, clientFolder, DEFAULT_DOC_FOLDERS, isCommercialFolder, projectFolder, type DocVersion } from "@/lib/docs";
import { Badge, Empty } from "./ui";

/**
 * Document area for a project or client (§6.2): folders, versions (a new
 * revision keeps the earlier ones, with who uploaded each and when), mobile
 * camera upload. Files are stored in Google Drive under RheniumOne.
 */
export function DocsPanel({ filter }: { filter: { projectId?: string; clientId?: string } }) {
  const { can, money } = useAuth();
  const key = filter.projectId ? "projectId" : "clientId";
  const val = (filter.projectId ?? filter.clientId)!;
  // Without "Can see money", only non-commercial documents are queried (the rules require it).
  const { rows } = useCollection(
    "docs",
    money ? [where(key, "==", val)] : [where(key, "==", val), where("commercial", "==", false)],
    { gstAware: true, enabled: can("documents", "view") },
    [key, val, money],
  );
  const owner = useDoc(filter.projectId ? "projects" : "clients", val);
  const [folder, setFolder] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<string | null>(null);

  if (!can("documents", "view")) return null;
  const custom = (owner.data?.docFolders as string[] | undefined) ?? DEFAULT_DOC_FOLDERS;
  const folders = Array.from(new Set([...custom, ...rows.map((r) => String(r.folder))])).filter((f) => f && (money || !isCommercialFolder(f)));
  const shown = rows.filter((r) => !folder || r.folder === folder).sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const driveBase = filter.projectId ? projectFolder(owner.data) : clientFolder(owner.data);
  const billingType = String(owner.data?.billingType ?? "gst");

  async function upload(files: FileList | null, existing?: Record<string, unknown> & { id: string }) {
    if (!files?.length) return;
    setBusy(true);
    try {
      for (const f of Array.from(files)) {
        const target = existing ? String(existing.folder) : folder || "General";
        const fileId = await saveFile(f, { folder: `${driveBase}/${target}`, billingType });
        if (existing) await addDocVersion(existing.id, { fileId, name: f.name, size: f.size, mime: f.type });
        else {
          const same = rows.find((r) => r.name === f.name && r.folder === target);
          if (same) await addDocVersion(same.id, { fileId, name: f.name, size: f.size, mime: f.type });
          else await addDocRecord({ name: f.name, folder: target, fileId, size: f.size, mime: f.type, billingType, commercial: isCommercialFolder(target), ...(filter.projectId ? { projectId: filter.projectId, clientId: (owner.data?.clientId as string) ?? null } : { clientId: filter.clientId }) });
        }
      }
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
    setBusy(false);
  }

  const addFolder = async () => {
    const n = prompt("Folder name")?.trim();
    if (!n || !owner.data) return;
    await updateDoc(filter.projectId ? "projects" : "clients", val, { docFolders: [...custom, n] }, owner.data);
    setFolder(n);
  };

  return (
    <div className="card">
      <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
        <h2 className="mr-2 text-sm font-semibold">Documents</h2>
        <button className={!folder ? "btn-primary !py-1" : "btn !py-1"} onClick={() => setFolder("")}>All</button>
        {folders.map((f) => (
          <button key={f} className={folder === f ? "btn-primary !py-1" : "btn !py-1"} onClick={() => setFolder(f)}>
            <FolderOpen size={13} /> {f} <span className="text-xs opacity-70">{rows.filter((r) => r.folder === f).length}</span>
          </button>
        ))}
        {can("documents", "edit") && <button className="btn !py-1" onClick={addFolder}><Plus size={13} /> Folder</button>}
        <div className="flex-1" />
        {can("documents", "create") && (
          <>
            <label className="btn-primary cursor-pointer !py-1"><Upload size={13} /> {busy ? "Uploading…" : `Upload${folder ? ` to ${folder}` : ""}`}<input type="file" multiple className="hidden" onChange={(e) => upload(e.target.files)} /></label>
            <label className="btn cursor-pointer !py-1"><Camera size={13} /> Photo<input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => upload(e.target.files)} /></label>
          </>
        )}
      </div>
      {!shown.length ? <Empty>No documents{folder ? ` in ${folder}` : ""}.</Empty> : (
        <div className="overflow-x-auto">
          <table className="table">
            <thead><tr><th>Name</th><th>Folder</th><th>Version</th><th>Last upload</th><th></th></tr></thead>
            <tbody>
              {shown.map((d) => {
                const versions = (d.versions ?? []) as DocVersion[];
                const last = versions[versions.length - 1];
                return (
                  <tr key={d.id} className="align-top">
                    <td>
                      <button className="flex items-center gap-1 text-left font-medium text-brand hover:underline" onClick={() => last && openFile(last.fileId)}><FileText size={14} /> {String(d.name)}</button>
                      {d.linked ? <span className="text-xs text-muted">from {String((d.linked as { col: string }).col)}</span> : null}
                      {history === d.id && (
                        <ul className="mt-2 space-y-1 text-xs">
                          {versions.slice().reverse().map((v, i) => (
                            <li key={i}><button className="text-brand hover:underline" onClick={() => openFile(v.fileId)}>v{versions.length - i}</button> · {v.by ?? ""} · {new Date(v.at).toLocaleString("en-IN")}</li>
                          ))}
                        </ul>
                      )}
                    </td>
                    <td>{String(d.folder)}</td>
                    <td><Badge kind="muted">{`v${versions.length}`}</Badge></td>
                    <td className="text-xs">{last ? `${fmtDate(last.at)} · ${last.by ?? ""}` : ""}</td>
                    <td className="whitespace-nowrap text-right">
                      {versions.length > 1 && <button className="mr-2 text-muted hover:text-brand" title="Version history" onClick={() => setHistory(history === d.id ? null : d.id)}><History size={14} /></button>}
                      {can("documents", "edit") && <label className="mr-2 cursor-pointer text-xs text-brand">New version<input type="file" className="hidden" onChange={(e) => upload(e.target.files, d)} /></label>}
                      {can("documents", "delete") && <button className="text-xs text-muted hover:text-danger" onClick={() => confirm("Remove this document from the list? The files stay in Drive.") && softDelete("docs", d.id)}>Remove</button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
