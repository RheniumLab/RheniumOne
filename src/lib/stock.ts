"use client";

import { useMemo } from "react";
import { useAuth } from "./auth-context";
import { useCollection } from "./hooks";
import type { Doc } from "./data";

export const LOCATIONS = ["Office", "Store", "Site"];

export const MOVE_TYPES = [
  { key: "Return", sign: 1, label: "Stock in — return" },
  { key: "Adjustment in", sign: 1, label: "Stock in — adjustment / opening stock" },
  { key: "Issue", sign: -1, label: "Issue to project" },
  { key: "Scrap", sign: -1, label: "Scrap" },
  { key: "Adjustment out", sign: -1, label: "Stock out — adjustment" },
  { key: "Transfer", sign: 0, label: "Move between locations" },
];

export interface StockInfo {
  total: number;
  byLocation: Record<string, number>;
  reserved: number;
}

export function stockFrom(moves: Doc[], items: Doc[]) {
  const m = new Map<string, StockInfo>();
  for (const it of items) {
    const reserved = ((it.reservations ?? []) as { qty?: number }[]).reduce((s, r) => s + (Number(r.qty) || 0), 0);
    m.set(it.id, { total: 0, byLocation: {}, reserved });
  }
  for (const mv of moves) {
    const s = m.get(mv.itemId);
    if (!s) continue;
    const q = Number(mv.qty) || 0;
    s.total += q;
    s.byLocation[mv.location] = (s.byLocation[mv.location] ?? 0) + q;
  }
  return m;
}

export function useStock() {
  const { can } = useAuth();
  const ok = can("inventory", "view");
  const items = useCollection("items", [], { enabled: ok });
  const moves = useCollection("stockMoves", [], { enabled: ok });
  const stock = useMemo(() => stockFrom(moves.rows, items.rows), [moves.rows, items.rows]);
  const low = items.rows.filter((it) => it.reorderLevel != null && it.reorderLevel !== "" && (stock.get(it.id)?.total ?? 0) <= Number(it.reorderLevel));
  return { items: items.rows, moves: moves.rows, stock, low, loading: items.loading || moves.loading };
}
