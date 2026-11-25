"use client";

import { collection, doc, getDoc, serverTimestamp, setDoc, updateDoc as fsUpdate } from "firebase/firestore";
import { auth, db } from "./firebase";
import { api } from "./api";

/**
 * Files (bill photos, PDFs, drawings) live in the company Google Drive under
 * "RheniumOne". Each file has a record in Firestore `files/{id}`.
 *
 * Uploads are queued in IndexedDB first, so a photo taken with no signal is
 * kept on the device and uploaded automatically when it is back online.
 */

const DB_NAME = "rhenium-outbox";
const STORE = "files";

function idb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function idbOp<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await idb();
  return new Promise((res, rej) => {
    const tx = d.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

interface Queued { id: string; blob: Blob; name: string; mime: string; folder: string }

async function compressImage(file: File): Promise<Blob> {
  if (!file.type.startsWith("image/") || file.size < 600_000) return file;
  try {
    const img = await createImageBitmap(file);
    const scale = Math.min(1, 2200 / Math.max(img.width, img.height));
    const c = document.createElement("canvas");
    c.width = Math.round(img.width * scale);
    c.height = Math.round(img.height * scale);
    c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
    return await new Promise<Blob>((res) => c.toBlob((b) => res(b ?? file), "image/jpeg", 0.8));
  } catch {
    return file;
  }
}

export interface FileMeta {
  /** Drive folder under RheniumOne, e.g. "Bills/2026-11" or "Projects/RP-0001 Pump/Drawings". */
  folder: string;
  billingType?: string;
  linked?: { col: string; id: string } | null;
}

/** Saves a file record now and uploads to Drive in the background. Returns the file record id. */
export async function saveFile(file: File, meta: FileMeta): Promise<string> {
  const blob = await compressImage(file);
  const mime = blob === file ? file.type || "application/octet-stream" : "image/jpeg";
  const name = blob === file ? file.name : file.name.replace(/\.[^.]+$/, "") + ".jpg";
  const ref = doc(collection(db(), "files"));
  void setDoc(ref, {
    name, mime, size: blob.size, folder: meta.folder, billingType: meta.billingType ?? "gst",
    linked: meta.linked ?? null, uid: auth().currentUser?.uid, status: "pending", driveId: null, at: serverTimestamp(),
  });
  await idbOp("readwrite", (s) => s.put({ id: ref.id, blob, name, mime, folder: meta.folder } as Queued, ref.id));
  void flushOutbox();
  return ref.id;
}

async function uploadToDrive(q: Queued): Promise<string> {
  // Preferred: resumable session, bytes go straight from the device to Google.
  try {
    const { uploadUrl } = await api<{ uploadUrl: string }>("/api/files/session", "POST", { name: q.name, mime: q.mime, size: q.blob.size, folder: q.folder });
    const res = await fetch(uploadUrl, { method: "PUT", headers: { "content-type": q.mime }, body: q.blob });
    if (res.ok) return (await res.json()).id;
  } catch (e) {
    if (e instanceof Error && /not connected/i.test(e.message)) throw e;
  }
  // Fallback: through the server (small files only).
  if (q.blob.size > 4_000_000) throw new Error("Upload failed");
  const form = new FormData();
  form.append("file", new File([q.blob], q.name, { type: q.mime }));
  form.append("folder", q.folder);
  const token = await auth().currentUser?.getIdToken();
  const r = await fetch("/api/files/upload", { method: "POST", headers: token ? { authorization: `Bearer ${token}` } : {}, body: form });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error ?? "Upload failed");
  return j.driveId;
}

let flushing = false;
/** Uploads every queued file. Runs on save, on app start and when the device comes online. */
export async function flushOutbox() {
  if (flushing || typeof navigator === "undefined" || !navigator.onLine || !auth().currentUser) return;
  flushing = true;
  try {
    const items = await idbOp<Queued[]>("readonly", (s) => s.getAll() as IDBRequest<Queued[]>);
    for (const q of items) {
      try {
        const driveId = await uploadToDrive(q);
        await fsUpdate(doc(db(), "files", q.id), { driveId, status: "uploaded" });
        await idbOp("readwrite", (s) => s.delete(q.id));
      } catch (e) {
        console.warn("Upload will retry later:", q.name, e);
      }
    }
  } finally {
    flushing = false;
  }
}

export async function pendingUploads(): Promise<number> {
  try {
    return await idbOp<number>("readonly", (s) => s.count());
  } catch {
    return 0;
  }
}

/** Opens a file: from Drive through the server, or from this device if it hasn't uploaded yet. */
export async function openFile(fileId: string) {
  const w = window.open("", "_blank");
  try {
    const rec = (await getDoc(doc(db(), "files", fileId))).data();
    let blob: Blob | undefined;
    if (rec?.driveId) {
      const token = await auth().currentUser?.getIdToken();
      const r = await fetch(`/api/files/${rec.driveId}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? "Could not open the file");
      blob = await r.blob();
    } else {
      const q = await idbOp<Queued | undefined>("readonly", (s) => s.get(fileId) as IDBRequest<Queued | undefined>);
      blob = q?.blob;
      if (!blob) throw new Error("This file is still uploading from the device that captured it.");
    }
    const url = URL.createObjectURL(blob);
    if (w) w.location.href = url;
    else window.open(url, "_blank");
  } catch (e) {
    w?.close();
    alert(e instanceof Error ? e.message : String(e));
  }
}

/** Opens a Drive file by its Drive id (server-generated PDFs). */
export async function openDrive(driveId: string) {
  const w = window.open("", "_blank");
  try {
    const token = await auth().currentUser?.getIdToken();
    const r = await fetch(`/api/files/${driveId}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? "Could not open the file");
    const url = URL.createObjectURL(await r.blob());
    if (w) w.location.href = url;
  } catch (e) {
    w?.close();
    alert(e instanceof Error ? e.message : String(e));
  }
}

/** Gets a shareable link for a PDF and opens WhatsApp or email with it. */
export async function shareDoc(driveId: string, via: "whatsapp" | "email", text: string, to?: { phone?: string; email?: string }) {
  const { url } = await api<{ url: string }>("/api/files/share", "POST", { driveId });
  const msg = `${text}\n${url}`;
  if (via === "whatsapp") {
    const phone = (to?.phone ?? "").replace(/\D/g, "");
    window.open(`https://wa.me/${phone.length === 10 ? "91" + phone : phone}?text=${encodeURIComponent(msg)}`, "_blank");
  } else {
    window.open(`mailto:${to?.email ?? ""}?subject=${encodeURIComponent(text)}&body=${encodeURIComponent(msg)}`, "_self");
  }
}

/** Renders HTML to a PDF in Drive. */
export async function makePdf(html: string, name: string, meta: FileMeta) {
  return api<{ driveId: string; fileId: string }>("/api/docs/pdf", "POST", { html, name, folder: meta.folder, billingType: meta.billingType, linked: meta.linked });
}
