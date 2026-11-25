"use client";

import { where } from "firebase/firestore";
import { useAuth } from "./auth-context";
import { useCollection } from "./hooks";
import type { Doc } from "./data";

export const MODES = ["Bank transfer", "UPI", "Cheque", "Cash", "Card"];

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
