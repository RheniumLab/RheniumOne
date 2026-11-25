"use client";

import { useEffect, useMemo, useState } from "react";
import { Download, Printer } from "lucide-react";
import { Empty, NoAccess, PageHeader } from "@/components/ui";
import { useAuth } from "@/lib/auth-context";
import { useCollection } from "@/lib/hooks";
import { fmtDate, inr, type Doc } from "@/lib/data";
import { AGE_BUCKETS, ageBucket, ageDays, balances, invoiceDue, useEntries, useTransfers } from "@/lib/money";
import { useStock, LOCATIONS } from "@/lib/stock";
import type { Line } from "@/lib/tax";

type Cell = string | number | null;
interface Table { title?: string; head: string[]; rows: Cell[][]; money?: number[] }
interface Filters { from: string; to: string; projectId: string; clientId: string; gst: string }

const REPORTS = [
  { key: "cash", label: "Cash position" },
  { key: "cashflow", label: "Cash flow" },
  { key: "pnl", label: "Project P&L" },
  { key: "receivables", label: "Receivables & dues" },
  { key: "payables", label: "Payables" },
  { key: "overheads", label: "Company overheads" },
  { key: "gst", label: "GST summary (GSTR-1 / 3B)" },
  { key: "tds", label: "TDS receivable" },
  { key: "pipeline", label: "Sales pipeline" },
  { key: "status", label: "Project status" },
  { key: "inventory", label: "Inventory" },
  { key: "assets", label: "Assets" },
  { key: "meetings", label: "Meetings & action items" },
  { key: "required", label: "Required assets" },
] as const;
type Key = (typeof REPORTS)[number]["key"];

const inRange = (d: unknown, f: Filters) => { const s = String(d ?? ""); return (!f.from || s >= f.from) && (!f.to || s <= f.to); };
const gstOk = (r: Doc, f: Filters) => !f.gst || (r.billingType ?? "gst") === f.gst;
const month = (d: unknown) => String(d ?? "").slice(0, 7);

function exportCsv(name: string, tables: Table[]) {
  const esc = (c: Cell) => { const s = c === null ? "" : String(c); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const out = tables.map((t) => [t.title ? [t.title] : [], t.head, ...t.rows].filter((r) => r.length).map((r) => r.map(esc).join(",")).join("\r\n")).join("\r\n\r\n");
  const blob = new Blob(["﻿" + out], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${name} ${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
}

/** Who can see which report (§11). */
function allowed(k: Key, can: (m: never, a: never) => boolean, isAdmin: boolean) {
  const c = (m: string) => can(m as never, "view" as never);
  switch (k) {
    case "cash": return true;
    case "cashflow": return c("cashflow");
    case "pnl": return c("projects") && c("cashflow");
    case "receivables": return c("invoices");
    case "payables": return c("purchases");
    case "overheads": return isAdmin;
    case "gst": return c("invoices") && c("cashflow");
    case "tds": return c("tds") || c("invoices");
    case "pipeline": return c("quotations") || c("requirements");
    case "status": return c("projects");
    case "inventory": return c("inventory");
    case "assets": case "required": return c("assets");
    case "meetings": return c("meetings");
  }
}

export default function ReportsPage() {
  const { can, isAdmin, nonGst } = useAuth();
  const { rows: projects } = useCollection("projects", [], { gstAware: true, enabled: can("projects", "view") });
  const { rows: clients } = useCollection("clients", [], { enabled: can("clients", "view") });
  const list = REPORTS.filter((r) => allowed(r.key, can as never, isAdmin));
  const [key, setKey] = useState<Key>(list[0]?.key ?? "cash");
  const fyStart = (() => { const d = new Date(); const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1; return `${y}-04-01`; })();
  const [f, setF] = useState<Filters>({ from: fyStart, to: new Date().toISOString().slice(0, 10), projectId: "", clientId: "", gst: "" });
  const [tables, setTables] = useState<Table[]>([]);
  if (!list.length) return <NoAccess />;
  const label = REPORTS.find((r) => r.key === key)!.label;

  return (
    <div className="space-y-4">
      <PageHeader title="Reports" subtitle="Every report filters by date, project, client and GST type, and exports to Excel and PDF"
        actions={<>
          <button className="btn" onClick={() => exportCsv(label, tables)}><Download size={14} /> Excel (CSV)</button>
          <button className="btn" onClick={() => window.print()}><Printer size={14} /> PDF / print</button>
        </>} />
      <div className="no-print card flex flex-wrap gap-2 p-3">
        <select className="input !w-auto" value={key} onChange={(e) => setKey(e.target.value as Key)}>{list.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}</select>
        <input className="input !w-auto" type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} />
        <input className="input !w-auto" type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} />
        <select className="input !w-auto" value={f.projectId} onChange={(e) => setF({ ...f, projectId: e.target.value })}><option value="">All projects</option>{projects.map((p) => <option key={p.id} value={p.id}>{String(p.code)} {String(p.name)}</option>)}</select>
        <select className="input !w-auto" value={f.clientId} onChange={(e) => setF({ ...f, clientId: e.target.value })}><option value="">All clients</option>{clients.map((c) => <option key={c.id} value={c.id}>{String(c.displayName || c.legalName)}</option>)}</select>
        {nonGst && <select className="input !w-auto" value={f.gst} onChange={(e) => setF({ ...f, gst: e.target.value })}><option value="">GST + non-GST</option><option value="gst">GST only</option><option value="nonGst">Non-GST only</option></select>}
      </div>
      <h2 className="text-lg font-semibold">{label} <span className="text-sm font-normal text-muted">{fmtDate(f.from)} – {fmtDate(f.to)}</span></h2>
      <Report k={key} f={f} projects={projects} onTables={setTables} />
    </div>
  );
}

function Tables({ tables }: { tables: Table[] }) {
  if (!tables.length || tables.every((t) => !t.rows.length)) return <div className="card"><Empty>No data for these filters.</Empty></div>;
  return (
    <div className="space-y-4">
      {tables.map((t, i) => (
        <div key={i} className="card overflow-x-auto">
          {t.title && <h3 className="border-b border-border px-4 py-2 text-sm font-semibold">{t.title}</h3>}
          <table className="table">
            <thead><tr>{t.head.map((h, j) => <th key={j} className={t.money?.includes(j) ? "text-right" : ""}>{h}</th>)}</tr></thead>
            <tbody>{t.rows.map((r, k) => <tr key={k} className={String(r[0]).startsWith("Total") ? "font-semibold" : ""}>{r.map((c, j) => <td key={j} className={t.money?.includes(j) ? "text-right tabular-nums" : ""}>{t.money?.includes(j) && typeof c === "number" ? inr(c) : c ?? ""}</td>)}</tr>)}</tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

function Report({ k, f, projects, onTables }: { k: Key; f: Filters; projects: Doc[]; onTables: (t: Table[]) => void }) {
  const { can, user, isAdmin, profile } = useAuth();
  const need = (keys: Key[]) => keys.includes(k);
  const { rows: accounts } = useCollection("accounts");
  const entries = useEntries();
  const transfers = useTransfers();
  const invoices = useCollection("invoices", [], { gstAware: true, enabled: need(["receivables", "gst", "pnl"]) && can("invoices", "view") });
  const payments = useCollection("payments", [], { gstAware: true, enabled: need(["tds"]) });
  const bills = useCollection("purchaseBills", [], { gstAware: true, enabled: need(["payables", "gst"]) && can("purchases", "view") });
  const reqs = useCollection("requirements", [], { enabled: need(["pipeline"]) && can("requirements", "view") });
  const props = useCollection("proposals", [], { enabled: need(["pipeline"]) && can("proposals", "view") });
  const quotes = useCollection("quotations", [], { gstAware: true, enabled: need(["pipeline"]) && can("quotations", "view") });
  const assets = useCollection("assets", [], { enabled: need(["assets"]) });
  const areqs = useCollection("assetRequests", [], { enabled: need(["required"]) });
  const meetings = useCollection("meetings", [], { enabled: need(["meetings"]) });
  const { rows: users } = useCollection("users");
  const { rows: clients } = useCollection("clients", [], { enabled: can("clients", "view") });
  const stock = useStock();
  const uname = (id: unknown) => String(users.find((u) => u.id === id)?.name ?? "");
  const projOk = (r: Doc) => !f.projectId || r.projectId === f.projectId;
  const clientOk = (r: Doc) => !f.clientId || r.clientId === f.clientId;

  const tables = useMemo((): Table[] => {
    const E = entries.rows.filter((e) => e.status !== "pending" && gstOk(e, f) && projOk(e));
    switch (k) {
      case "cash": {
        const bal = balances(accounts, entries.rows, transfers.rows);
        const seeAll = isAdmin || can("custody", "approve");
        const rows: Cell[][] = accounts.filter((a) => a.active !== false && (seeAll || a.holderId === user?.uid)).map((a) => [String(a.name), a.kind === "bank" ? "Bank" : `Cash — ${uname(a.holderId)}`, bal.get(a.id) ?? 0]);
        rows.push(["Total", "", rows.reduce((s, r) => s + Number(r[2]), 0)]);
        return [{ head: ["Account", "Kind", "Balance"], rows, money: [2] }];
      }
      case "cashflow": {
        const R = E.filter((e) => inRange(e.date, f));
        const months = [...new Set(R.map((e) => month(e.date)))].sort();
        const sum = (xs: Doc[]) => xs.reduce((s, e) => s + Number(e.amount), 0);
        const rows: Cell[][] = months.map((m) => {
          const x = R.filter((e) => month(e.date) === m);
          const i = x.filter((e) => e.direction === "in"), o = x.filter((e) => e.direction === "out");
          return [m, sum(i), sum(o), sum(i) - sum(o), sum(i.filter((e) => e.billingType !== "nonGst")), sum(i.filter((e) => e.billingType === "nonGst")), sum(o.filter((e) => e.scope === "project")), sum(o.filter((e) => e.scope !== "project"))];
        });
        const tot = (j: number) => rows.reduce((s, r) => s + Number(r[j]), 0);
        rows.push(["Total", tot(1), tot(2), tot(3), tot(4), tot(5), tot(6), tot(7)]);
        const byCat = new Map<string, number>();
        for (const e of R.filter((e) => e.direction === "out")) byCat.set(String(e.category), (byCat.get(String(e.category)) ?? 0) + Number(e.amount));
        return [
          { head: ["Month", "In", "Out", "Net", "In — GST", "In — non-GST", "Out — projects", "Out — company"], rows, money: [1, 2, 3, 4, 5, 6, 7] },
          { title: "Money out by category", head: ["Category", "Amount"], rows: [...byCat.entries()].sort((a, b) => b[1] - a[1]), money: [1] },
        ];
      }
      case "pnl": {
        const mineOnly = !isAdmin && profile?.roleId === "pm";
        const P = projects.filter((p) => (!f.projectId || p.id === f.projectId) && clientOk(p) && gstOk(p, f) && (!mineOnly || p.managerId === user?.uid));
        const rows: Cell[][] = P.map((p) => {
          const es = E.filter((e) => e.projectId === p.id && inRange(e.date, f));
          const inv = invoices.rows.filter((i) => i.projectId === p.id && i.status !== "Draft" && i.status !== "Cancelled" && inRange(i.date, f));
          const received = es.filter((e) => e.direction === "in").reduce((s, e) => s + Number(e.amount), 0);
          const cost = es.filter((e) => e.direction === "out").reduce((s, e) => s + Number(e.amount), 0);
          const value = Number(p.value ?? p.budget ?? 0);
          return [`${p.code} ${p.name}`, String(p.status), value, inv.reduce((s, i) => s + Number(i.total), 0), received, cost, received - cost, received ? `${Math.round(((received - cost) / received) * 100)}%` : "—"];
        });
        return [{ head: ["Project", "Status", "Value", "Invoiced", "Received", "Direct costs", "Direct profit", "Margin"], rows, money: [2, 3, 4, 5, 6] }];
      }
      case "receivables": {
        const open = invoices.rows.filter((i) => invoiceDue(i) > 0 && gstOk(i, f) && clientOk(i) && projOk(i));
        const detail: Cell[][] = open.sort((a, b) => String(a.date).localeCompare(String(b.date))).map((i) => [String(i.clientName), String(i.number), fmtDate(i.date), fmtDate(i.dueDate), ageDays(i.date), ageBucket(ageDays(i.date)), Number(i.total), invoiceDue(i)]);
        const byClient = new Map<string, Record<string, number>>();
        for (const i of open) { const m = byClient.get(String(i.clientName)) ?? {}; const b = ageBucket(ageDays(i.date)); m[b] = (m[b] ?? 0) + invoiceDue(i); byClient.set(String(i.clientName), m); }
        const summary: Cell[][] = [...byClient.entries()].map(([c, m]) => [c, ...AGE_BUCKETS.map((b) => m[b] ?? 0), AGE_BUCKETS.reduce((s, b) => s + (m[b] ?? 0), 0)]);
        return [
          { title: "Ageing by client", head: ["Client", ...AGE_BUCKETS.map((b) => `${b} days`), "Total"], rows: summary, money: [1, 2, 3, 4, 5] },
          { title: "Outstanding invoices", head: ["Client", "Invoice", "Date", "Due", "Days", "Bucket", "Total", "Balance"], rows: detail, money: [6, 7] },
        ];
      }
      case "payables": {
        const open = bills.rows.filter((b) => b.status !== "Paid" && gstOk(b, f) && projOk(b));
        return [{ head: ["Vendor", "Bill", "Bill date", "Due", "Total", "Paid", "Balance"], rows: open.sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate))).map((b) => [String(b.vendorName), String(b.billNo), fmtDate(b.billDate), fmtDate(b.dueDate), Number(b.total), Number(b.paid || 0), Number(b.total) - Number(b.paid || 0)]), money: [4, 5, 6] }];
      }
      case "overheads": {
        const R = E.filter((e) => e.direction === "out" && e.scope !== "project" && inRange(e.date, f));
        const months = [...new Set(R.map((e) => month(e.date)))].sort();
        const cats = [...new Set(R.map((e) => String(e.category)))].sort();
        const rows: Cell[][] = cats.map((c) => [c, ...months.map((m) => R.filter((e) => e.category === c && month(e.date) === m).reduce((s, e) => s + Number(e.amount), 0)), R.filter((e) => e.category === c).reduce((s, e) => s + Number(e.amount), 0)]);
        rows.push(["Total", ...months.map((m) => R.filter((e) => month(e.date) === m).reduce((s, e) => s + Number(e.amount), 0)), R.reduce((s, e) => s + Number(e.amount), 0)]);
        return [{ head: ["Head", ...months, "Total"], rows, money: [...months.map((_, i) => i + 1), months.length + 1] }];
      }
      case "gst": {
        const out = invoices.rows.filter((i) => i.billingType === "gst" && i.status !== "Draft" && i.status !== "Cancelled" && inRange(i.date, f) && clientOk(i) && projOk(i));
        const itcBills = bills.rows.filter((b) => b.billingType === "gst" && inRange(b.billDate, f) && projOk(b));
        const itcDirect = entries.rows.filter((e) => e.billingType === "gst" && e.isPurchase && e.taxAmount && (e.linkedDoc as { type?: string } | undefined)?.type !== "purchaseBill" && inRange(e.date, f) && projOk(e) && e.status !== "pending");
        const months = [...new Set([...out.map((i) => month(i.date)), ...itcBills.map((b) => month(b.billDate)), ...itcDirect.map((e) => month(e.date))])].sort();
        const s = (xs: Doc[], k2: string) => xs.reduce((a, x) => a + Number(x[k2] || 0), 0);
        const summary: Cell[][] = months.map((m) => {
          const o = out.filter((i) => month(i.date) === m), b = itcBills.filter((x) => month(x.billDate) === m), d = itcDirect.filter((x) => month(x.date) === m);
          const itc = s(b, "tax") + s(d, "taxAmount");
          return [m, s(o, "taxable"), s(o, "cgst"), s(o, "sgst"), s(o, "igst"), s(b, "taxable") + s(d, "taxableValue"), itc, s(o, "tax") - itc];
        });
        const cl = (id: unknown) => clients.find((c) => c.id === id);
        const b2b: Cell[][] = out.sort((a, b) => String(a.date).localeCompare(String(b.date))).map((i) => [String(cl(i.clientId)?.gstin ?? "B2C"), String(i.clientName), String(i.number), fmtDate(i.date), String(i.placeOfSupply ?? ""), Number(i.total), Number(i.taxable), Number(i.igst), Number(i.cgst), Number(i.sgst)]);
        const hsn = new Map<string, { qty: number; taxable: number; rate: number }>();
        for (const i of out) for (const l of (i.lines ?? []) as Line[]) {
          const key2 = `${l.hsn || "—"}|${l.taxRate ?? 0}`;
          const gross = (Number(l.qty) || 0) * (Number(l.rate) || 0);
          const h = hsn.get(key2) ?? { qty: 0, taxable: 0, rate: Number(l.taxRate) || 0 };
          h.qty += Number(l.qty) || 0;
          h.taxable += gross - (l.discType === "amt" ? Number(l.disc) || 0 : (gross * (Number(l.disc) || 0)) / 100);
          hsn.set(key2, h);
        }
        const purchases: Cell[][] = [
          ...itcBills.map((b) => [fmtDate(b.billDate), String(b.vendorName), String(b.vendorGstin ?? ""), String(b.billNo), Number(b.taxable), Number(b.tax)] as Cell[]),
          ...itcDirect.map((e) => [fmtDate(e.date), String(e.notes || e.category), String(e.vendorGstin ?? ""), String(e.billNo ?? ""), Number(e.taxableValue), Number(e.taxAmount)] as Cell[]),
        ];
        return [
          { title: "Monthly summary (GSTR-3B)", head: ["Month", "Outward taxable", "CGST", "SGST", "IGST", "Inward taxable", "ITC", "Net tax payable"], rows: summary, money: [1, 2, 3, 4, 5, 6, 7] },
          { title: "Outward supplies, invoice-wise (GSTR-1)", head: ["Client GSTIN", "Client", "Invoice", "Date", "Place of supply", "Invoice value", "Taxable", "IGST", "CGST", "SGST"], rows: b2b, money: [5, 6, 7, 8, 9] },
          { title: "HSN summary (pre-discount allocation)", head: ["HSN/SAC", "GST rate", "Qty", "Taxable (approx.)"], rows: [...hsn.entries()].map(([k2, h]) => [k2.split("|")[0], `${h.rate}%`, h.qty, Math.round(h.taxable * 100) / 100]), money: [3] },
          { title: "Purchases with ITC", head: ["Date", "Vendor", "Vendor GSTIN", "Bill no.", "Taxable", "Tax (ITC)"], rows: purchases, money: [4, 5] },
        ];
      }
      case "tds": {
        const P = payments.rows.filter((p) => Number(p.tds) > 0 && inRange(p.date, f) && clientOk(p) && gstOk(p, f));
        return [{ head: ["Quarter", "Client", "Date", "Invoices", "TDS", "In 26AS", "Certificate"], rows: P.sort((a, b) => String(a.date).localeCompare(String(b.date))).map((p) => [String(p.quarter), String(p.clientName), fmtDate(p.date), ((p.allocations ?? []) as Doc[]).map((a) => a.number).join(", "), Number(p.tds), p.tds26AS ? "Yes" : "No", p.tdsCertReceived ? "Yes" : "No"]), money: [4] }];
      }
      case "pipeline": {
        const R = reqs.rows.filter(clientOk);
        const count = (xs: Doc[], st: string, field = "status") => xs.filter((x) => x[field] === st).length;
        const Q = quotes.rows.filter((q) => clientOk(q) && inRange(q.date, f) && gstOk(q, f));
        const won = count(Q, "Accepted"), lost = count(Q, "Rejected");
        return [
          { title: "Requirements", head: ["Status", "Count"], rows: ["New", "Under study", "Proposal sent", "Closed - won", "Closed - lost"].map((s) => [s, count(R, s)]) },
          { title: "Proposals", head: ["Status", "Count"], rows: ["Draft", "Sent", "Accepted", "Rejected"].map((s) => [s, count(props.rows.filter(clientOk), s)]) },
          { title: "Quotations", head: ["Status", "Count", "Value"], rows: [...["Draft", "Sent", "Accepted", "Rejected"].map((s) => [s, count(Q, s), Q.filter((q) => q.status === s).reduce((a, q) => a + Number(q.total || 0), 0)] as Cell[]), ["Win rate", won + lost ? `${Math.round((won / (won + lost)) * 100)}%` : "—", null]], money: [2] },
        ];
      }
      case "status": {
        const today = new Date().toISOString().slice(0, 10);
        return [{ head: ["Project", "Client", "Status", "Manager", "Start", "Target", "Overdue"], rows: projects.filter((p) => clientOk(p) && gstOk(p, f) && (!f.projectId || p.id === f.projectId)).map((p) => [`${p.code} ${p.name}`, String(clients.find((c) => c.id === p.clientId)?.displayName ?? (p.projectType === "Internal product" ? "Internal" : "")), String(p.status), uname(p.managerId), fmtDate(p.startDate), fmtDate(p.targetDate), p.targetDate && String(p.targetDate) < today && !["Completed", "Cancelled"].includes(String(p.status)) ? "Yes" : ""]) }];
      }
      case "inventory": {
        const rows: Cell[][] = stock.items.map((it) => { const s = stock.stock.get(it.id); return [String(it.code), String(it.name), ...LOCATIONS.map((l) => s?.byLocation[l] ?? 0), s?.total ?? 0, s?.reserved ?? 0, Number(it.rate || 0) * (s?.total ?? 0), stock.low.some((x) => x.id === it.id) ? "LOW" : ""]; });
        rows.push(["Total", "", ...LOCATIONS.map(() => null), null, null, rows.reduce((s, r) => s + Number(r[LOCATIONS.length + 4]), 0), ""]);
        return [{ head: ["Code", "Item", ...LOCATIONS, "Total", "Reserved", "Stock value", "Alert"], rows, money: [LOCATIONS.length + 4] }];
      }
      case "assets":
        return [{ head: ["Code", "Asset", "Status", "Location", "Assigned to", "Value", "Next service", "Calibration", "Warranty"], rows: assets.rows.map((a) => [String(a.code), String(a.name), String(a.status), String(a.location ?? ""), uname(a.assignedTo), Number(a.value || 0), fmtDate(a.serviceDue), fmtDate(a.calibrationDue), fmtDate(a.warrantyUntil)]), money: [5] }];
      case "meetings": {
        const M = meetings.rows.filter((m) => inRange(m.date, f) && (!f.projectId || m.projectId === f.projectId) && clientOk(m));
        const mine = !isAdmin && profile?.roleId !== "pm";
        const today = new Date().toISOString().slice(0, 10);
        const acts: Cell[][] = meetings.rows.flatMap((m) => ((m.actions ?? []) as Doc[]).filter((a) => a.status !== "Done" && (!mine || a.owner === user?.uid)).map((a) => [String(a.description), uname(a.owner), fmtDate(a.due), a.due && String(a.due) < today ? "Overdue" : String(a.status ?? "Open"), String(m.title)] as Cell[]));
        return [
          { title: "MOM register", head: ["Month", "Date", "Meeting", "Type", "Status", "MOM version"], rows: mine ? [] : M.sort((a, b) => String(a.date).localeCompare(String(b.date))).map((m) => [month(m.date), fmtDate(m.date), String(m.title), String(m.meetingType), String(m.status), m.momVersion ? `v${m.momVersion}` : ""]) },
          { title: "Open action items", head: ["Action", "Owner", "Due", "Status", "Meeting"], rows: acts },
        ];
      }
      case "required": {
        let run = 0;
        const R = areqs.rows.filter((r) => r.status === "Approved").sort((a, b) => String(a.priority).localeCompare(String(b.priority)) || Number(a.order ?? 999) - Number(b.order ?? 999));
        return [{ head: ["Priority", "Item", "Qty", "Needed by", "Est. cost", "Running total"], rows: R.map((r) => { run += Number(r.estCost || 0); return [String(r.priority), String(r.item), Number(r.qty), fmtDate(r.neededBy), Number(r.estCost || 0), run]; }), money: [4, 5] }];
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [k, f, accounts, entries.rows, transfers.rows, invoices.rows, payments.rows, bills.rows, reqs.rows, props.rows, quotes.rows, assets.rows, areqs.rows, meetings.rows, users, clients, stock.items, stock.moves, projects]);

  const sig = JSON.stringify(tables.map((t) => t.rows.length));
  useEffect(() => onTables(tables), [sig, k, f]); // eslint-disable-line react-hooks/exhaustive-deps
  return <Tables tables={tables} />;
}
