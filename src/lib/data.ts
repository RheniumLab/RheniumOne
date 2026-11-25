"use client";

import {
  collection,
  doc,
  getDoc,
  runTransaction,
  serverTimestamp,
  writeBatch,
  FieldValue,
  Timestamp,
  type DocumentData,
} from "firebase/firestore";
import { auth, db } from "./firebase";

export type Doc = DocumentData & { id: string };

function who() {
  const u = auth().currentUser;
  if (!u) throw new Error("Not signed in");
  return { uid: u.uid, name: u.displayName || u.email || u.uid };
}

/**
 * Replaces undefined with null (Firestore rejects undefined). Firestore
 * sentinels (serverTimestamp, arrayUnion, increment) are kept as-is, or
 * replaced by a label when `forLog` is set (for the audit log).
 */
export function clean<T>(o: T, forLog = false): T {
  const walk = (v: unknown): unknown => {
    if (v === undefined) return null;
    if (v instanceof FieldValue) return forLog ? "(computed)" : v;
    if (v instanceof Date || v instanceof Timestamp) return v;
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return walk(o) as T;
}

function auditEntry(action: string, col: string, id: string, before: unknown, after: unknown) {
  const u = who();
  return {
    action,
    collection: col,
    docId: id,
    uid: u.uid,
    userName: u.name,
    at: serverTimestamp(),
    before: before ?? null,
    after: after ?? null,
  };
}

/** Indian financial year label for a date, e.g. "26-27". */
export function fyLabel(d = new Date()) {
  const y = d.getFullYear() % 100;
  const start = d.getMonth() >= 3 ? y : y - 1;
  return `${String(start).padStart(2, "0")}-${String(start + 1).padStart(2, "0")}`;
}

export interface CodeSpec {
  /** Counter document id, e.g. "client". */
  counter: string;
  /** Formats the sequence, e.g. n => `RC-${pad(n,4)}`. */
  format: (n: number) => string;
  field: string;
}

export const pad = (n: number, w = 4) => String(n).padStart(w, "0");

/**
 * Creates a document. When `code` is given the number is taken inside a
 * transaction, so this needs a connection (numbered documents are online-only,
 * requirements §2). Without `code` a batch is used, which also works offline.
 */
export async function createDoc(col: string, data: Record<string, unknown>, code?: CodeSpec): Promise<string> {
  const ref = doc(collection(db(), col));
  const u = who();
  const base = { ...clean(data), createdAt: serverTimestamp(), createdBy: u.uid, updatedAt: serverTimestamp() };
  if (code) {
    await runTransaction(db(), async (tx) => {
      const cref = doc(db(), "counters", code.counter);
      const c = await tx.get(cref);
      const seq = (c.exists() ? (c.data().seq as number) : 0) + 1;
      tx.set(cref, { seq });
      const full = { ...base, [code.field]: code.format(seq) };
      tx.set(ref, full);
      tx.set(doc(collection(db(), "auditLog")), auditEntry("create", col, ref.id, null, { ...clean(data, true), [code.field]: code.format(seq) }));
    });
  } else {
    const b = writeBatch(db());
    b.set(ref, base);
    b.set(doc(collection(db(), "auditLog")), auditEntry("create", col, ref.id, null, clean(data, true)));
    // Don't await the server ack: offline writes resolve when synced.
    void b.commit();
  }
  return ref.id;
}

export async function updateDoc(col: string, id: string, changes: Record<string, unknown>, before?: Record<string, unknown>) {
  const ref = doc(db(), col, id);
  let prev = before;
  if (!prev) {
    try {
      prev = (await getDoc(ref)).data();
    } catch {
      prev = undefined;
    }
  }
  const c = clean(changes);
  const oldValues = prev ? Object.fromEntries(Object.keys(c).map((k) => [k, prev?.[k] ?? null])) : null;
  const b = writeBatch(db());
  b.update(ref, { ...c, updatedAt: serverTimestamp(), updatedBy: who().uid });
  b.set(doc(collection(db(), "auditLog")), auditEntry("edit", col, id, clean(oldValues ?? {}, true), clean(changes, true)));
  void b.commit();
}

/** Soft delete: records stay, marked deleted, and remain in the audit log (§10.2). */
export async function softDelete(col: string, id: string) {
  const b = writeBatch(db());
  b.update(doc(db(), col, id), { deleted: true, deletedAt: serverTimestamp(), deletedBy: who().uid });
  b.set(doc(collection(db(), "auditLog")), auditEntry("delete", col, id, null, { deleted: true }));
  await b.commit();
}

export async function getDocOnce(col: string, id: string): Promise<Doc | null> {
  const s = await getDoc(doc(db(), col, id));
  return s.exists() ? ({ id: s.id, ...s.data() } as Doc) : null;
}

export async function logLogin() {
  const b = writeBatch(db());
  b.set(doc(collection(db(), "auditLog")), auditEntry("login", "users", who().uid, null, null));
  await b.commit();
}

export const inr = (n: number | undefined | null) =>
  (n ?? 0).toLocaleString("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 });

export function toDate(v: unknown): Date | null {
  if (!v) return null;
  if (v instanceof Date) return v;
  if (typeof v === "string") return new Date(v);
  if (typeof v === "object" && v && "toDate" in v) return (v as { toDate: () => Date }).toDate();
  return null;
}

export const fmtDate = (v: unknown) => {
  const d = toDate(v);
  return d ? d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "";
};

export const today = () => new Date().toISOString().slice(0, 10);
