/**
 * Line items, discounts, charges and GST (§5.1, §9).
 * Tax is calculated on the value after discount. CGST+SGST when the place of
 * supply is the company's state, IGST otherwise.
 */

export interface Line {
  itemId?: string | null;
  description: string;
  hsn?: string;
  qty: number;
  unit?: string;
  rate: number;
  discType?: "pct" | "amt";
  disc?: number;
  taxRate?: number;
  /** BOM estimate per unit, to show margin on quotations. */
  cost?: number;
}

export interface Charge {
  label: string;
  amount: number;
  taxRate?: number;
}

export interface Adjustments {
  overallDiscType?: "pct" | "amt";
  overallDisc?: number;
  charges?: Charge[];
  roundOff?: boolean;
  advance?: number;
}

export interface Totals {
  lines: { gross: number; discount: number; taxable: number; tax: number }[];
  subtotal: number;
  lineDiscount: number;
  overallDiscount: number;
  chargesTotal: number;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  tax: number;
  roundOff: number;
  total: number;
  advance: number;
  due: number;
  /** Taxable value and tax per GST rate (for GSTR-1 style summaries). */
  byRate: Record<string, { taxable: number; tax: number }>;
  cost: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function computeTotals(lines: Line[], adj: Adjustments = {}, opts: { gst: boolean; intraState: boolean }): Totals {
  const ls = lines.map((l) => {
    const gross = (Number(l.qty) || 0) * (Number(l.rate) || 0);
    const d = Number(l.disc) || 0;
    const discount = l.discType === "amt" ? Math.min(d, gross) : (gross * d) / 100;
    return { gross, discount, net: gross - discount, rate: opts.gst ? Number(l.taxRate) || 0 : 0 };
  });
  const subtotal = ls.reduce((s, l) => s + l.net, 0);
  const od = Number(adj.overallDisc) || 0;
  const overallDiscount = Math.min(subtotal, adj.overallDiscType === "amt" ? od : (subtotal * od) / 100);
  const factor = subtotal ? (subtotal - overallDiscount) / subtotal : 0;
  const byRate: Totals["byRate"] = {};
  const add = (rate: number, taxable: number, tax: number) => {
    const k = String(rate);
    byRate[k] = { taxable: (byRate[k]?.taxable ?? 0) + taxable, tax: (byRate[k]?.tax ?? 0) + tax };
  };
  const outLines = ls.map((l) => {
    const taxable = l.net * factor;
    const tax = (taxable * l.rate) / 100;
    add(l.rate, taxable, tax);
    return { gross: r2(l.gross), discount: r2(l.discount), taxable: r2(taxable), tax: r2(tax) };
  });
  let chargesTotal = 0;
  for (const c of adj.charges ?? []) {
    const amt = Number(c.amount) || 0;
    const rate = opts.gst ? Number(c.taxRate) || 0 : 0;
    chargesTotal += amt;
    add(rate, amt, (amt * rate) / 100);
  }
  const taxable = Object.values(byRate).reduce((s, x) => s + x.taxable, 0);
  const tax = r2(Object.values(byRate).reduce((s, x) => s + x.tax, 0));
  const cgst = opts.gst && opts.intraState ? r2(tax / 2) : 0;
  const sgst = opts.gst && opts.intraState ? r2(tax - cgst) : 0;
  const igst = opts.gst && !opts.intraState ? tax : 0;
  const raw = taxable + tax;
  const roundOff = adj.roundOff ? r2(Math.round(raw) - raw) : 0;
  const total = r2(raw + roundOff);
  const advance = Math.min(Number(adj.advance) || 0, total);
  for (const k of Object.keys(byRate)) byRate[k] = { taxable: r2(byRate[k].taxable), tax: r2(byRate[k].tax) };
  return {
    lines: outLines,
    subtotal: r2(subtotal),
    lineDiscount: r2(ls.reduce((s, l) => s + l.discount, 0)),
    overallDiscount: r2(overallDiscount),
    chargesTotal: r2(chargesTotal),
    taxable: r2(taxable),
    cgst, sgst, igst, tax,
    roundOff,
    total,
    advance: r2(advance),
    due: r2(total - advance),
    byRate,
    cost: r2(lines.reduce((s, l) => s + (Number(l.cost) || 0) * (Number(l.qty) || 0), 0)),
  };
}

/** Highest discount % on the document (line or overall), for approval rules. */
export function maxDiscountPct(lines: Line[], adj: Adjustments) {
  let max = 0;
  for (const l of lines) {
    const gross = (Number(l.qty) || 0) * (Number(l.rate) || 0);
    const pct = l.discType === "amt" ? (gross ? ((Number(l.disc) || 0) / gross) * 100 : 0) : Number(l.disc) || 0;
    max = Math.max(max, pct);
  }
  const sub = lines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.rate) || 0), 0);
  const od = Number(adj.overallDisc) || 0;
  max = Math.max(max, adj.overallDiscType === "amt" ? (sub ? (od / sub) * 100 : 0) : od);
  return Math.round(max * 100) / 100;
}

export const sameState = (a?: unknown, b?: unknown) =>
  String(a ?? "").trim().toLowerCase() === String(b ?? "").trim().toLowerCase() && Boolean(a);

/** Amount in words, Indian numbering (for invoices). */
export function inWords(n: number) {
  const ones = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  const two = (x: number) => (x < 20 ? ones[x] : `${tens[Math.floor(x / 10)]}${x % 10 ? " " + ones[x % 10] : ""}`);
  const three = (x: number) => (x >= 100 ? `${ones[Math.floor(x / 100)]} Hundred${x % 100 ? " " + two(x % 100) : ""}` : two(x));
  const words = (x: number): string => {
    if (x === 0) return "Zero";
    const parts: string[] = [];
    const cr = Math.floor(x / 1e7); x %= 1e7;
    const lk = Math.floor(x / 1e5); x %= 1e5;
    const th = Math.floor(x / 1e3); x %= 1e3;
    if (cr) parts.push(`${words(cr)} Crore`);
    if (lk) parts.push(`${two(lk)} Lakh`);
    if (th) parts.push(`${two(th)} Thousand`);
    if (x) parts.push(three(x));
    return parts.join(" ");
  };
  const rupees = Math.floor(Math.abs(n));
  const paise = Math.round((Math.abs(n) - rupees) * 100);
  return `Rupees ${words(rupees)}${paise ? ` and ${two(paise)} Paise` : ""} Only`;
}
