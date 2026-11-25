import { computeTotals, inWords, type Adjustments, type Line } from "./tax";

/**
 * Branded HTML for printable documents. The same HTML is shown in the
 * browser and converted by Google Drive into a Google Doc / PDF, so it sticks
 * to simple tables and inline styles that Docs understands.
 */

export interface Company {
  name?: string;
  address?: string;
  gstin?: string;
  pan?: string;
  state?: string;
  phone?: string;
  email?: string;
  bankName?: string;
  bankAccount?: string;
  ifsc?: string;
  upi?: string;
  brandColor?: string;
}

const esc = (v: unknown) =>
  String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!).replace(/\n/g, "<br>");
const money = (n: number) => n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function shell(company: Company, title: string, body: string) {
  const brand = company.brandColor || "#FF6A00";
  const charcoal = "#18212B";
  // Google converts the HTML on its servers, so the logo must be on a public URL (not localhost).
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const logo = origin && !/localhost|127\.0\.0\.1/.test(origin) ? `${origin}/brand/logo.png` : "";
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>
body{font-family:Arial,Helvetica,sans-serif;font-size:10.5pt;color:#16191d;margin:24px}
h1{font-size:16pt;margin:0;color:${charcoal}} h2{font-size:12pt;margin:14px 0 6px;color:${brand}}
table{border-collapse:collapse;width:100%} td,th{border:1px solid #cfd5dd;padding:5px 6px;vertical-align:top}
th{background:#E9EDF0;color:${charcoal};text-align:left;font-size:9.5pt} .r{text-align:right} .muted{color:#5f6873;font-size:9pt}
.noborder td{border:none;padding:2px 0} .tot td{border:none;padding:2px 6px}
</style></head><body>
<table class="noborder"><tr><td>${logo ? `<img src="${logo}" alt="Rhenium" style="height:56px;margin-bottom:4px"><br>` : ""}<h1>${esc(company.name || "Rhenium")}</h1>
<div class="muted">${esc(company.address)}</div>
<div class="muted">${[company.gstin && `GSTIN: ${esc(company.gstin)}`, company.pan && `PAN: ${esc(company.pan)}`, company.phone && esc(company.phone), company.email && esc(company.email)].filter(Boolean).join(" · ")}</div>
</td><td class="r"><h1 style="color:${brand}">${esc(title)}</h1></td></tr></table>
<hr style="border:none;border-top:2px solid ${brand};margin:10px 0">
${body}
</body></html>`;
}

export interface Party {
  name?: string;
  address?: string;
  gstin?: string;
  state?: string;
  contact?: string;
}

function partyBlock(label: string, p: Party) {
  return `<b>${esc(label)}</b><br>${esc(p.name)}<br><span class="muted">${esc(p.address)}${p.state ? `<br>State: ${esc(p.state)}` : ""}${p.gstin ? `<br>GSTIN: ${esc(p.gstin)}` : ""}${p.contact ? `<br>${esc(p.contact)}` : ""}</span>`;
}

export function commercialDocHtml(o: {
  company: Company;
  title: string;
  party: Party;
  partyLabel?: string;
  meta: [string, unknown][];
  lines: Line[];
  adj: Adjustments;
  gst: boolean;
  intraState: boolean;
  notes?: string;
  terms?: string;
  showBank?: boolean;
  extra?: string;
}) {
  const t = computeTotals(o.lines, o.adj, { gst: o.gst, intraState: o.intraState });
  const rows = o.lines
    .map((l, i) => `<tr><td>${i + 1}</td><td>${esc(l.description)}</td>${o.gst ? `<td>${esc(l.hsn)}</td>` : ""}<td class="r">${esc(l.qty)} ${esc(l.unit)}</td><td class="r">${money(Number(l.rate) || 0)}</td><td class="r">${t.lines[i].discount ? money(t.lines[i].discount) : ""}</td>${o.gst ? `<td class="r">${esc(l.taxRate ?? 0)}%</td>` : ""}<td class="r">${money(t.lines[i].taxable)}</td></tr>`)
    .join("");
  const tot: [string, number][] = [["Subtotal", t.subtotal]];
  if (t.overallDiscount) tot.push(["Discount", -t.overallDiscount]);
  for (const c of o.adj.charges ?? []) if (Number(c.amount)) tot.push([c.label || "Charges", Number(c.amount)]);
  tot.push(["Taxable value", t.taxable]);
  if (o.gst) {
    if (o.intraState) tot.push(["CGST", t.cgst], ["SGST", t.sgst]);
    else tot.push(["IGST", t.igst]);
  }
  if (t.roundOff) tot.push(["Round off", t.roundOff]);
  tot.push(["Total", t.total]);
  if (t.advance) tot.push(["Less: advance received", -t.advance], ["Amount due", t.due]);

  const body = `
<table class="noborder"><tr><td style="width:55%">${partyBlock(o.partyLabel ?? "Bill to", o.party)}</td>
<td><table>${o.meta.map(([k, v]) => `<tr><td class="muted" style="width:45%">${esc(k)}</td><td>${esc(v)}</td></tr>`).join("")}</table></td></tr></table>
${o.extra ?? ""}
<h2>Items</h2>
<table><tr><th>#</th><th>Description</th>${o.gst ? "<th>HSN/SAC</th>" : ""}<th class="r">Qty</th><th class="r">Rate</th><th class="r">Discount</th>${o.gst ? '<th class="r">GST</th>' : ""}<th class="r">Amount</th></tr>${rows}</table>
<table class="tot" style="width:45%;margin-left:55%;margin-top:6px">${tot.map(([k, v], i) => `<tr><td>${i === tot.length - 1 ? `<b>${esc(k)}</b>` : esc(k)}</td><td class="r">${i === tot.length - 1 ? `<b>₹ ${money(v)}</b>` : money(v)}</td></tr>`).join("")}</table>
<p class="muted">${esc(inWords(t.advance ? t.due : t.total))}</p>
${o.notes ? `<h2>Notes</h2><p>${esc(o.notes)}</p>` : ""}
${o.terms ? `<h2>Terms</h2><p>${esc(o.terms)}</p>` : ""}
${o.showBank && o.company.bankAccount ? `<h2>Bank details</h2><p>${esc(o.company.name)}<br>${esc(o.company.bankName)} · A/c ${esc(o.company.bankAccount)} · IFSC ${esc(o.company.ifsc)}${o.company.upi ? `<br>UPI: ${esc(o.company.upi)}` : ""}</p>` : ""}
<p style="margin-top:40px" class="r">For ${esc(o.company.name)}<br><br><br>Authorised signatory</p>`;
  return shell(o.company, o.title, body);
}

/** Text sections document (proposals, MOMs). */
export function sectionsDocHtml(o: { company: Company; title: string; meta: [string, unknown][]; sections: [string, string][]; tables?: { title: string; head: string[]; rows: unknown[][] }[] }) {
  const body = `
<table>${o.meta.map(([k, v]) => `<tr><td class="muted" style="width:30%">${esc(k)}</td><td>${esc(v)}</td></tr>`).join("")}</table>
${o.sections.filter(([, v]) => v).map(([h, v]) => `<h2>${esc(h)}</h2><p>${esc(v)}</p>`).join("")}
${(o.tables ?? []).filter((t) => t.rows.length).map((t) => `<h2>${esc(t.title)}</h2><table><tr>${t.head.map((h) => `<th>${esc(h)}</th>`).join("")}</tr>${t.rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</table>`).join("")}`;
  return shell(o.company, o.title, body);
}
