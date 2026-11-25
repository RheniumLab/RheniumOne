"use client";

import { collection, getDocs, query, where, type QueryConstraint } from "firebase/firestore";
import { db } from "./firebase";
import { balances, invoiceDue } from "./money";
import { stockFrom } from "./stock";
import type { Doc } from "./data";

async function all(col: string, gstOnly: boolean, ...c: QueryConstraint[]): Promise<Doc[]> {
  try {
    const cs = gstOnly ? [...c, where("billingType", "==", "gst")] : c;
    const s = await getDocs(query(collection(db(), col), ...cs));
    return s.docs.map((d) => ({ id: d.id, ...d.data() }) as Doc).filter((d) => !d.deleted);
  } catch {
    return []; // no permission for this collection
  }
}

export interface Snapshot {
  at: string;
  includesNonGst: boolean;
  cash: { total: number; accounts: { name: string; balance: number }[] };
  receivables: number;
  overdueReceivables: number;
  payables: number;
  projects: { code: string; name: string; status: string; received: number; cost: number; profit: number }[];
  pipeline: { requirementsOpen: number; quotationsSent: number; quotationsSentValue: number; won: number; lost: number };
  ideas: Record<string, number>;
  lowStock: string[];
  assetsDue: string[];
  requiredAssets: { item: string; priority: string; estCost: number }[];
  openActions: { description: string; owner: string; due: string; meeting: string }[];
}

/** Report figures for the monthly review agenda, as on a date (§6.4). */
export async function buildSnapshot(nonGst: boolean): Promise<Snapshot> {
  const gstOnly = !nonGst;
  const [accounts, entries, transfers, invoices, bills, projects, reqs, quotes, ideas, items, moves, assets, areqs, meetings, users] = await Promise.all([
    all("accounts", false), all("entries", gstOnly), all("transfers", false), all("invoices", gstOnly), all("purchaseBills", gstOnly),
    all("projects", gstOnly), all("requirements", false), all("quotations", gstOnly), all("ideas", false), all("items", false),
    all("stockMoves", false), all("assets", false), all("assetRequests", false), all("meetings", false), all("users", false),
  ]);
  const bal = balances(accounts, entries, transfers);
  const today = new Date().toISOString().slice(0, 10);
  const in30 = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  const stock = stockFrom(moves, items);
  const uname = (id: unknown) => String(users.find((u) => u.id === id)?.name ?? "");
  const live = invoices.filter((i) => i.status !== "Draft" && i.status !== "Cancelled");
  return {
    at: new Date().toISOString(),
    includesNonGst: nonGst,
    cash: { total: [...bal.values()].reduce((s, x) => s + x, 0), accounts: accounts.filter((a) => a.active !== false).map((a) => ({ name: String(a.name), balance: bal.get(a.id) ?? 0 })) },
    receivables: live.reduce((s, i) => s + invoiceDue(i), 0),
    overdueReceivables: live.filter((i) => String(i.dueDate) < today).reduce((s, i) => s + invoiceDue(i), 0),
    payables: bills.reduce((s, b) => s + Number(b.total || 0) - Number(b.paid || 0), 0),
    projects: projects.filter((p) => p.status !== "Cancelled").map((p) => {
      const es = entries.filter((e) => e.projectId === p.id && e.status !== "pending");
      const received = es.filter((e) => e.direction === "in").reduce((s, e) => s + Number(e.amount), 0);
      const cost = es.filter((e) => e.direction === "out").reduce((s, e) => s + Number(e.amount), 0);
      return { code: String(p.code), name: String(p.name), status: String(p.status), received, cost, profit: received - cost };
    }),
    pipeline: {
      requirementsOpen: reqs.filter((r) => ["New", "Under study", "Proposal sent"].includes(String(r.status))).length,
      quotationsSent: quotes.filter((q) => q.status === "Sent").length,
      quotationsSentValue: quotes.filter((q) => q.status === "Sent").reduce((s, q) => s + Number(q.total || 0), 0),
      won: quotes.filter((q) => q.status === "Accepted").length,
      lost: quotes.filter((q) => q.status === "Rejected").length,
    },
    ideas: ideas.reduce((m, i) => ({ ...m, [String(i.stage)]: (m[String(i.stage)] ?? 0) + 1 }), {} as Record<string, number>),
    lowStock: items.filter((it) => it.reorderLevel != null && it.reorderLevel !== "" && (stock.get(it.id)?.total ?? 0) <= Number(it.reorderLevel)).map((it) => `${it.name} (${stock.get(it.id)?.total ?? 0})`),
    assetsDue: assets.filter((a) => a.status !== "Disposed" && ["serviceDue", "calibrationDue", "warrantyUntil"].some((k) => a[k] && String(a[k]) <= in30)).map((a) => String(a.name)),
    requiredAssets: areqs.filter((r) => r.status === "Approved").sort((a, b) => String(a.priority).localeCompare(String(b.priority)) || Number(a.order ?? 999) - Number(b.order ?? 999)).map((r) => ({ item: String(r.item), priority: String(r.priority), estCost: Number(r.estCost || 0) })),
    openActions: meetings.flatMap((m) => ((m.actions ?? []) as Record<string, unknown>[]).filter((a) => a.status !== "Done").map((a) => ({ description: String(a.description ?? ""), owner: uname(a.owner), due: String(a.due ?? ""), meeting: String(m.title) }))),
  };
}

export function agendaText(s: Snapshot) {
  const inr = (n: number) => n.toLocaleString("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
  return [
    `1. Last month's open action items (${s.openActions.length})`,
    ...s.openActions.map((a) => `   - ${a.description} — ${a.owner}${a.due ? `, due ${a.due}` : ""}`),
    `2. Cash position: ${inr(s.cash.total)}`,
    ...s.cash.accounts.map((a) => `   - ${a.name}: ${inr(a.balance)}`),
    `3. Receivables ${inr(s.receivables)} (overdue ${inr(s.overdueReceivables)}) · Payables ${inr(s.payables)}`,
    `4. Project status and P&L`,
    ...s.projects.map((p) => `   - ${p.code} ${p.name}: ${p.status}, received ${inr(p.received)}, cost ${inr(p.cost)}, profit ${inr(p.profit)}`),
    `5. Sales pipeline: ${s.pipeline.requirementsOpen} open requirements, ${s.pipeline.quotationsSent} quotations out (${inr(s.pipeline.quotationsSentValue)}), won ${s.pipeline.won}, lost ${s.pipeline.lost}`,
    `6. Product ideas: ${Object.entries(s.ideas).map(([k, v]) => `${k} ${v}`).join(", ") || "none"}`,
    `7. Stock and asset alerts: low stock — ${s.lowStock.join(", ") || "none"}; service/calibration due — ${s.assetsDue.join(", ") || "none"}`,
    `8. Required assets priority list`,
    ...s.requiredAssets.map((r) => `   - ${r.priority} ${r.item}: ${inr(r.estCost)}`),
  ].join("\n");
}
