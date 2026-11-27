"use client";

import { collection, doc, getDoc, runTransaction, serverTimestamp, setDoc } from "firebase/firestore";
import { auth, db } from "./firebase";
import { useDoc } from "./hooks";
import { fyLabel, pad, updateDoc, type CodeSpec } from "./data";
import { notify } from "./notify";
import type { Company } from "./doc-html";

export interface CompanySettings extends Company {
  gstInvoicePrefix?: string;
  nonGstInvoicePrefix?: string;
  invoiceTerms?: string;
  quotationTerms?: string;
  monthlyReviewDay?: number;
  assetFunds?: number;
  defaultGstRate?: number;
}

export function useCompany() {
  const { data } = useDoc("settings", "company");
  return (data ?? {}) as CompanySettings;
}

let logoCache: string | undefined;
/** The logo as a data URL, embedded in generated documents. */
async function logoDataUrl() {
  if (logoCache !== undefined || typeof window === "undefined") return logoCache;
  try {
    const blob = await (await fetch("/brand/logo.png")).blob();
    logoCache = await new Promise<string>((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(String(r.result));
      r.onerror = () => rej(r.error);
      r.readAsDataURL(blob);
    });
  } catch {
    logoCache = "";
  }
  return logoCache;
}

/** Company settings for documents, with the logo embedded. */
export async function getCompany(): Promise<CompanySettings> {
  const c = ((await getDoc(doc(db(), "settings", "company"))).data() ?? {}) as CompanySettings;
  return { ...c, logoDataUrl: c.logoDataUrl || (await logoDataUrl()) };
}

// ---- Numbering -------------------------------------------------------

/** FY-wise series, e.g. RN/26-27/0001, reset every April (§8.1). */
export const fySeries = (counterPrefix: string, prefix: string, date = new Date()): CodeSpec => {
  const fy = fyLabel(date);
  return { counter: `${counterPrefix}-${fy}`, field: "number", format: (n) => `${prefix}/${fy}/${pad(n)}` };
};

/** YYMMDD of a date, e.g. 25 Nov 2026 → "261125". */
export const yymmdd = (d: Date) =>
  `${String(d.getFullYear() % 100).padStart(2, "0")}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;

/**
 * Invoice numbers: PREFIX/YYMMDD/001 from the invoice date, running number
 * restarting each day. GST and non-GST bills have separate series, e.g.
 * RN/261125/001 and RN/NG/261125/001 (GST allows at most 16 characters).
 */
export function invoiceSeries(c: CompanySettings, billingType: string, date = new Date()): CodeSpec {
  const nonGst = billingType === "nonGst";
  const prefix = (nonGst ? c.nonGstInvoicePrefix || "RN/NG" : c.gstInvoicePrefix || "RN").replace(/\/+$/, "");
  const day = yymmdd(date);
  return { counter: `inv-${nonGst ? "nongst" : "gst"}-${day}`, field: "number", format: (n) => `${prefix}/${day}/${pad(n, 3)}` };
}

/** Gives an existing document its number (online only, in a transaction). */
export async function assignNumber(col: string, id: string, spec: CodeSpec, extra: Record<string, unknown> = {}) {
  return runTransaction(db(), async (tx) => {
    const ref = doc(db(), col, id);
    const cur = await tx.get(ref);
    if (cur.data()?.[spec.field]) return String(cur.data()![spec.field]);
    const cref = doc(db(), "counters", spec.counter);
    const c = await tx.get(cref);
    const seq = (c.exists() ? (c.data().seq as number) : 0) + 1;
    const number = spec.format(seq);
    tx.set(cref, { seq });
    tx.update(ref, { [spec.field]: number, ...extra, updatedAt: serverTimestamp() });
    tx.set(doc(collection(db(), "auditLog")), {
      action: "number", collection: col, docId: id, uid: auth().currentUser?.uid, userName: auth().currentUser?.displayName || auth().currentUser?.email,
      at: serverTimestamp(), before: null, after: { [spec.field]: number, ...extra },
    });
    return number;
  });
}

// ---- Approvals (§10.1) ----------------------------------------------

export type ApprovalType = "po" | "claim" | "quotationDiscount" | "invoiceCancel" | "entryDelete";

export interface ApprovalRule {
  type: ApprovalType;
  /** Amount (₹) for po/claim, discount % for quotationDiscount. Requests at or below it don't need approval. */
  threshold: number;
  role: string;
  enabled: boolean;
}

export const APPROVAL_LABELS: Record<ApprovalType, string> = {
  po: "Purchase orders above ₹",
  claim: "Expense claims above ₹",
  quotationDiscount: "Quotation discounts above %",
  invoiceCancel: "Invoice cancellation",
  entryDelete: "Deleting a money entry",
};

export const DEFAULT_RULES: ApprovalRule[] = [
  { type: "po", threshold: 50000, role: "admin", enabled: true },
  { type: "claim", threshold: 0, role: "admin", enabled: true },
  { type: "invoiceCancel", threshold: 0, role: "admin", enabled: true },
  { type: "entryDelete", threshold: 0, role: "admin", enabled: true },
];

export async function getRules(): Promise<ApprovalRule[]> {
  const d = (await getDoc(doc(db(), "settings", "approvals"))).data();
  return (d?.rules as ApprovalRule[]) ?? DEFAULT_RULES;
}

/**
 * Raises an approval when a rule applies. Returns "none" when no approval is
 * needed, otherwise "pending" (the document waits).
 */
export async function requestApproval(o: {
  type: ApprovalType;
  col: string;
  docId: string;
  amount: number;
  summary: string;
  link: string;
}): Promise<"none" | "pending"> {
  const rule = (await getRules()).find((r) => r.type === o.type);
  if (!rule || !rule.enabled) return "none";
  const thresholdApplies = o.type === "po" || o.type === "claim" || o.type === "quotationDiscount";
  if (thresholdApplies && o.amount <= rule.threshold) return "none";
  const u = auth().currentUser!;
  const ref = doc(collection(db(), "approvals"));
  await setDoc(ref, {
    type: o.type, col: o.col, docId: o.docId, amount: o.amount, summary: o.summary, link: o.link,
    approverRole: rule.role, requestedBy: u.uid, requestedByName: u.displayName || u.email, status: "pending", at: serverTimestamp(),
  });
  await updateDoc(o.col, o.docId, { pendingApproval: { id: ref.id, type: o.type, role: rule.role } });
  notify("approval.requested", ref.id);
  return "pending";
}
