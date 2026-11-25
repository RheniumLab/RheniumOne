"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Camera } from "lucide-react";
import { CategorySelect } from "@/components/category-select";
import { ErrorBox, NoAccess, PageHeader } from "@/components/ui";
import { useAuth } from "@/lib/auth-context";
import { useCollection } from "@/lib/hooks";
import { MODES } from "@/lib/money";
import { createDoc, today } from "@/lib/data";
import { saveFile } from "@/lib/files";
import { DateInput } from "@/components/date-input";

export default function NewEntryPage() {
  return (
    <Suspense>
      <NewEntry />
    </Suspense>
  );
}

function NewEntry() {
  const { can, nonGst, user, isAdmin } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const fullAccess = can("cashflow", "create");
  const { rows: accountsAll } = useCollection("accounts");
  const { rows: projects } = useCollection("projects", [], { gstAware: true, enabled: can("projects", "view") || fullAccess });
  const { rows: vendors } = useCollection("vendors", [], { enabled: can("vendors", "view") });

  const [v, setV] = useState({
    date: today(),
    direction: "out",
    amount: "",
    scope: params.get("projectId") ? "project" : "company",
    projectId: params.get("projectId") ?? "",
    category: "",
    billingType: "gst",
    accountId: "",
    mode: "UPI",
    notes: "",
    vendorId: "",
    vendorGstin: "",
    billNo: "",
    taxableValue: "",
    taxAmount: "",
    notPurchase: false,
  });
  const [bill, setBill] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = useCallback((k: string, x: unknown) => setV((p) => ({ ...p, [k]: x })), []);

  // Users without cash-flow rights can only record in their own wallet.
  const accounts = useMemo(
    () => accountsAll.filter((a) => a.active !== false && (fullAccess || a.holderId === user?.uid)),
    [accountsAll, fullAccess, user?.uid],
  );
  const myWallet = accountsAll.find((a) => a.kind === "cash" && a.holderId === user?.uid);

  // The project's billing type fills in; non-GST receipts default to the person's wallet (§8.5, §9).
  useEffect(() => {
    const p = projects.find((x) => x.id === v.projectId);
    if (v.scope === "project" && p?.billingType) set("billingType", p.billingType);
  }, [v.projectId, v.scope, projects, set]);
  useEffect(() => {
    if (v.accountId) return;
    if (v.billingType === "nonGst" || !fullAccess) {
      if (myWallet) set("accountId", myWallet.id);
    } else {
      const bank = accounts.find((a) => a.kind === "bank");
      if (bank) set("accountId", bank.id);
    }
  }, [v.billingType, myWallet, accounts, fullAccess, v.accountId, set]);
  useEffect(() => {
    const vend = vendors.find((x) => x.id === v.vendorId);
    if (vend?.gstin) set("vendorGstin", vend.gstin);
  }, [v.vendorId, vendors, set]);

  if (!fullAccess && !can("custody", "create")) return <NoAccess />;

  const catType = v.direction === "in" ? "income" : v.scope === "project" ? "project" : "company";
  const isPurchase = v.direction === "out" && !v.notPurchase;
  const gstPurchase = isPurchase && v.billingType === "gst";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (isPurchase && !bill) return setErr("A bill photo or PDF is required for every purchase.");
    if (v.scope === "project" && !v.projectId) return setErr("Choose the project.");
    const account = accountsAll.find((a) => a.id === v.accountId);
    if (!account) return setErr("Choose the account the money moved through.");
    setBusy(true);
    try {
      const billId = bill ? await saveFile(bill, { folder: `Bills/${v.date.slice(0, 7)}`, billingType: v.billingType }) : null;
      await createDoc("entries", {
        date: v.date,
        direction: v.direction,
        amount: Number(v.amount),
        scope: v.scope,
        projectId: v.scope === "project" ? v.projectId : null,
        category: v.category,
        billingType: v.billingType,
        accountId: v.accountId,
        accountHolder: account.holderId ?? null,
        mode: v.mode,
        notes: v.notes,
        billId,
        isPurchase,
        vendorId: gstPurchase ? v.vendorId || null : null,
        vendorGstin: gstPurchase ? v.vendorGstin : null,
        billNo: gstPurchase ? v.billNo : null,
        taxableValue: gstPurchase ? Number(v.taxableValue || 0) : null,
        taxAmount: gstPurchase ? Number(v.taxAmount || 0) : null,
        status: "approved",
      });
      router.push(v.scope === "project" && params.get("projectId") ? `/projects/${v.projectId}` : "/cashflow");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <div className="max-w-3xl">
      <PageHeader title="New money entry" subtitle="Works offline — syncs when you’re back online" back="/cashflow" />
      <form onSubmit={submit} className="space-y-4">
        <div className="card grid gap-3 p-4 sm:grid-cols-2">
          <div className="sm:col-span-2 flex gap-2">
            {(["out", "in"] as const).map((d) => (
              <button type="button" key={d} onClick={() => set("direction", d)} className={`flex-1 ${v.direction === d ? "btn-primary" : "btn"}`}>
                {d === "out" ? "Money out" : "Money in"}
              </button>
            ))}
          </div>
          <div><label className="label">Date *</label><DateInput required value={v.date} onChange={(val) => set("date", val)} /></div>
          <div><label className="label">Amount (₹) *</label><input className="input tabular-nums" type="number" step="0.01" min="0.01" required value={v.amount} onChange={(e) => set("amount", e.target.value)} /></div>
          <div>
            <label className="label">For</label>
            <select className="input" value={v.scope} onChange={(e) => set("scope", e.target.value)}>
              <option value="company">Company (overhead)</option><option value="project">Project</option>
            </select>
          </div>
          {v.scope === "project" ? (
            <div>
              <label className="label">Project *</label>
              <select className="input" required value={v.projectId} onChange={(e) => set("projectId", e.target.value)}>
                <option value="">Select project</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{String(p.code)} · {String(p.name)}</option>)}
              </select>
            </div>
          ) : <div />}
          <div><label className="label">Category *</label><CategorySelect type={catType} value={v.category} onChange={(x) => set("category", x)} required /></div>
          <div>
            <label className="label">GST / non-GST</label>
            <select className="input" value={v.billingType} onChange={(e) => set("billingType", e.target.value)}>
              <option value="gst">GST</option>
              {(nonGst || !fullAccess || isAdmin) && <option value="nonGst">Non-GST</option>}
            </select>
          </div>
          <div>
            <label className="label">Account *</label>
            <select className="input" required value={v.accountId} onChange={(e) => set("accountId", e.target.value)}>
              <option value="">Select account</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{String(a.name)}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Mode</label>
            <select className="input" value={v.mode} onChange={(e) => set("mode", e.target.value)}>{MODES.map((m) => <option key={m}>{m}</option>)}</select>
          </div>
          <div className="sm:col-span-2"><label className="label">Notes</label><input className="input" value={v.notes} onChange={(e) => set("notes", e.target.value)} /></div>
        </div>

        {v.direction === "out" && (
          <div className="card space-y-3 p-4">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={v.notPurchase} onChange={(e) => set("notPurchase", e.target.checked)} />
              Not a purchase (salary, EMI, tax payment, bank charge)
            </label>
            {gstPurchase && (
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="label">Vendor</label>
                  <select className="input" value={v.vendorId} onChange={(e) => set("vendorId", e.target.value)}>
                    <option value="">Select vendor</option>
                    {vendors.map((x) => <option key={x.id} value={x.id}>{String(x.name)}</option>)}
                  </select>
                </div>
                <div><label className="label">Vendor GSTIN *</label><input className="input" required value={v.vendorGstin} onChange={(e) => set("vendorGstin", e.target.value.toUpperCase())} /></div>
                <div><label className="label">Bill number *</label><input className="input" required value={v.billNo} onChange={(e) => set("billNo", e.target.value)} /></div>
                <div className="grid grid-cols-2 gap-2">
                  <div><label className="label">Taxable value *</label><input className="input" type="number" step="0.01" required value={v.taxableValue} onChange={(e) => set("taxableValue", e.target.value)} /></div>
                  <div><label className="label">Tax amount *</label><input className="input" type="number" step="0.01" required value={v.taxAmount} onChange={(e) => set("taxAmount", e.target.value)} /></div>
                </div>
              </div>
            )}
            <div>
              <label className="label">Bill photo or PDF {isPurchase && <span className="text-danger">*</span>}</label>
              <label className="btn w-full cursor-pointer sm:w-auto">
                <Camera size={15} /> {bill ? bill.name : "Take photo / choose file"}
                <input type="file" accept="image/*,application/pdf" capture="environment" className="hidden" onChange={(e) => setBill(e.target.files?.[0] ?? null)} />
              </label>
            </div>
          </div>
        )}

        {err && <ErrorBox>{err}</ErrorBox>}
        <button className="btn-primary" disabled={busy}>{busy ? "Saving…" : "Save entry"}</button>
      </form>
    </div>
  );
}
