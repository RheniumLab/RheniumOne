"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { arrayUnion, where } from "firebase/firestore";
import { ArrowRight, ChevronLeft, ChevronRight, Plus, Save, Trash2 } from "lucide-react";
import { Badge, Empty, ErrorBox, NoAccess, PageHeader, Spinner, Stat } from "@/components/ui";
import { useAuth } from "@/lib/auth-context";
import { useCollection, useDoc } from "@/lib/hooks";
import { createDoc, inr, pad, updateDoc } from "@/lib/data";
import { bomTotal, childrenOf, isLeaf, nextRev, totalQty, unitCosts, type BomLine, type Quote } from "@/lib/bom";

export default function BomPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { can, money } = useAuth();
  const { data: bom, loading } = useDoc("boms", id);
  const { rows: items } = useCollection("items");
  const { rows: vendors } = useCollection("vendors", [], { enabled: can("vendors", "view") || can("sourcing", "view") });
  const pos = useCollection("pos", [where("bomId", "==", id)], { gstAware: true, enabled: can("purchases", "view") }, [id]);
  const [lines, setLines] = useState<BomLine[]>([]);
  const [dirty, setDirty] = useState(false);
  const [tab, setTab] = useState<"lines" | "sourcing" | "revisions">("lines");
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (bom && !dirty) setLines((bom.lines ?? []) as BomLine[]);
  }, [bom, dirty]);

  const unit = useMemo(() => unitCosts(lines), [lines]);
  if (!can("boms", "view")) return <NoAccess />;
  if (loading) return <Spinner />;
  if (!bom) return <Empty>BOM not found.</Empty>;

  const editable = can("boms", "edit");
  const set = (i: number, p: Partial<BomLine>) => {
    setLines(lines.map((l, j) => (j === i ? { ...l, ...p } : l)));
    setDirty(true);
  };
  const add = (after?: number, level = 0) => {
    const l: BomLine = { level, description: "", qty: 1, unit: "Nos", rate: 0, makeBuy: "Buy" };
    const next = [...lines];
    next.splice(after === undefined ? lines.length : after + 1, 0, l);
    setLines(next);
    setDirty(true);
  };
  const remove = (i: number) => {
    const kids = childrenOf(lines, i).length;
    if (kids && !confirm("Remove this assembly and all its parts?")) return;
    let end = i + 1;
    while (end < lines.length && (lines[end].level ?? 0) > (lines[i].level ?? 0)) end++;
    setLines([...lines.slice(0, i), ...lines.slice(end)]);
    setDirty(true);
  };
  const save = async () => {
    await updateDoc("boms", id, { lines, estCost: bomTotal(lines) }, bom);
    setDirty(false);
  };
  const vname = (v?: string | null) => String(vendors.find((x) => x.id === v)?.name ?? "");

  const newRevision = async () => {
    const note = prompt(`What changed in Rev ${nextRev(String(bom.rev))}?`);
    if (!note) return;
    await updateDoc("boms", id, { rev: nextRev(String(bom.rev)), revNote: note, lines, revisions: arrayUnion({ rev: bom.rev, note: bom.revNote ?? "", lines: bom.lines ?? [], at: new Date().toISOString() }) }, bom);
    setDirty(false);
  };

  /** MBOM derived from the EBOM: how it is actually built and bought (§7.1). */
  const deriveMbom = async () => {
    const nid = await createDoc("boms", {
      name: `${bom.name} (MBOM)`, projectId: bom.projectId, kind: "MBOM", rev: "A", revNote: `Derived from ${bom.code} Rev ${bom.rev}`, derivedFrom: id,
      lines: lines.map((l, i) => ({ ...l, makeBuy: isLeaf(lines, i) ? "Buy" : "Make", process: l.process ?? "", consumable: false })), revisions: [],
    }, { counter: "bom", field: "code", format: (n) => `BOM-${pad(n)}` });
    router.push(`/boms/${nid}`);
  };

  /** One PO per selected vendor from the chosen lines (§7.3). */
  const createPos = async () => {
    setErr(null);
    const chosen = [...sel].filter((i) => isLeaf(lines, i));
    if (!chosen.length) return setErr("Tick the parts to buy (parts, not assemblies).");
    const byVendor = new Map<string, number[]>();
    for (const i of chosen) {
      const v = lines[i].selectedVendorId || lines[i].vendorId;
      if (!v) return setErr(`Choose a vendor for "${lines[i].description}" on the Sourcing tab.`);
      byVendor.set(v, [...(byVendor.get(v) ?? []), i]);
    }
    const qtyMul = Number(prompt("How many units of the product are you buying for?", "1") || 0);
    if (!qtyMul) return;
    const ids: string[] = [];
    for (const [vendorId, idx] of byVendor) {
      const poLines = idx.map((i) => {
        const q = (lines[i].quotes ?? []).find((x) => x.vendorId === vendorId);
        const it = items.find((x) => x.id === lines[i].itemId);
        return { itemId: lines[i].itemId ?? null, description: [lines[i].partNo, lines[i].description].filter(Boolean).join(" — "), hsn: String(it?.hsn ?? ""), qty: totalQty(lines, i) * qtyMul, unit: lines[i].unit ?? "Nos", rate: q?.price ?? lines[i].rate ?? 0, taxRate: 18, disc: 0, discType: "pct", received: 0, bomLine: i };
      });
      const nid = await createDoc("pos", { vendorId, projectId: bom.projectId, scope: "project", bomId: id, date: new Date().toISOString().slice(0, 10), lines: poLines, adj: {}, billingType: "gst", status: "Draft" });
      ids.push(nid);
    }
    setSel(new Set());
    router.push(ids.length === 1 ? `/purchases/${ids[0]}` : "/purchases");
  };

  const est = bomTotal(lines);
  const actual = pos.rows.filter((p) => p.status !== "Cancelled" && p.status !== "Rejected").reduce((s, p) => s + Number(p.taxable ?? 0), 0);

  return (
    <div className="space-y-4">
      <PageHeader
        back="/boms"
        title={`${bom.name}`}
        subtitle={<span className="flex flex-wrap items-center gap-2">{String(bom.code)} <Badge kind="brand">{String(bom.kind)}</Badge> Rev {String(bom.rev)} · {String(bom.revNote ?? "")}</span>}
        actions={
          <>
            {dirty && editable && <button className="btn-primary" onClick={save}><Save size={14} /> Save changes</button>}
            {editable && <button className="btn" onClick={newRevision}>New revision</button>}
            {bom.kind === "EBOM" && can("boms", "create") && <button className="btn" onClick={deriveMbom}>Derive MBOM</button>}
            {bom.projectId ? <Link className="btn" href={`/projects/${bom.projectId}`}>Project <ArrowRight size={14} /></Link> : null}
          </>
        }
      />
      <div className="grid grid-cols-3 gap-3">
        {money && <Stat label="Estimated cost (per unit)" value={inr(est)} />}
        {money && <Stat label="Actual (linked POs, taxable)" value={inr(actual)} />}
        <Stat label="Lines" value={lines.length} />
      </div>
      {err && <ErrorBox>{err}</ErrorBox>}
      <div className="flex gap-1 border-b border-border">
        {(["lines", "sourcing", "revisions"] as const).filter((t) => money || t !== "sourcing").map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`-mb-px border-b-2 px-3 py-2 text-sm capitalize ${tab === t ? "border-brand font-medium text-brand" : "border-transparent text-muted"}`}>{t}</button>
        ))}
      </div>

      {tab === "lines" && (
        <div className="card overflow-x-auto">
          <table className="table min-w-[1000px]">
            <thead>
              <tr>
                <th className="w-8"></th><th className="w-28">Part no.</th><th>Description</th><th className="w-20 text-right">Qty</th><th className="w-16">Unit</th>
                <th className="w-40">Item</th><th>Spec</th>{bom.kind === "MBOM" && <><th className="w-24">Make/buy</th><th>Process</th></>}
                {money && <><th className="w-24 text-right">Rate</th><th className="w-28 text-right">Unit cost</th></>}<th className="w-28"></th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => {
                const asm = !isLeaf(lines, i);
                return (
                  <tr key={i} className="align-top">
                    <td><input type="checkbox" checked={sel.has(i)} onChange={(e) => { const s = new Set(sel); if (e.target.checked) s.add(i); else s.delete(i); setSel(s); }} /></td>
                    <td><input className="input !py-1" disabled={!editable} value={l.partNo ?? ""} onChange={(e) => set(i, { partNo: e.target.value })} /></td>
                    <td>
                      <div className="flex items-center" style={{ paddingLeft: (l.level ?? 0) * 18 }}>
                        {asm && <span className="mr-1 text-xs text-muted">▾</span>}
                        <input className={`input !py-1 ${asm ? "font-medium" : ""}`} disabled={!editable} value={l.description} onChange={(e) => set(i, { description: e.target.value })} />
                      </div>
                    </td>
                    <td><input className="input !py-1 text-right" type="number" step="any" disabled={!editable} value={l.qty} onChange={(e) => set(i, { qty: Number(e.target.value) })} /></td>
                    <td><input className="input !py-1" disabled={!editable} value={l.unit ?? ""} onChange={(e) => set(i, { unit: e.target.value })} /></td>
                    <td>
                      <select className="input !py-1" disabled={!editable} value={l.itemId ?? ""} onChange={(e) => {
                        const it = items.find((x) => x.id === e.target.value);
                        set(i, { itemId: e.target.value || null, ...(it ? { description: l.description || String(it.name), unit: String(it.unit ?? l.unit), rate: Number(it.rate ?? l.rate ?? 0) } : {}) });
                      }}>
                        <option value="">Select item</option>
                        {items.map((it) => <option key={it.id} value={it.id}>{String(it.code)} {String(it.name)}</option>)}
                      </select>
                    </td>
                    <td><input className="input !py-1" disabled={!editable} value={l.spec ?? ""} onChange={(e) => set(i, { spec: e.target.value })} /></td>
                    {bom.kind === "MBOM" && (
                      <>
                        <td><select className="input !py-1" disabled={!editable} value={l.makeBuy ?? "Buy"} onChange={(e) => set(i, { makeBuy: e.target.value as "Make" | "Buy" })}><option>Buy</option><option>Make</option></select></td>
                        <td><input className="input !py-1" disabled={!editable} value={l.process ?? ""} onChange={(e) => set(i, { process: e.target.value })} placeholder={l.makeBuy === "Make" ? "Process steps" : "Consumables"} /></td>
                      </>
                    )}
                    {money && <td><input className="input !py-1 text-right" type="number" step="0.01" disabled={!editable} value={l.rate ?? ""} onChange={(e) => set(i, { rate: Number(e.target.value) })} title={asm ? "Extra cost on top of parts (labour etc.)" : "Estimated unit rate"} /></td>}
                    {money && <td className="whitespace-nowrap text-right tabular-nums">{inr(unit[i])}</td>}
                    <td className="whitespace-nowrap">
                      {editable && (
                        <span className="flex gap-1 text-muted">
                          <button title="Outdent" onClick={() => set(i, { level: Math.max(0, (l.level ?? 0) - 1) })}><ChevronLeft size={15} /></button>
                          <button title="Indent (make part of the line above)" onClick={() => i > 0 && set(i, { level: Math.min((lines[i - 1].level ?? 0) + 1, (l.level ?? 0) + 1) })}><ChevronRight size={15} /></button>
                          <button title="Add part below" onClick={() => add(i, (l.level ?? 0) + (asm ? 1 : 0))}><Plus size={15} /></button>
                          <button title="Remove" className="hover:text-danger" onClick={() => remove(i)}><Trash2 size={14} /></button>
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {editable && <div className="p-3"><button className="btn" onClick={() => add()}><Plus size={14} /> Add line</button></div>}
        </div>
      )}

      {tab === "sourcing" && money && (
        <div className="space-y-3">
          <p className="text-sm text-muted">For each part: shortlisted vendors, their prices and lead times, and the chosen vendor (§7.2). Tick parts and create purchase orders.</p>
          <div className="card overflow-x-auto">
            <table className="table min-w-[900px]">
              <thead><tr><th className="w-8"></th><th>Part</th><th className="text-right">Qty / unit</th><th className="text-right">Estimate</th><th>Vendor quotes</th><th>Selected</th><th className="text-right">vs estimate</th></tr></thead>
              <tbody>
                {lines.map((l, i) => {
                  if (!isLeaf(lines, i)) return null;
                  const quotes = l.quotes ?? [];
                  const chosen = quotes.find((q) => q.vendorId === l.selectedVendorId);
                  const diff = chosen ? chosen.price - (Number(l.rate) || 0) : 0;
                  const setQ = (qs: Quote[]) => set(i, { quotes: qs });
                  return (
                    <tr key={i} className="align-top">
                      <td><input type="checkbox" checked={sel.has(i)} onChange={(e) => { const s = new Set(sel); if (e.target.checked) s.add(i); else s.delete(i); setSel(s); }} /></td>
                      <td>{l.partNo ? `${l.partNo} · ` : ""}{l.description}</td>
                      <td className="text-right">{totalQty(lines, i)} {l.unit}</td>
                      <td className="whitespace-nowrap text-right tabular-nums">{inr(Number(l.rate) || 0)}</td>
                      <td>
                        {quotes.map((q, k) => (
                          <div key={k} className="mb-1 flex gap-1">
                            <select className="input !w-40 !py-1" disabled={!editable} value={q.vendorId} onChange={(e) => setQ(quotes.map((x, j) => (j === k ? { ...x, vendorId: e.target.value } : x)))}>
                              <option value="">Select vendor</option>{vendors.map((v) => <option key={v.id} value={v.id}>{String(v.name)}</option>)}
                            </select>
                            <input className="input !w-24 !py-1 text-right" type="number" step="0.01" placeholder="Price" disabled={!editable} value={q.price || ""} onChange={(e) => setQ(quotes.map((x, j) => (j === k ? { ...x, price: Number(e.target.value) } : x)))} />
                            <input className="input !w-20 !py-1" type="number" placeholder="Days" disabled={!editable} value={q.leadDays ?? ""} onChange={(e) => setQ(quotes.map((x, j) => (j === k ? { ...x, leadDays: Number(e.target.value) } : x)))} />
                            {editable && <button className="text-muted hover:text-danger" onClick={() => setQ(quotes.filter((_, j) => j !== k))}><Trash2 size={13} /></button>}
                          </div>
                        ))}
                        {editable && <button className="text-xs text-brand" onClick={() => setQ([...quotes, { vendorId: "", price: 0 }])}>+ quote</button>}
                      </td>
                      <td>
                        <select className="input !py-1" disabled={!editable} value={l.selectedVendorId ?? ""} onChange={(e) => set(i, { selectedVendorId: e.target.value || null })}>
                          <option value="">Select vendor</option>
                          {quotes.filter((q) => q.vendorId).map((q) => <option key={q.vendorId} value={q.vendorId}>{vname(q.vendorId)} · {inr(q.price)}</option>)}
                        </select>
                      </td>
                      <td className={`text-right tabular-nums ${diff > 0 ? "text-danger" : diff < 0 ? "text-ok" : ""}`}>{chosen ? `${diff > 0 ? "+" : ""}${inr(diff)}` : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex gap-2">
            {dirty && editable && <button className="btn-primary" onClick={save}><Save size={14} /> Save sourcing</button>}
            {can("purchases", "create") && <button className="btn" disabled={dirty} onClick={createPos} title={dirty ? "Save first" : ""}>Create POs from ticked parts</button>}
          </div>
        </div>
      )}

      {tab === "revisions" && (
        <div className="card p-4 text-sm">
          <div className="mb-2"><b>Rev {String(bom.rev)}</b> (current) — {String(bom.revNote ?? "")}</div>
          {((bom.revisions ?? []) as { rev: string; note: string; at: string; lines: BomLine[] }[]).slice().reverse().map((r) => (
            <div key={r.rev} className="border-t border-border py-2">
              <b>Rev {r.rev}</b> — {r.note} <span className="text-muted">· replaced {new Date(r.at).toLocaleDateString("en-IN")} · {r.lines.length} lines{money ? ` · est. ${inr(bomTotal(r.lines))}` : ""}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
