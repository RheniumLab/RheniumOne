"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useDoc } from "@/lib/hooks";
import { APPROVAL_LABELS, DEFAULT_RULES, type ApprovalRule, type CompanySettings } from "@/lib/business";
import { doc, setDoc } from "firebase/firestore";
import { Plus } from "lucide-react";
import { Badge, ErrorBox, NoAccess, PageHeader } from "@/components/ui";
import { useAuth } from "@/lib/auth-context";
import { useCollection } from "@/lib/hooks";
import { api } from "@/lib/api";
import { db } from "@/lib/firebase";
import { MODULES } from "@/lib/modules";
import { ACTIONS, type Role } from "@/lib/permissions";
import { createDoc, updateDoc } from "@/lib/data";

export default function SettingsPage() {
  return <Suspense><Settings /></Suspense>;
}

function Settings() {
  const { isAdmin } = useAuth();
  const params = useSearchParams();
  const [tab, setTab] = useState<"company" | "users" | "roles" | "approvals" | "categories">((params.get("tab") as "company") || "company");
  if (!isAdmin) return <NoAccess />;
  return (
    <div>
      <PageHeader title="Settings" subtitle="Company, users, roles and permissions, approval rules, categories" />
      <div className="mb-4 flex gap-1 border-b border-border">
        {(["company", "users", "roles", "approvals", "categories"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`-mb-px border-b-2 px-3 py-2 text-sm capitalize ${tab === t ? "border-brand font-medium text-brand" : "border-transparent text-muted"}`}>{t}</button>
        ))}
      </div>
      {tab === "company" && <Company />}
      {tab === "approvals" && <ApprovalRules />}
      {tab === "users" && <Users />}
      {tab === "roles" && <Roles />}
      {tab === "categories" && <Categories />}
    </div>
  );
}

function Users() {
  const { rows: users } = useCollection("users");
  const { rows: roles } = useCollection("roles");
  const { user: me } = useAuth();
  const [show, setShow] = useState(false);
  const [v, setV] = useState({ name: "", email: "", phone: "", password: "", roleId: "engineer" });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function patch(uid: string, body: Record<string, unknown>) {
    try {
      await api("/api/users", "PATCH", { uid, ...body });
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="space-y-4">
      <button className="btn-primary" onClick={() => setShow(!show)}><Plus size={15} /> Add team member</button>
      {show && (
        <form
          className="card grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setErr(null);
            try {
              await api("/api/users", "POST", v);
              setShow(false);
              setV({ name: "", email: "", phone: "", password: "", roleId: "engineer" });
            } catch (e) {
              setErr(e instanceof Error ? e.message : String(e));
            }
            setBusy(false);
          }}
        >
          <div><label className="label">Name</label><input className="input" required value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></div>
          <div><label className="label">Email (login)</label><input className="input" type="email" required value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} /></div>
          <div><label className="label">Phone</label><input className="input" type="tel" value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} /></div>
          <div><label className="label">Temporary password (8+)</label><input className="input" required minLength={8} value={v.password} onChange={(e) => setV({ ...v, password: e.target.value })} /></div>
          <div>
            <label className="label">Role</label>
            <select className="input" value={v.roleId} onChange={(e) => setV({ ...v, roleId: e.target.value })}>
              {roles.map((r) => <option key={r.id} value={r.id}>{String(r.name)}</option>)}
            </select>
          </div>
          <div className="self-end"><button className="btn-primary" disabled={busy}>{busy ? "Creating…" : "Create login"}</button></div>
          {err && <div className="sm:col-span-2 lg:col-span-3"><ErrorBox>{err}</ErrorBox></div>}
        </form>
      )}
      <div className="card overflow-x-auto">
        <table className="table">
          <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>{String(u.name)}</td>
                <td>{String(u.email)}</td>
                <td>
                  <select className="input !w-auto !py-1" value={String(u.roleId)} disabled={u.id === me?.uid} onChange={(e) => patch(u.id, { roleId: e.target.value })}>
                    {roles.map((r) => <option key={r.id} value={r.id}>{String(r.name)}</option>)}
                  </select>
                </td>
                <td><Badge>{u.active ? "Active" : "Inactive"}</Badge></td>
                <td className="whitespace-nowrap text-right">
                  {u.id !== me?.uid && <button className="btn !py-1 mr-1" onClick={() => patch(u.id, { active: !u.active })}>{u.active ? "Deactivate" : "Activate"}</button>}
                  <button className="btn !py-1" onClick={() => { const p = prompt("New password (8+ characters)"); if (p) patch(u.id, { password: p }); }}>Reset password</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Roles() {
  const { rows } = useCollection("roles");
  const roles = rows as unknown as Role[];
  const [sel, setSel] = useState<string>("");
  const role = roles.find((r) => r.id === sel) ?? roles.find((r) => !r.isAdmin);

  async function toggle(module: string, action: string) {
    if (!role) return;
    const perms = structuredClone(role.perms ?? {}) as Record<string, Record<string, boolean>>;
    perms[module] = { ...(perms[module] ?? {}), [action]: !perms[module]?.[action] };
    await updateDoc("roles", role.id, { perms }, role as unknown as Record<string, unknown>);
  }

  async function addRole() {
    const name = prompt("Role name (e.g. Sales)")?.trim();
    if (!name) return;
    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    await setDoc(doc(db(), "roles", id), { name, nonGst: false, perms: {} });
    setSel(id);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {roles.map((r) => (
          <button key={r.id} className={r.id === role?.id ? "btn-primary" : "btn"} onClick={() => setSel(r.id)} disabled={r.isAdmin}>
            {r.name}{r.isAdmin ? " (all access)" : ""}
          </button>
        ))}
        <button className="btn" onClick={addRole}><Plus size={14} /> New role</button>
      </div>
      {role && !role.isAdmin && (
        <div className="card overflow-x-auto">
          <div className="flex items-center justify-between border-b border-border p-3">
            <span className="text-sm font-semibold">{role.name}</span>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={Boolean(role.nonGst)} onChange={() => updateDoc("roles", role.id, { nonGst: !role.nonGst }, role as unknown as Record<string, unknown>)} />
              Can see non-GST data
            </label>
          </div>
          <table className="table">
            <thead><tr><th>Module</th>{ACTIONS.map((a) => <th key={a} className="text-center capitalize">{a}</th>)}</tr></thead>
            <tbody>
              {MODULES.map((m) => (
                <tr key={m.key}>
                  <td>{m.no}. {m.name}</td>
                  {ACTIONS.map((a) => (
                    <td key={a} className="text-center">
                      <input type="checkbox" checked={Boolean(role.perms?.[m.key]?.[a])} onChange={() => toggle(m.key, a)} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Categories() {
  const { rows } = useCollection("categories");
  const types = [
    { key: "company", label: "Company expense heads" },
    { key: "project", label: "Project expense heads" },
    { key: "income", label: "Income heads" },
  ];
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {types.map((t) => (
        <div key={t.key} className="card">
          <div className="flex items-center justify-between border-b border-border p-3">
            <span className="text-sm font-semibold">{t.label}</span>
            <button className="btn !py-1" onClick={() => { const n = prompt("Category name")?.trim(); if (n) createDoc("categories", { type: t.key, name: n, active: true }); }}><Plus size={13} /></button>
          </div>
          <ul className="divide-y divide-border text-sm">
            {rows.filter((r) => r.type === t.key).sort((a, b) => String(a.name).localeCompare(String(b.name))).map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-2 px-3 py-1.5">
                <span className={r.active === false ? "text-muted line-through" : ""}>{String(r.name)}</span>
                <span className="flex gap-2 text-xs">
                  <button className="text-muted hover:text-brand" onClick={() => { const n = prompt("Rename", String(r.name))?.trim(); if (n) updateDoc("categories", r.id, { name: n }, r); }}>Rename</button>
                  <button className="text-muted hover:text-brand" onClick={() => updateDoc("categories", r.id, { active: r.active === false }, r)}>{r.active === false ? "Activate" : "Deactivate"}</button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function Company() {
  const { data, loading } = useDoc("settings", "company");
  const google = useDoc("settings", "google");
  const params = useSearchParams();
  const [v, setV] = useState<CompanySettings>({});
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (data) setV(data as CompanySettings); }, [data]);
  if (loading) return null;
  const f = (k: keyof CompanySettings, label: string, type = "text", wide = false) => (
    <div className={wide ? "sm:col-span-2" : ""}>
      <label className="label">{label}</label>
      {type === "textarea"
        ? <textarea className="input min-h-20" value={String(v[k] ?? "")} onChange={(e) => { setV({ ...v, [k]: e.target.value }); setSaved(false); }} />
        : <input className="input" type={type} value={String(v[k] ?? "")} onChange={(e) => { setV({ ...v, [k]: type === "number" ? Number(e.target.value) : e.target.value }); setSaved(false); }} />}
    </div>
  );
  const status = params.get("google");
  return (
    <div className="space-y-4">
      <div className="card space-y-2 p-4">
        <h2 className="text-sm font-semibold">Google Drive (PDFs and photos)</h2>
        {google.data?.connected
          ? <p className="text-sm">Connected to <b>{String(google.data.email ?? "Google")}</b>. Files are stored in the <b>RheniumOne</b> folder of that account’s My Drive.</p>
          : <p className="text-sm text-muted">Not connected. Connect the company Google account; the app can only see files it creates.</p>}
        {status && <p className={`text-sm ${status === "connected" ? "text-ok" : "text-danger"}`}>{status === "connected" ? "Google Drive connected." : `Google: ${status}`}</p>}
        <button className="btn" disabled={busy} onClick={async () => {
          setBusy(true);
          try { const r = await api<{ url: string }>("/api/google/connect", "POST"); window.location.href = r.url; } catch (e) { alert(e instanceof Error ? e.message : String(e)); setBusy(false); }
        }}>{google.data?.connected ? "Reconnect Google account" : "Connect Google Drive"}</button>
      </div>
      <form className="card grid gap-3 p-4 sm:grid-cols-2" onSubmit={async (e) => { e.preventDefault(); await setDoc(doc(db(), "settings", "company"), v, { merge: true }); setSaved(true); }}>
        <h2 className="text-sm font-semibold sm:col-span-2">Company details (shown on invoices, quotations, POs)</h2>
        {f("name", "Company name")}
        {f("state", "State (for CGST/SGST vs IGST)")}
        {f("address", "Address", "textarea", true)}
        {f("gstin", "GSTIN")}
        {f("pan", "PAN")}
        {f("phone", "Phone")}
        {f("email", "Email")}
        {f("bankName", "Bank name")}
        {f("bankAccount", "Bank account no.")}
        {f("ifsc", "IFSC")}
        {f("upi", "UPI ID")}
        {f("gstInvoicePrefix", "GST invoice prefix (RN → RN/26-27/0001)")}
        {f("nonGstInvoicePrefix", "Non-GST bill prefix (RN/NG)")}
        {f("defaultGstRate", "Default GST rate %", "number")}
        {f("monthlyReviewDay", "Monthly review meeting day (1–28)", "number")}
        {f("brandColor", "Brand colour (e.g. #1f5fbf)")}
        {f("invoiceTerms", "Default invoice terms", "textarea", true)}
        {f("quotationTerms", "Default quotation terms", "textarea", true)}
        <div><button className="btn-primary">{saved ? "Saved" : "Save company details"}</button></div>
      </form>
    </div>
  );
}

function ApprovalRules() {
  const { data } = useDoc("settings", "approvals");
  const { rows: roles } = useCollection("roles");
  const [rules, setRules] = useState<ApprovalRule[]>(DEFAULT_RULES);
  const [saved, setSaved] = useState(false);
  useEffect(() => { if (data?.rules) setRules(data.rules as ApprovalRule[]); }, [data]);
  const set = (i: number, p: Partial<ApprovalRule>) => { setRules(rules.map((r, j) => (j === i ? { ...r, ...p } : r))); setSaved(false); };
  return (
    <div className="card overflow-x-auto p-4">
      <p className="mb-3 text-sm text-muted">Which document needs approval, above what amount, and by which role. Approvers see requests under Approvals. Admin actions don’t need approval.</p>
      <table className="table">
        <thead><tr><th>On</th><th>Rule</th><th className="w-36">Above</th><th className="w-44">Approved by</th></tr></thead>
        <tbody>
          {rules.map((r, i) => (
            <tr key={r.type}>
              <td><input type="checkbox" checked={r.enabled} onChange={(e) => set(i, { enabled: e.target.checked })} /></td>
              <td>{APPROVAL_LABELS[r.type]}</td>
              <td>{["po", "claim", "quotationDiscount"].includes(r.type) ? <input className="input !py-1" type="number" value={r.threshold} onChange={(e) => set(i, { threshold: Number(e.target.value) })} /> : <span className="text-muted">always</span>}</td>
              <td><select className="input !py-1" value={r.role} onChange={(e) => set(i, { role: e.target.value })}>{roles.map((x) => <option key={x.id} value={x.id}>{String(x.name)}</option>)}</select></td>
            </tr>
          ))}
        </tbody>
      </table>
      <button className="btn-primary mt-3" onClick={async () => { await setDoc(doc(db(), "settings", "approvals"), { rules }); setSaved(true); }}>{saved ? "Saved" : "Save rules"}</button>
    </div>
  );
}
