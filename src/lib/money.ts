"use client";

import { where } from "firebase/firestore";
import { useAuth } from "./auth-context";
import { useCollection } from "./hooks";
import type { Doc } from "./data";

export const MODES = ["Bank transfer", "UPI", "Cheque", "Cash", "Card"];

/** Balance still to be paid on an invoice (draft and cancelled invoices owe nothing). */
export const invoiceDue = (i: Record<string, unknown>) =>
  i.status === "Cancelled" || i.status === "Draft" ? 0 : Math.max(0, Math.round((Number(i.due ?? i.total ?? 0) - Number(i.paid ?? 0)) * 100) / 100);

export const ageDays = (d: unknown) => Math.floor((Date.now() - new Date(String(d)).getTime()) / 86400000);

/** Ageing bucket by days past the invoice date (§8.2). */
export const ageBucket = (days: number) => (days <= 30 ? "0–30" : days <= 60 ? "31–60" : days <= 90 ? "61–90" : "90+");
export const AGE_BUCKETS = ["0–30", "31–60", "61–90", "90+"];

/** Indian FY quarter label for TDS, e.g. "Q3 26-27". */
export function tdsQuarter(date: string) {
  const d = new Date(date);
  const m = d.getMonth();
  const q = m >= 3 && m <= 5 ? 1 : m >= 6 && m <= 8 ? 2 : m >= 9 && m <= 11 ? 3 : 4;
  const y = d.getFullYear() % 100;
  const start = m >= 3 ? y : y - 1;
  return `Q${q} ${String(start).padStart(2, "0")}-${String(start + 1).padStart(2, "0")}`;
}

/**
 * Entries visible to the current user: everything (subject to GST visibility)
 * for cash-flow viewers, otherwise only entries in their own cash wallet.
 */
export function useEntries() {
  const { can, user } = useAuth();
  const full = can("cashflow", "view");
  const all = useCollection("entries", [], { gstAware: true, enabled: full });
  const own = useCollection("entries", [where("accountHolder", "==", user?.uid ?? "-")], { enabled: !full && Boolean(user) }, [user?.uid]);
  return full ? all : own;
}

export function useTransfers() {
  const { can, user } = useAuth();
  const full = can("custody", "approve");
  const all = useCollection("transfers", [], { enabled: full });
  const from = useCollection("transfers", [where("fromHolder", "==", user?.uid ?? "-")], { enabled: !full }, [user?.uid]);
  const to = useCollection("transfers", [where("toHolder", "==", user?.uid ?? "-")], { enabled: !full }, [user?.uid]);
  if (full) return all;
  const map = new Map<string, Doc>();
  [...from.rows, ...to.rows].forEach((t) => map.set(t.id, t));
  return { rows: [...map.values()], loading: from.loading || to.loading, error: from.error || to.error };
}

/** Pending entries and unconfirmed handovers don't count in balances (§8.5, §10.1). */
export function balances(accounts: Doc[], entries: Doc[], transfers: Doc[]) {
  const bal = new Map<string, number>(accounts.map((a) => [a.id, Number(a.openingBalance || 0)]));
  for (const e of entries) {
    if (e.status === "pending" || e.deleted || !bal.has(e.accountId)) continue;
    bal.set(e.accountId, bal.get(e.accountId)! + (e.direction === "in" ? 1 : -1) * Number(e.amount || 0));
  }
  for (const t of transfers) {
    if (t.status !== "confirmed" || t.deleted) continue;
    const amt = Number(t.amount || 0);
    if (bal.has(t.fromAccountId)) bal.set(t.fromAccountId, bal.get(t.fromAccountId)! - amt);
    if (bal.has(t.toAccountId)) bal.set(t.toAccountId, bal.get(t.toAccountId)! + amt);
  }
  return bal;
}
