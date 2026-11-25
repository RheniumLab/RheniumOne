/** Multi-level BOM helpers (§7.1). Lines are a flat list with an indent `level`. */

export interface Quote {
  vendorId: string;
  price: number;
  leadDays?: number;
  note?: string;
}

export interface BomLine {
  level: number;
  partNo?: string;
  description: string;
  qty: number;
  unit?: string;
  spec?: string;
  itemId?: string | null;
  /** Estimated unit rate (leaf parts). Assemblies roll up from their children. */
  rate?: number;
  makeBuy?: "Make" | "Buy";
  process?: string;
  vendorId?: string | null;
  consumable?: boolean;
  quotes?: Quote[];
  selectedVendorId?: string | null;
}

export const childrenOf = (lines: BomLine[], i: number) => {
  const out: number[] = [];
  const lv = lines[i].level ?? 0;
  for (let j = i + 1; j < lines.length && (lines[j].level ?? 0) > lv; j++) if ((lines[j].level ?? 0) === lv + 1) out.push(j);
  return out;
};

/** Unit cost of each line: own rate for parts, sum of children for assemblies. */
export function unitCosts(lines: BomLine[]) {
  const memo = new Map<number, number>();
  const cost = (i: number): number => {
    if (memo.has(i)) return memo.get(i)!;
    const kids = childrenOf(lines, i);
    const c = kids.length ? kids.reduce((s, k) => s + (Number(lines[k].qty) || 0) * cost(k), 0) + (Number(lines[i].rate) || 0) : Number(lines[i].rate) || 0;
    memo.set(i, c);
    return c;
  };
  return lines.map((_, i) => cost(i));
}

export function bomTotal(lines: BomLine[]) {
  const u = unitCosts(lines);
  return lines.reduce((s, l, i) => ((l.level ?? 0) === 0 ? s + (Number(l.qty) || 0) * u[i] : s), 0);
}

/** Total quantity of a line for one unit of the product (multiplies parent quantities). */
export function totalQty(lines: BomLine[], i: number) {
  let q = Number(lines[i].qty) || 0;
  let lv = lines[i].level ?? 0;
  for (let j = i - 1; j >= 0 && lv > 0; j--) {
    if ((lines[j].level ?? 0) < lv) {
      q *= Number(lines[j].qty) || 0;
      lv = lines[j].level ?? 0;
    }
  }
  return q;
}

export const nextRev = (r: string) => (r ? String.fromCharCode(r.charCodeAt(r.length - 1) + 1) : "A");

/** Leaf lines to buy: no children. */
export const isLeaf = (lines: BomLine[], i: number) => childrenOf(lines, i).length === 0;
