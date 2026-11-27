"use client";

import { useRef, useState } from "react";
import { FileSpreadsheet, FileText, History, Paperclip, Plus, RefreshCw, Trash2, Upload } from "lucide-react";
import { auth } from "@/lib/firebase";
import { updateDoc } from "@/lib/data";
import { openFile, saveFile } from "@/lib/files";
import { Empty, ErrorBox } from "./ui";

export interface AttachmentVersion {
  fileId: string;
  name: string;
  mime?: string;
  size?: number;
  at: string;
  by?: string;
}
export interface Attachment {
  id: string;
  heading: string;
  versions: AttachmentVersion[];
}

const ACCEPT = ".pdf,.doc,.docx,.xls,.xlsx,.xlsm,.csv,.ppt,.pptx,.txt,.zip,.dwg,.dxf,image/*";
const icon = (name: string) =>
  /\.(xlsx?|xlsm|csv)$/i.test(name) ? <FileSpreadsheet size={16} className="text-ok" /> : /\.pdf$/i.test(name) ? <FileText size={16} className="text-danger" /> : <FileText size={16} className="text-brand" />;
const kb = (n?: number) => (n ? (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`) : "");

/**
 * Files attached to a record (requirements, proposals, quotations): each with
 * a heading, any file type (Word, Excel, PDF…), several per record. Replacing
 * a file keeps the earlier versions with who uploaded them and when.
 */
export function AttachmentsPanel({
  col,
  id,
  data,
  folder,
  editable,
  billingType = "gst",
}: {
  col: string;
  id: string;
  data: Record<string, unknown>;
  folder: string;
  editable: boolean;
  billingType?: string;
}) {
  const list = ((data.attachments ?? []) as Attachment[]).filter(Boolean);
  const [heading, setHeading] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [history, setHistory] = useState<string | null>(null);
  const addInput = useRef<HTMLInputElement>(null);

  const me = () => auth().currentUser?.displayName || auth().currentUser?.email || "";
  const version = async (f: File): Promise<AttachmentVersion> => ({
    fileId: await saveFile(f, { folder, billingType, linked: { col, id } }),
    name: f.name,
    mime: f.type,
    size: f.size,
    at: new Date().toISOString(),
    by: me(),
  });
  const save = (next: Attachment[]) => updateDoc(col, id, { attachments: next }, data);

  async function add(files: FileList | null) {
    if (!files?.length) return;
    const h = heading.trim();
    if (!h) {
      setErr("Type a heading first, e.g. “Client RFQ” or “Technical specification”.");
      if (addInput.current) addInput.current.value = "";
      return;
    }
    setErr(null);
    setBusy("add");
    try {
      const added: Attachment[] = [];
      const arr = Array.from(files);
      for (const f of arr)
        added.push({ id: crypto.randomUUID(), heading: arr.length > 1 ? `${h} — ${f.name.replace(/\.[^.]+$/, "")}` : h, versions: [await version(f)] });
      await save([...list, ...added]);
      setHeading("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
    if (addInput.current) addInput.current.value = "";
    setBusy(null);
  }

  async function replace(a: Attachment, files: FileList | null) {
    if (!files?.[0]) return;
    setBusy(a.id);
    setErr(null);
    try {
      const v = await version(files[0]);
      await save(list.map((x) => (x.id === a.id ? { ...x, versions: [...x.versions, v] } : x)));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
    setBusy(null);
  }

  async function rename(a: Attachment) {
    const h = prompt("Heading", a.heading)?.trim();
    if (h && h !== a.heading) await save(list.map((x) => (x.id === a.id ? { ...x, heading: h } : x)));
  }

  async function remove(a: Attachment) {
    if (!confirm(`Remove “${a.heading}” from this record? The files stay in Google Drive.`)) return;
    await save(list.filter((x) => x.id !== a.id));
  }

  return (
    <div className="card mb-4">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <Paperclip size={15} className="text-brand" />
        <h2 className="text-sm font-semibold">Files</h2>
        <span className="text-xs text-muted">{list.length ? `${list.length} attached` : ""}</span>
      </div>
      {!list.length ? (
        <Empty>No files yet.{editable ? " Add the document below — Word, Excel, PDF or any other file." : ""}</Empty>
      ) : (
        <ul className="divide-y divide-border">
          {list.map((a) => {
            const v = a.versions[a.versions.length - 1];
            return (
              <li key={a.id} className="px-4 py-3">
                <div className="flex flex-wrap items-center gap-3">
                  <button className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => openFile(v.fileId)} title="Open">
                    {icon(v.name)}
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-text hover:text-brand">{a.heading}</span>
                      <span className="block truncate text-xs text-muted">
                        {v.name} · {kb(v.size)} · v{a.versions.length} · {new Date(v.at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}{v.by ? ` · ${v.by}` : ""}
                      </span>
                    </span>
                  </button>
                  <span className="flex shrink-0 items-center gap-1">
                    {a.versions.length > 1 && (
                      <button className="btn !px-2 !py-1" onClick={() => setHistory(history === a.id ? null : a.id)} title="Earlier versions"><History size={14} /></button>
                    )}
                    {editable && (
                      <label className="btn cursor-pointer !px-2 !py-1 text-xs" title="Replace with an updated file">
                        <RefreshCw size={13} className={busy === a.id ? "animate-spin" : ""} /> Replace
                        <input type="file" accept={ACCEPT} className="hidden" onChange={(e) => replace(a, e.target.files)} />
                      </label>
                    )}
                    {editable && <button className="btn !px-2 !py-1 text-xs" onClick={() => rename(a)}>Rename</button>}
                    {editable && <button className="btn !px-2 !py-1 text-muted hover:text-danger" onClick={() => remove(a)} title="Remove"><Trash2 size={13} /></button>}
                  </span>
                </div>
                {history === a.id && (
                  <ul className="mt-2 space-y-1 rounded-md bg-surface-2 p-2 text-xs">
                    {a.versions.slice().reverse().map((x, i) => (
                      <li key={i} className="flex flex-wrap items-center gap-2">
                        <button className="font-medium text-brand hover:underline" onClick={() => openFile(x.fileId)}>v{a.versions.length - i}</button>
                        <span className="text-muted">{x.name} · {new Date(x.at).toLocaleString("en-IN")}{x.by ? ` · ${x.by}` : ""}</span>
                        {i === 0 && <span className="rounded bg-brand/15 px-1.5 text-[10px] font-semibold text-brand">current</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {editable && (
        <div className="space-y-2 border-t border-border p-4">
          <div className="flex flex-wrap gap-2">
            <input className="input min-w-48 flex-1" placeholder="Heading, e.g. Client RFQ, BOQ, Technical spec" value={heading} onChange={(e) => setHeading(e.target.value)} />
            <label className={`btn-primary cursor-pointer ${busy === "add" ? "opacity-60" : ""}`}>
              {busy === "add" ? <Upload size={15} className="animate-pulse" /> : <Plus size={15} />} {busy === "add" ? "Uploading…" : "Attach files"}
              <input ref={addInput} type="file" multiple accept={ACCEPT} className="hidden" disabled={busy === "add"} onChange={(e) => add(e.target.files)} />
            </label>
          </div>
          <p className="text-xs text-muted">Choose several files at once if needed. Use <b>Replace</b> when an updated version comes in; earlier versions are kept.</p>
          {err && <ErrorBox>{err}</ErrorBox>}
        </div>
      )}
    </div>
  );
}
