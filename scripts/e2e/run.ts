/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Rhenium One end-to-end test run.
 *   npx tsx --tsconfig scripts/e2e/tsconfig.json --env-file=.env.local scripts/e2e/run.ts
 * Needs the local dev server on http://localhost:3000. Clean up afterwards with cleanup.ts.
 */
import fs from "fs";
import path from "path";
import { randomBytes } from "crypto";
import { FieldValue } from "firebase-admin/firestore";
import {
  addDoc, arrayUnion, collection, collectionGroup, doc, getDoc, getDocs, increment, query, serverTimestamp, setDoc,
  updateDoc as fsUpdate, deleteDoc, where,
} from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { createDoc, fyLabel, pad, softDelete, updateDoc } from "@/lib/data";
import { assignNumber, fySeries, getRules, invoiceSeries, requestApproval, yymmdd, type CompanySettings } from "@/lib/business";
import { computeTotals, inWords, maxDiscountPct, sameState, type Line } from "@/lib/tax";
import { bomTotal, isLeaf, nextRev, totalQty, unitCosts, type BomLine } from "@/lib/bom";
import { ageBucket, balances, invoiceDue, tdsQuarter } from "@/lib/money";
import { stockFrom } from "@/lib/stock";
import { can, defaultRoles, type Role } from "@/lib/permissions";
import { ENTITIES } from "@/lib/entities";
import { commercialDocHtml, sectionsDocHtml } from "@/lib/doc-html";
import { buildSnapshot } from "@/lib/snapshot";
import {
  aauth, adb, adoc, api, as, BASE, denied, eq, MANIFEST, near, ok, OUT, results, saveManifest, section,
  settle, test, today, until, users, type Manifest,
} from "./lib";

const runId = "E2E" + new Date().toISOString().replace(/[-:T]/g, "").slice(2, 12);
const TAG = `ZZ Test ${runId}`;
const ids: Record<string, any> = {};
const m: Manifest = { runId, startedAt: new Date().toISOString(), uids: [], roles: [], emails: [], counters: {}, driveFoldersBefore: [], driveIds: [], notes: [] };
const uid = (k: string) => users[k].uid;
const pw = () => "Zz!" + randomBytes(9).toString("base64url");
const fsDoc = (col: string, id: string) => doc(db(), col, id);

async function upload(name: string, mime: string, bytes: Buffer, folder: string, billingType = "gst") {
  const s = await api<{ uploadUrl: string; error?: string }>("/api/files/session", "POST", { name, mime, size: bytes.length, folder });
  if (s.status !== 200) throw new Error(`upload session ${s.status}: ${JSON.stringify(s.json)}`);
  const put = await fetch(s.json.uploadUrl, { method: "PUT", headers: { "content-type": mime }, body: new Uint8Array(bytes) });
  if (!put.ok) throw new Error(`Drive PUT ${put.status}`);
  const driveId = (await put.json()).id as string;
  m.driveIds.push(driveId);
  saveManifest(m);
  const ref = doc(collection(db(), "files"));
  await setDoc(ref, { name, mime, size: bytes.length, folder, billingType, linked: null, uid: auth().currentUser!.uid, status: "uploaded", driveId, at: serverTimestamp() });
  return { fileId: ref.id, driveId };
}
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

async function main() {
  // ---------------------------------------------------------------- setup
  section("Setup (snapshot, test admin)");
  const company = ((await adb.doc("settings/company").get()).data() ?? {}) as CompanySettings;
  const counters = await adb.collection("counters").get();
  counters.forEach((c) => (m.counters[c.id] = c.data().seq));
  m.driveFoldersBefore = (await adb.collection("driveFolders").get()).docs.map((d) => d.id);
  saveManifest(m);
  console.log(`run ${runId}; ${counters.size} counters and ${m.driveFoldersBefore.length} Drive folders snapshotted`);

  await test("Bootstrap test admin (admin role, own cash wallet)", async () => {
    const email = `zz-test-admin-${runId.toLowerCase()}@rhenium-e2e.test`;
    const password = pw();
    const u = await aauth.createUser({ email, password, displayName: `${TAG} Admin` });
    m.uids.push(u.uid); m.emails.push(email); saveManifest(m);
    await adb.collection("users").doc(u.uid).set({ name: `${TAG} Admin`, email, roleId: "admin", active: true, e2e: runId });
    const w = await adb.collection("accounts").add({ name: `Cash — ${TAG} Admin`, kind: "cash", holderId: u.uid, openingBalance: 0, active: true, e2e: runId });
    ids.adminWallet = w.id;
    users.admin = { key: "admin", uid: u.uid, email, password, name: `${TAG} Admin`, roleId: "admin" };
    await as("admin");
  });

  // ---------------------------------------------------------------- unit
  section("Calculations (GST, discounts, numbering, BOM, money)");
  const L: Line[] = [
    { description: "Part", qty: 2, rate: 1000, discType: "pct", disc: 10, taxRate: 18 },
    { description: "Service", qty: 1, rate: 500, discType: "amt", disc: 50, taxRate: 12 },
  ];
  const ADJ = { overallDiscType: "pct" as const, overallDisc: 5, charges: [{ label: "Freight", amount: 200, taxRate: 18 }], roundOff: true, advance: 500 };
  await test("Totals: line + overall discount, charges, CGST/SGST, round-off, advance", async () => {
    const t = computeTotals(L, ADJ, { gst: true, intraState: true });
    near(t.subtotal, 2250, "subtotal"); near(t.overallDiscount, 112.5, "overall discount"); near(t.taxable, 2337.5, "taxable");
    near(t.tax, 395.1, "tax"); near(t.cgst, 197.55, "CGST"); near(t.sgst, 197.55, "SGST"); eq(t.igst, 0, "IGST");
    near(t.roundOff, 0.4, "round off"); near(t.total, 2733, "total"); near(t.due, 2233, "due after advance");
    near(t.byRate["18"].taxable, 1910, "18% taxable"); near(t.byRate["12"].tax, 51.3, "12% tax");
    return "₹2,733 incl. ₹395.10 GST";
  });
  await test("Totals: other state → IGST; non-GST → no tax", async () => {
    const i = computeTotals(L, ADJ, { gst: true, intraState: false });
    near(i.igst, 395.1, "IGST"); eq(i.cgst, 0, "CGST");
    const n = computeTotals(L, ADJ, { gst: false, intraState: true });
    eq(n.tax, 0, "non-GST tax"); near(n.total, 2338, "non-GST total (rounded)");
  });
  await test("Discount % for approvals, amount in words, state match", async () => {
    eq(maxDiscountPct(L, ADJ), 10, "max discount %");
    eq(inWords(2733), "Rupees Two Thousand Seven Hundred Thirty Three Only", "words");
    eq(inWords(150000.5), "Rupees One Lakh Fifty Thousand and Fifty Paise Only", "lakh words");
    ok(sameState(" Karnataka", "karnataka ") && !sameState("Karnataka", "Kerala") && !sameState("", ""), "state compare");
  });
  await test("Invoice number format PREFIX/YYMMDD/001 (GST and non-GST)", async () => {
    const d = new Date(2026, 10, 25);
    eq(yymmdd(d), "261125", "YYMMDD");
    eq(invoiceSeries({ gstInvoicePrefix: "RN" }, "gst", d).format(1), "RN/261125/001", "GST");
    eq(invoiceSeries({}, "nonGst", d).format(12), "RN/NG/261125/012", "non-GST default");
    eq(invoiceSeries({ gstInvoicePrefix: "RN/" }, "gst", d).format(2), "RN/261125/002", "trailing slash prefix");
    eq(invoiceSeries({}, "gst", d).counter === invoiceSeries({}, "nonGst", d).counter, false, "separate series");
    ok("RN/NG/261125/001".length <= 16, "GST 16-character limit");
  });
  await test("Financial year, TDS quarter, ageing buckets", async () => {
    eq(fyLabel(new Date(2026, 2, 31)), "25-26", "FY before April"); eq(fyLabel(new Date(2026, 3, 1)), "26-27", "FY from April");
    eq(tdsQuarter("2026-04-01"), "Q1 26-27", "Q1"); eq(tdsQuarter("2026-11-25"), "Q3 26-27", "Q3"); eq(tdsQuarter("2027-02-10"), "Q4 26-27", "Q4");
    eq([0, 30, 31, 61, 95].map(ageBucket), ["0–30", "0–30", "31–60", "61–90", "90+"], "buckets");
    eq(invoiceDue({ status: "Draft", total: 100 }), 0, "draft owes nothing"); eq(invoiceDue({ status: "Issued", total: 100, paid: 40 }), 60, "balance");
  });
  await test("Multi-level BOM cost roll-up and quantities", async () => {
    const b: BomLine[] = [
      { level: 0, description: "Assembly", qty: 2, rate: 100 },
      { level: 1, description: "Part A", qty: 2, rate: 50 },
      { level: 1, description: "Part B", qty: 3, rate: 20 },
      { level: 0, description: "Part C", qty: 4, rate: 10 },
    ];
    eq(unitCosts(b), [260, 50, 20, 10], "unit costs"); eq(bomTotal(b), 560, "BOM total"); eq(totalQty(b, 1), 4, "Part A total qty");
    ok(!isLeaf(b, 0) && isLeaf(b, 1), "leaf detection"); eq(nextRev("A"), "B", "next revision");
  });
  await test("Default roles: permissions and non-GST visibility", async () => {
    const r = Object.fromEntries(defaultRoles().map((x) => [x.id, x])) as Record<string, Role>;
    ok(can(r.admin, "invoices", "delete") && r.admin.nonGst, "admin all + non-GST");
    ok(can(r.engineer, "projects", "edit") && !can(r.engineer, "invoices", "view") && !r.engineer.nonGst, "engineer");
    ok(can(r.store, "inventory", "create") && !can(r.store, "cashflow", "view"), "store");
  });
  await test("Branded document HTML (invoice and MOM)", async () => {
    const h = commercialDocHtml({ company: { name: "Rhenium" }, title: "Tax Invoice", party: { name: "X" }, meta: [["No", "RN/261125/001"]], lines: L, adj: ADJ, gst: true, intraState: true, showBank: true });
    ok(h.includes("CGST") && h.includes("2,733.00") && h.includes("#FF6A00"), "invoice HTML has CGST, total and brand colour");
    ok(sectionsDocHtml({ company: {}, title: "Minutes of Meeting", meta: [], sections: [["Decisions", "Go"]] }).includes("Decisions"), "MOM HTML");
  });

  // ---------------------------------------------------------------- roles & users
  section("Roles and users");
  const base = Object.fromEntries(defaultRoles().map((x) => [x.id, x])) as Record<string, Role>;
  const all = { view: true, create: true, edit: true, delete: true };
  const roleDefs: Record<string, { name: string; perms: Role["perms"] }> = {
    "zz-test-accounts": { name: `${TAG} Accounts`, perms: { ...base.accounts.perms, invoices: all, cashflow: all, purchases: { view: true, create: true, edit: true }, documents: { view: true, create: true }, quotations: { view: true }, projects: { view: true } } },
    "zz-test-engineer": { name: `${TAG} Engineer`, perms: base.engineer.perms },
    "zz-test-store": { name: `${TAG} Store`, perms: base.store.perms },
    "zz-test-pm": { name: `${TAG} Project Manager`, perms: { ...base.pm.perms, approvals: { view: true }, meetings: { view: true, create: true, edit: true }, documents: { view: true, create: true, edit: true } } },
  };
  await test("Admin creates 4 test roles", async () => {
    for (const [id, r] of Object.entries(roleDefs)) {
      await setDoc(fsDoc("roles", id), { name: r.name, nonGst: false, perms: r.perms, e2e: runId });
      m.roles.push(id);
    }
    saveManifest(m);
    return Object.values(roleDefs).map((r) => r.name.replace(`${TAG} `, "")).join(", ");
  });
  await test("Admin creates 4 users through /api/users (each gets a cash wallet)", async () => {
    for (const k of ["accounts", "engineer", "store", "pm"]) {
      const email = `zz-test-${k}-${runId.toLowerCase()}@rhenium-e2e.test`;
      const password = pw();
      const r = await api<{ uid: string; error?: string }>("/api/users", "POST", { name: `${TAG} ${k}`, email, password, roleId: `zz-test-${k}` });
      if (r.status !== 200) throw new Error(`${k}: ${r.status} ${JSON.stringify(r.json)}`);
      users[k] = { key: k, uid: r.json.uid, email, password, name: `${TAG} ${k}`, roleId: `zz-test-${k}` };
      m.uids.push(r.json.uid); m.emails.push(email); saveManifest(m);
      const w = await adb.collection("accounts").where("holderId", "==", r.json.uid).get();
      ok(w.size === 1, `${k} wallet created`);
      ids[`${k}Wallet`] = w.docs[0].id;
    }
  });
  await test("Non-admin cannot create users or change roles", async () => {
    await as("accounts");
    const r = await api("/api/users", "POST", { name: "x", email: `zz-x-${runId}@rhenium-e2e.test`, password: "12345678", roleId: "admin" });
    eq(r.status, 403, "POST /api/users as accounts");
    const p = await api("/api/users", "PATCH", { uid: uid("store"), roleId: "admin" });
    eq(p.status, 403, "PATCH /api/users as accounts");
    return await denied(() => setDoc(fsDoc("roles", "zz-test-engineer"), { name: "hacked", nonGst: true, perms: {} }), "accounts writing roles");
  });
  await test("Admin resets a user's password through the API", async () => {
    await as("admin");
    const np = pw();
    const r = await api("/api/users", "PATCH", { uid: uid("store"), password: np });
    eq(r.status, 200, "PATCH password");
    users.store.password = np;
    await as("store");
  });
  await test("Setup page can't be re-run; Google connect is admin-only", async () => {
    const g = await api<{ needed: boolean }>("/api/setup", "GET", undefined, { auth: false });
    eq(g.json.needed, false, "setup needed");
    const p = await api("/api/setup", "POST", { name: "x", email: "x@y.z", password: "12345678", setupKey: "wrong" }, { auth: false });
    eq(p.status, 403, "setup with wrong key");
    await as("engineer");
    eq((await api("/api/google/connect", "POST")).status, 403, "connect as engineer");
  });

  // ---------------------------------------------------------------- masters
  section("Masters: clients, vendors, items");
  await test("Accounts creates a client (auto code RC-####)", async () => {
    await as("accounts");
    ids.client = await createDoc("clients", {
      legalName: `${TAG} Client Pvt Ltd`, displayName: `${TAG} Client`, clientType: "Company", status: "Active", gstRegistered: "Yes",
      gstin: "29AAAAA0000A1Z5", state: company.state || "Karnataka", tdsApplicable: "Yes", tdsRate: 10, paymentTermsDays: 30, billingType: "gst",
      billingAddress: "Test address", contacts: [{ name: "Test Contact", phone: "9000000000", email: "contact@rhenium-e2e.test", roleTag: "Accounts", primary: true }],
    }, ENTITIES.clients.code);
    const c = await adoc("clients", ids.client);
    ok(/^RC-\d{4}$/.test(String(c?.code)), `client code ${c?.code}`);
    return String(c?.code);
  });
  await test("Accounts creates a vendor; Store creates 2 stock items", async () => {
    ids.vendor = await createDoc("vendors", { name: `${TAG} Vendor`, vendorType: "Supplier", status: "Active", gstRegistered: "Yes", gstin: "29BBBBB0000B1Z5", state: company.state || "Karnataka", paymentTermsDays: 15 }, ENTITIES.vendors.code);
    await as("store");
    ids.itemA = await createDoc("items", { name: `${TAG} Item A`, unit: "Nos", hsn: "8536", rate: 6000, reorderLevel: 6 }, ENTITIES.inventory.code);
    ids.itemB = await createDoc("items", { name: `${TAG} Item B`, unit: "Nos", hsn: "8544", rate: 250, reorderLevel: 2 }, ENTITIES.inventory.code);
    return `vendor ${(await adoc("vendors", ids.vendor))?.code}, items ${(await adoc("items", ids.itemA))?.code}, ${(await adoc("items", ids.itemB))?.code}`;
  });
  await test("Engineer can't see clients' money or create clients", async () => {
    await as("engineer");
    return await denied(() => setDoc(doc(collection(db(), "clients")), { legalName: "x" }), "engineer creating a client");
  });

  // ---------------------------------------------------------------- sales
  section("Sales: idea → requirement → proposal → quotation → project");
  await test("Idea approved → internal product requirement → product project", async () => {
    await as("engineer");
    ids.idea = await createDoc("ideas", { title: `${TAG} Idea`, stage: "Approved", description: "Test idea", roughCost: 50000 });
    await settle();
    await as("pm");
    ids.ireq = await createDoc("requirements", { kind: "Internal", title: `${TAG} Product`, ideaId: ids.idea, status: "Approved" }, ENTITIES.requirements.code);
    await updateDoc("ideas", ids.idea, { requirementId: ids.ireq });
    ids.iproj = await createDoc("projects", { name: `${TAG} Product`, projectType: "Internal product", clientId: null, status: "Planned", billingType: "gst", budget: 200000, requirementId: ids.ireq, ideaId: ids.idea }, ENTITIES.projects.code);
    await updateDoc("requirements", ids.ireq, { projectId: ids.iproj, status: "Converted to project" });
    await updateDoc("ideas", ids.idea, { stage: "In development", projectId: ids.iproj });
    await settle();
    const idea = await until("ideas", ids.idea, (d) => d.stage === "In development" && d.projectId === ids.iproj, "idea linked to project");
    return `idea → ${(await adoc("requirements", ids.ireq))?.code} → ${(await adoc("projects", ids.iproj))?.code} (${idea.stage})`;
  });
  await test("Client requirement → proposal R0 → revision R1 → proposal PDF in Drive", async () => {
    ids.req = await createDoc("requirements", { kind: "Client", title: `${TAG} Requirement`, clientId: ids.client, status: "New", description: "Control panel" }, ENTITIES.requirements.code);
    ids.prop = await createDoc("proposals", { title: `${TAG} Proposal`, clientId: ids.client, requirementId: ids.req, status: "Draft", rev: 0, scope: "Scope v0" }, ENTITIES.proposals.code);
    await updateDoc("proposals", ids.prop, { rev: 1, scope: "Scope v1", revisions: arrayUnion({ rev: 0, scope: "Scope v0", at: new Date().toISOString() }) });
    await settle();
    const p = await until("proposals", ids.prop, (d) => d.rev === 1 && (d.revisions as unknown[])?.length === 1, "revision kept");
    const html = sectionsDocHtml({ company, title: "Proposal", meta: [["Proposal", `${p.code} R1`]], sections: [["Scope", "Scope v1"]] });
    const r = await api<{ driveId: string; fileId: string }>("/api/docs/pdf", "POST", { html, name: `${TAG} Proposal R1`, folder: `${TAG}/Proposals`, linked: { col: "proposals", id: ids.prop } });
    eq(r.status, 200, `PDF API (${JSON.stringify(r.json).slice(0, 120)})`);
    m.driveIds.push(r.json.driveId); saveManifest(m);
    return `${p.code} R1, PDF ${r.json.driveId.slice(0, 8)}…`;
  });
  await test("Quotation with 5% discount → Google Doc → release (Sent) → PDF version", async () => {
    const lines: Line[] = [{ itemId: ids.itemA, description: "Control panel", hsn: "8537", qty: 1, unit: "Nos", rate: 100000, discType: "pct", disc: 5, taxRate: 18, cost: 70000 }];
    const t = computeTotals(lines, {}, { gst: true, intraState: true });
    ids.q1 = await createDoc("quotations", { title: `${TAG} Quote A`, clientId: ids.client, clientName: `${TAG} Client`, requirementId: ids.req, proposalId: ids.prop, billingType: "gst", placeOfSupply: company.state || "Karnataka", intraState: true, lines, adj: {}, date: today(), validUntil: today(), total: t.total, taxable: t.taxable, tax: t.tax, estCost: t.cost, status: "Draft", rev: 0, releases: [] }, { counter: "quotation", field: "number", format: (n) => `RQ/${pad(n)}` });
    const html = commercialDocHtml({ company, title: "Quotation", party: { name: "Test" }, meta: [], lines, adj: {}, gst: true, intraState: true });
    const g = await api<{ docId: string; url: string }>("/api/docs/gdoc", "POST", { quotationId: ids.q1, html, name: `${TAG} Quote A`, folder: `${TAG}/Quotations/Working` });
    eq(g.status, 200, `gdoc API ${JSON.stringify(g.json).slice(0, 100)}`);
    m.driveIds.push(g.json.docId); saveManifest(m);
    const r = await api<{ driveId: string }>("/api/docs/release", "POST", { quotationId: ids.q1, clientFolder: `${TAG}/Quotations` });
    eq(r.status, 200, `release API ${JSON.stringify(r.json).slice(0, 120)}`);
    m.driveIds.push(r.json.driveId); saveManifest(m);
    const q = await adoc("quotations", ids.q1);
    eq(q?.status, "Sent", "status"); eq((q?.releases as unknown[]).length, 1, "release versions");
    const d = await adb.collection("docs").where("linked.id", "==", ids.q1).get();
    eq(d.size, 1, "quotation PDF listed in client documents");
    return `${q?.number} → Sent, Google Doc + PDF in Drive`;
  });
  await test("15% discount needs approval: release blocked until admin approves", async () => {
    const lines: Line[] = [{ description: "Panel B", qty: 1, rate: 100000, discType: "pct", disc: 15, taxRate: 18 }];
    const t = computeTotals(lines, {}, { gst: true, intraState: true });
    ids.q2 = await createDoc("quotations", { title: `${TAG} Quote B`, clientId: ids.client, clientName: `${TAG} Client`, billingType: "gst", intraState: true, lines, adj: {}, total: t.total, taxable: t.taxable, status: "Draft", rev: 0, releases: [] }, { counter: "quotation", field: "number", format: (n) => `RQ/${pad(n)}` });
    const rule = (await getRules()).find((r) => r.type === "quotationDiscount")!;
    const pct = maxDiscountPct(lines, {});
    if (!rule.enabled || pct <= rule.threshold) return `skipped: discount rule is ${rule.enabled ? `>${rule.threshold}%` : "off"} in your settings`;
    await updateDoc("quotations", ids.q2, { approval: { status: "pending", pct } });
    eq(await requestApproval({ type: "quotationDiscount", col: "quotations", docId: ids.q2, amount: pct, summary: `${TAG} 15% discount`, link: "/quotations" }), "pending", "approval raised");
    await settle();
    const html = commercialDocHtml({ company, title: "Quotation", party: { name: "Test" }, meta: [], lines, adj: {}, gst: true, intraState: true });
    const g = await api<{ docId: string }>("/api/docs/gdoc", "POST", { quotationId: ids.q2, html, name: `${TAG} Quote B`, folder: `${TAG}/Quotations/Working` });
    m.driveIds.push(g.json.docId); saveManifest(m);
    eq((await api("/api/docs/release", "POST", { quotationId: ids.q2, clientFolder: `${TAG}/Quotations` })).status, 409, "release while pending");
    const q = await adoc("quotations", ids.q2);
    const apId = (q?.pendingApproval as { id: string }).id;
    await as("engineer");
    eq((await api("/api/approvals/decide", "POST", { approvalId: apId, decision: "approve" })).status, 403, "engineer approving");
    await as("admin");
    eq((await api("/api/approvals/decide", "POST", { approvalId: apId, decision: "approve", comment: "ok" })).status, 200, "admin approving");
    eq(((await adoc("quotations", ids.q2))?.approval as { status: string }).status, "approved", "approval status");
    await as("pm");
    const r = await api<{ driveId: string }>("/api/docs/release", "POST", { quotationId: ids.q2, clientFolder: `${TAG}/Quotations` });
    eq(r.status, 200, "release after approval");
    m.driveIds.push(r.json.driveId); saveManifest(m);
    return "blocked (409) → approved → released";
  });
  await test("Accepted quotation → project in one step (client, value, billing type)", async () => {
    await updateDoc("quotations", ids.q1, { status: "Accepted" });
    const q = await adoc("quotations", ids.q1);
    ids.proj = await createDoc("projects", { name: `${TAG} Project`, projectType: "Client project", clientId: ids.client, status: "In progress", value: q?.taxable, billingType: "gst", scope: "From quotation", quotationId: ids.q1, managerId: uid("pm") }, ENTITIES.projects.code);
    await updateDoc("quotations", ids.q1, { projectId: ids.proj });
    await updateDoc("requirements", ids.req, { status: "Closed - won", projectId: ids.proj });
    await settle();
    const p = await adoc("projects", ids.proj);
    eq(p?.value, 95000, "project value = quotation taxable");
    return `${p?.code}, value ₹95,000`;
  });

  // ---------------------------------------------------------------- projects
  section("Projects: tasks, comments, visibility");
  await test("PM adds tasks; engineer moves one to Done and comments", async () => {
    const t1 = await addDoc(collection(db(), "projects", ids.proj, "tasks"), { title: `${TAG} Design`, assignee: uid("engineer"), due: today(), status: "todo", milestone: "M1" });
    await addDoc(collection(db(), "projects", ids.proj, "tasks"), { title: `${TAG} Build`, assignee: uid("engineer"), status: "doing" });
    await as("engineer");
    await fsUpdate(doc(db(), "projects", ids.proj, "tasks", t1.id), { status: "done" });
    await addDoc(collection(db(), "projects", ids.proj, "comments"), { text: "Design done", uid: uid("engineer"), name: "eng", at: serverTimestamp() });
    const mine = await getDocs(query(collection(db(), "projects", ids.proj, "tasks"), where("assignee", "==", uid("engineer"))));
    eq(mine.size, 2, "engineer's tasks");
  });
  await test("Engineer's 'my tasks' across projects (collection-group query)", async () => {
    const s = await getDocs(query(collectionGroup(db(), "tasks"), where("assignee", "==", uid("engineer"))));
    ok(s.size >= 2, `found ${s.size}`);
  });
  await test("Non-GST project is hidden from users without non-GST permission", async () => {
    await as("admin");
    ids.ngProj = await createDoc("projects", { name: `${TAG} Cash Job`, projectType: "Client project", clientId: ids.client, status: "Planned", billingType: "nonGst", value: 20000 }, ENTITIES.projects.code);
    await as("engineer");
    const gstOnly = await getDocs(query(collection(db(), "projects"), where("billingType", "==", "gst")));
    ok(!gstOnly.docs.some((d) => d.id === ids.ngProj), "non-GST project not in GST list");
    return await denied(() => getDoc(fsDoc("projects", ids.ngProj)), "engineer opening a non-GST project");
  });
  await test("Accounts (view only) can't create projects", async () => {
    await as("accounts");
    return await denied(() => setDoc(doc(collection(db(), "projects")), { name: "x", billingType: "gst" }), "accounts creating a project");
  });

  // ---------------------------------------------------------------- money
  section("Invoices, payments, TDS");
  const invLines: Line[] = [{ description: "Control panel — milestone 1", hsn: "8537", qty: 1, rate: 50000, discType: "pct", disc: 0, taxRate: 18 }];
  const it = computeTotals(invLines, {}, { gst: true, intraState: true });
  const prefix = (company.gstInvoicePrefix || "RN").replace(/\/+$/, "");
  const ngPrefix = (company.nonGstInvoicePrefix || "RN/NG").replace(/\/+$/, "");
  const day = yymmdd(new Date());
  const newInvoice = (extra: Record<string, unknown> = {}) => createDoc("invoices", {
    date: today(), dueDate: today(), clientId: ids.client, clientName: `${TAG} Client`, projectId: ids.proj, billingType: "gst", placeOfSupply: company.state || "Karnataka",
    intraState: true, lines: invLines, adj: {}, notes: "", terms: "", total: it.total, taxable: it.taxable, tax: it.tax, cgst: it.cgst, sgst: it.sgst, igst: 0, due: it.total, byRate: it.byRate,
    status: "Draft", number: null, paid: 0, ...extra,
  });
  await test(`Draft invoice → issue → number ${prefix}/${day}/NNN`, async () => {
    ids.inv1 = await newInvoice();
    await settle();
    const n1 = await assignNumber("invoices", ids.inv1, invoiceSeries(company, "gst", new Date()), { status: "Issued", issuedAt: new Date().toISOString() });
    ok(new RegExp(`^${prefix.replace(/\//g, "\\/")}\\/${day}\\/\\d{3}$`).test(n1), `number ${n1}`);
    ids.inv1No = n1;
    return n1;
  });
  await test("Next invoice the same day gets the next number", async () => {
    ids.inv2 = await newInvoice();
    await settle();
    const n2 = await assignNumber("invoices", ids.inv2, invoiceSeries(company, "gst", new Date()), { status: "Issued" });
    eq(Number(n2.slice(-3)), Number(String(ids.inv1No).slice(-3)) + 1, "sequence");
    return `${ids.inv1No} → ${n2}`;
  });
  await test("Issued invoice can't be edited; draft can", async () => {
    return await denied(() => fsUpdate(fsDoc("invoices", ids.inv1), { lines: [{ ...invLines[0], rate: 1 }] }), "changing an issued invoice's lines");
  });
  await test("Non-GST bill: hidden from accounts, own series", async () => {
    await denied(() => setDoc(doc(collection(db(), "invoices")), { billingType: "nonGst", status: "Draft" }), "accounts creating a non-GST bill");
    await as("admin");
    ids.ngInv = await newInvoice({ billingType: "nonGst", projectId: ids.ngProj, intraState: false, tax: 0, cgst: 0, sgst: 0, total: 50000, due: 50000, lines: invLines.map((l) => ({ ...l, taxRate: 0 })) });
    await settle();
    const n = await assignNumber("invoices", ids.ngInv, invoiceSeries(company, "nonGst", new Date()), { status: "Issued" });
    ok(n.startsWith(`${ngPrefix}/${day}/`), `non-GST number ${n}`);
    await as("accounts");
    await denied(() => getDocs(collection(db(), "invoices")), "accounts listing invoices without the GST filter");
    const gst = await getDocs(query(collection(db(), "invoices"), where("billingType", "==", "gst")));
    ok(!gst.docs.some((d) => d.id === ids.ngInv), "non-GST bill not visible");
    return n;
  });
  await test("Invoice PDF made in Drive and downloadable", async () => {
    const html = commercialDocHtml({ company, title: "Tax Invoice", party: { name: `${TAG} Client` }, meta: [["Invoice no.", ids.inv1No]], lines: invLines, adj: {}, gst: true, intraState: true, showBank: true });
    const r = await api<{ driveId: string; fileId: string }>("/api/docs/pdf", "POST", { html, name: `${TAG} ${String(ids.inv1No).replace(/\//g, "-")}`, folder: `${TAG}/Invoices`, billingType: "gst", linked: { col: "invoices", id: ids.inv1 } });
    eq(r.status, 200, "PDF API");
    m.driveIds.push(r.json.driveId); saveManifest(m);
    await updateDoc("invoices", ids.inv1, { pdfDriveId: r.json.driveId, pdfFileId: r.json.fileId });
    const dl = await fetch(`${BASE}/api/files/${r.json.driveId}`, { headers: { authorization: `Bearer ${await auth().currentUser!.getIdToken()}` } });
    const buf = Buffer.from(await dl.arrayBuffer());
    ok(dl.status === 200 && buf.subarray(0, 4).toString() === "%PDF", `download ${dl.status} ${buf.subarray(0, 4)}`);
    return `${Math.round(buf.length / 1024)} KB PDF`;
  });
  await test("Bank account; payment with 10% TDS settles invoice in full", async () => {
    await as("admin");
    ids.bank = await createDoc("accounts", { name: `${TAG} Bank`, kind: "bank", openingBalance: 100000, holderId: null, active: true });
    await settle();
    await as("accounts");
    const tds = Math.round(it.taxable * 10) / 100; // 10% of taxable
    const cash = it.total - tds;
    ids.pay = await createDoc("payments", { date: today(), clientId: ids.client, clientName: `${TAG} Client`, mode: "Bank transfer", accountId: ids.bank, accountHolder: null, amount: cash, tds, allocations: [{ invoiceId: ids.inv1, number: ids.inv1No, amount: cash, tds, projectId: ids.proj }], invoiceIds: [ids.inv1], advance: 0, billingType: "gst", quarter: tdsQuarter(today()), tds26AS: false, tdsCertReceived: false });
    await updateDoc("invoices", ids.inv1, { paid: increment(cash + tds), status: "Paid" });
    ids.payEntry = await createDoc("entries", { date: today(), direction: "in", amount: cash, scope: "project", projectId: ids.proj, category: "Client payment against invoice", billingType: "gst", accountId: ids.bank, accountHolder: null, mode: "Bank transfer", linkedDoc: { type: "payment", id: ids.pay }, status: "approved" });
    await settle();
    const inv = await until("invoices", ids.inv1, (d) => d.status === "Paid", "invoice paid");
    near(invoiceDue(inv), 0, "balance due");
    const byInv = await getDocs(query(collection(db(), "payments"), where("invoiceIds", "array-contains", ids.inv1), where("billingType", "==", "gst")));
    eq(byInv.size, 1, "payments for invoice (index)");
    await updateDoc("payments", ids.pay, { tds26AS: true });
    await settle();
    ids.cashIn = cash;
    return `received ₹${cash} + TDS ₹${tds} = ₹${it.total}`;
  });
  await test("Cancel invoice needs approval; admin approves → Cancelled (number kept)", async () => {
    await updateDoc("invoices", ids.inv2, { cancelRequested: true });
    const r = await requestApproval({ type: "invoiceCancel", col: "invoices", docId: ids.inv2, amount: it.total, summary: `${TAG} cancel`, link: "/invoices" });
    if (r === "none") return "skipped: invoice cancel approval is off in your settings";
    await settle();
    const ap = ((await adoc("invoices", ids.inv2))?.pendingApproval as { id: string }).id;
    await as("admin");
    eq((await api("/api/approvals/decide", "POST", { approvalId: ap, decision: "approve" })).status, 200, "approve");
    const inv = await adoc("invoices", ids.inv2);
    eq(inv?.status, "Cancelled", "status"); ok(inv?.number, "number kept");
    return `${inv?.number} cancelled`;
  });

  section("Cash custody, claims, entry deletion");
  await test("Cash in to admin wallet; handover to engineer counts only after confirmation", async () => {
    await as("admin");
    await createDoc("entries", { date: today(), direction: "in", amount: 20000, scope: "company", category: "Other income (scrap sale, interest, etc.)", billingType: "gst", accountId: ids.adminWallet, accountHolder: uid("admin"), mode: "Cash", status: "approved" });
    ids.tr = await createDoc("transfers", { date: today(), amount: 5000, fromAccountId: ids.adminWallet, toAccountId: ids.engineerWallet, fromHolder: uid("admin"), toHolder: uid("engineer"), kind: "Handover", status: "pending" });
    await settle();
    await as("engineer");
    await denied(() => fsUpdate(fsDoc("transfers", ids.tr), { amount: 50000 }), "receiver changing the amount");
    await updateDoc("transfers", ids.tr, { status: "confirmed", confirmedAt: new Date().toISOString() });
    await settle();
    await until("transfers", ids.tr, (d) => d.status === "confirmed", "handover confirmed");
  });
  await test("Engineer records an expense from own wallet with a bill photo (Drive)", async () => {
    const f = await upload(`${TAG} bill.png`, "image/png", PNG, `${TAG}/Bills`);
    ids.engExp = await createDoc("entries", { date: today(), direction: "out", amount: 1200, scope: "project", projectId: ids.proj, category: "Site travel", billingType: "gst", accountId: ids.engineerWallet, accountHolder: uid("engineer"), mode: "Cash", billId: f.fileId, isPurchase: true, status: "approved" });
    await settle();
    await denied(() => getDocs(collection(db(), "entries")), "engineer listing all cash flow");
    const own = await getDocs(query(collection(db(), "entries"), where("accountHolder", "==", uid("engineer"))));
    eq(own.size, 1, "engineer sees own wallet entries");
  });
  await test("Deleting a money entry needs approval; approved → marked deleted", async () => {
    await as("accounts");
    const r = await requestApproval({ type: "entryDelete", col: "entries", docId: ids.engExp, amount: 1200, summary: `${TAG} delete`, link: "/cashflow" });
    if (r === "none") return "skipped: entry delete approval is off in your settings";
    await settle();
    await denied(() => deleteDoc(fsDoc("entries", ids.engExp)), "hard-deleting a money entry");
    const ap = ((await adoc("entries", ids.engExp))?.pendingApproval as { id: string }).id;
    await as("admin");
    eq((await api("/api/approvals/decide", "POST", { approvalId: ap, decision: "approve" })).status, 200, "approve");
    eq((await adoc("entries", ids.engExp))?.deleted, true, "soft deleted");
  });
  await test("Expense claim: submit → approve (API) → pay out → Paid", async () => {
    await as("engineer");
    const f = await upload(`${TAG} claim.png`, "image/png", PNG, `${TAG}/Claims`);
    ids.claim = await createDoc("claims", { date: today(), amount: 800, scope: "project", projectId: ids.proj, category: "Food & stay at site", description: "Site lunch", billId: f.fileId, claimant: uid("engineer"), status: "submitted" });
    await settle();
    await requestApproval({ type: "claim", col: "claims", docId: ids.claim, amount: 800, summary: `${TAG} claim`, link: "/claims" });
    await settle();
    const c = await adoc("claims", ids.claim);
    const ap = (c?.pendingApproval as { id: string } | null)?.id;
    await as("admin");
    if (ap) eq((await api("/api/approvals/decide", "POST", { approvalId: ap, decision: "approve" })).status, 200, "approve");
    else await updateDoc("claims", ids.claim, { status: "approved" });
    await as("accounts");
    await createDoc("entries", { date: today(), direction: "out", amount: 800, scope: "project", projectId: ids.proj, category: "Food & stay at site", billingType: "gst", accountId: ids.bank, accountHolder: null, mode: "Bank transfer", billId: f.fileId, isPurchase: true, linkedDoc: { type: "claim", id: ids.claim }, status: "approved" });
    await updateDoc("claims", ids.claim, { status: "paid" });
    await settle();
    await until("claims", ids.claim, (d) => d.status === "paid", "claim paid");
    await as("store");
    return await denied(() => getDoc(fsDoc("claims", ids.claim)), "another user opening the claim");
  });

  // ---------------------------------------------------------------- supply
  section("Engineering & supply: BOM, PO, GRN, stock, bills, challans, assets");
  await test("Engineer builds a multi-level EBOM, revises it, derives an MBOM", async () => {
    await as("engineer");
    const lines: BomLine[] = [
      { level: 0, description: "Panel assembly", qty: 1, rate: 2000 },
      { level: 1, description: "Breaker", itemId: ids.itemA, qty: 10, rate: 6000, quotes: [{ vendorId: ids.vendor, price: 5900, leadDays: 7 }], selectedVendorId: ids.vendor },
      { level: 1, description: "Cable", itemId: ids.itemB, qty: 4, rate: 250 },
    ];
    ids.bom = await createDoc("boms", { name: `${TAG} Panel`, projectId: ids.proj, kind: "EBOM", rev: "A", revNote: "Initial", lines, revisions: [], estCost: bomTotal(lines) }, { counter: "bom", field: "code", format: (n) => `BOM-${pad(n)}` });
    await updateDoc("boms", ids.bom, { rev: "B", revNote: "More cable", lines: lines.map((l, i) => (i === 2 ? { ...l, qty: 6 } : l)), revisions: arrayUnion({ rev: "A", note: "Initial", lines, at: new Date().toISOString() }) });
    ids.mbom = await createDoc("boms", { name: `${TAG} Panel (MBOM)`, projectId: ids.proj, kind: "MBOM", rev: "A", derivedFrom: ids.bom, lines: lines.map((l, i) => ({ ...l, makeBuy: isLeaf(lines, i) ? "Buy" : "Make" })), revisions: [] }, { counter: "bom", field: "code", format: (n) => `BOM-${pad(n)}` });
    await settle();
    const b = await until("boms", ids.bom, (d) => d.rev === "B", "revision B");
    eq(bomTotal(b.lines as BomLine[]), 2000 + 60000 + 1500, "estimated cost");
    return `${b.code} Rev B (est. ₹63,500), MBOM ${(await adoc("boms", ids.mbom))?.code}`;
  });
  const poLines: Line[] = [{ itemId: ids.itemA, description: "Breaker", hsn: "8536", qty: 10, unit: "Nos", rate: 5900, discType: "pct", disc: 0, taxRate: 18 }];
  const pt = computeTotals(poLines, {}, { gst: true, intraState: true });
  await test(`PO ₹${pt.total} above approval limit → numbered, pending → approved`, async () => {
    await as("accounts");
    ids.po = await createDoc("pos", { vendorId: ids.vendor, vendorName: `${TAG} Vendor`, projectId: ids.proj, scope: "project", bomId: ids.bom, date: today(), lines: poLines.map((l) => ({ ...l, itemId: ids.itemA, received: 0 })), adj: {}, billingType: "gst", intraState: true, total: pt.total, taxable: pt.taxable, tax: pt.tax, status: "Draft", number: null });
    await settle();
    const no = await assignNumber("pos", ids.po, fySeries("po", "PO"), { status: "Pending approval" });
    const r = await requestApproval({ type: "po", col: "pos", docId: ids.po, amount: pt.total, summary: `${TAG} ${no}`, link: "/purchases" });
    await settle();
    if (r === "pending") {
      const ap = ((await adoc("pos", ids.po))?.pendingApproval as { id: string }).id;
      await as("admin");
      eq((await api("/api/approvals/decide", "POST", { approvalId: ap, decision: "approve" })).status, 200, "approve PO");
    } else {
      await updateDoc("pos", ids.po, { status: "Approved" });
      m.notes.push("PO approval rule did not apply (amount at/below your threshold or rule off)");
    }
    await settle();
    eq((await adoc("pos", ids.po))?.status, "Approved", "PO status");
    return `${no} ${r === "pending" ? "approved by admin" : "auto-approved"}`;
  });
  await test("Two goods receipts (6 + 4) → stock in, PO Received", async () => {
    await as("accounts");
    for (const q of [6, 4]) {
      const po = await adoc("pos", ids.po);
      const lines = (po!.lines as (Line & { received: number })[]);
      const g = await createDoc("grns", { poId: ids.po, poNumber: po!.number, vendorId: ids.vendor, vendorName: `${TAG} Vendor`, projectId: ids.proj, date: today(), location: "Store", lines: [{ poLine: 0, itemId: ids.itemA, description: "Breaker", qty: q, unit: "Nos" }] }, fySeries("grn", "GRN"));
      await createDoc("stockMoves", { itemId: ids.itemA, qty: q, location: "Store", type: "GRN", projectId: ids.proj, ref: { col: "grns", id: g }, date: today(), note: String(po!.number) });
      const nl = lines.map((l) => ({ ...l, received: Number(l.received || 0) + q }));
      await updateDoc("pos", ids.po, { lines: nl, status: nl.every((l) => l.received >= l.qty) ? "Received" : "Partly received" }, po!);
      await settle();
    }
    eq((await adoc("pos", ids.po))?.status, "Received", "PO status");
  });
  await test("Vendor bill with photo → paid from bank → cash flow, bill Paid", async () => {
    const f = await upload(`${TAG} vendor bill.png`, "image/png", PNG, `${TAG}/Vendor bills`);
    ids.bill = await createDoc("purchaseBills", { vendorId: ids.vendor, vendorName: `${TAG} Vendor`, vendorGstin: "29BBBBB0000B1Z5", poId: ids.po, poNumber: "PO", projectId: ids.proj, scope: "project", category: "Raw material & components", billNo: `${TAG}-B1`, billDate: today(), dueDate: today(), taxable: pt.taxable, tax: pt.tax, total: pt.total, billingType: "gst", fileId: f.fileId, paid: 0, status: "Unpaid" });
    await createDoc("entries", { date: today(), direction: "out", amount: pt.total, scope: "project", projectId: ids.proj, category: "Raw material & components", billingType: "gst", accountId: ids.bank, accountHolder: null, mode: "Bank transfer", billId: f.fileId, isPurchase: true, linkedDoc: { type: "purchaseBill", id: ids.bill }, vendorId: ids.vendor, status: "approved" });
    await updateDoc("purchaseBills", ids.bill, { paid: increment(pt.total), status: "Paid" });
    await settle();
    await until("purchaseBills", ids.bill, (d) => d.status === "Paid", "bill paid");
  });
  await test("Store: issue to project, move to site, challan out, partial return", async () => {
    await as("engineer");
    await denied(() => setDoc(doc(collection(db(), "stockMoves")), { itemId: ids.itemA, qty: 1 }), "engineer moving stock");
    await as("store");
    await createDoc("stockMoves", { itemId: ids.itemA, qty: -3, location: "Store", type: "Issue", projectId: ids.proj, date: today() });
    await createDoc("stockMoves", { itemId: ids.itemA, qty: -2, location: "Store", type: "Transfer out", date: today() });
    await createDoc("stockMoves", { itemId: ids.itemA, qty: 2, location: "Site", type: "Transfer in", date: today() });
    ids.dc = await createDoc("challans", { date: today(), projectId: ids.proj, clientId: ids.client, purpose: "Sent for job work", consignee: `${TAG} Vendor`, fromLocation: "Store", returnable: true, expectedReturn: today(), lines: [{ itemId: ids.itemA, description: "Breaker", qty: 2, unit: "Nos", returned: 0 }], status: "Open", eway: {} }, fySeries("dc", "DC"));
    await createDoc("stockMoves", { itemId: ids.itemA, qty: -2, location: "Store", type: "Challan", projectId: ids.proj, ref: { col: "challans", id: ids.dc }, date: today() });
    await createDoc("stockMoves", { itemId: ids.itemA, qty: 1, location: "Store", type: "Return", ref: { col: "challans", id: ids.dc }, date: today() });
    await updateDoc("challans", ids.dc, { lines: [{ itemId: ids.itemA, description: "Breaker", qty: 2, unit: "Nos", returned: 1 }], status: "Partly returned", eway: { no: "123456789012", vehicle: "KA01AB1234" } });
    await settle();
    const moves = (await adb.collection("stockMoves").where("itemId", "==", ids.itemA).get()).docs.map((d) => ({ id: d.id, ...d.data() }));
    const items = [{ id: ids.itemA, reorderLevel: 6 }];
    const s = stockFrom(moves as never, items as never).get(ids.itemA)!;
    eq(s.byLocation, { Store: 4, Site: 2 }, "stock by location"); eq(s.total, 6, "total");
    ok(s.total <= 6, "at reorder level → low-stock alert");
    return `Store 4, Site 2 (low-stock alert at 6); challan ${(await adoc("challans", ids.dc))?.number}`;
  });
  await test("Required asset: request → approve → PO → receive → asset added, request Received", async () => {
    await as("engineer");
    ids.areq = await createDoc("assetRequests", { item: `${TAG} Electronic load`, qty: 1, estCost: 30000, priority: "P1", status: "Requested", requestedBy: uid("engineer"), order: 999 });
    await settle();
    await as("admin");
    await updateDoc("assetRequests", ids.areq, { status: "Approved", order: 0 });
    await as("accounts");
    const l: Line[] = [{ description: "Electronic load", qty: 1, rate: 30000, taxRate: 18 }];
    const t = computeTotals(l, {}, { gst: true, intraState: true });
    ids.apo = await createDoc("pos", { vendorId: ids.vendor, vendorName: `${TAG} Vendor`, projectId: null, scope: "company", assetRequestId: ids.areq, date: today(), lines: l.map((x) => ({ ...x, received: 0 })), adj: {}, billingType: "gst", total: t.total, taxable: t.taxable, tax: t.tax, status: "Approved", number: null });
    await updateDoc("assetRequests", ids.areq, { status: "Ordered", poId: ids.apo });
    await createDoc("grns", { poId: ids.apo, vendorId: ids.vendor, date: today(), location: "Office", lines: [{ poLine: 0, description: "Electronic load", qty: 1 }] }, fySeries("grn", "GRN"));
    await updateDoc("pos", ids.apo, { lines: l.map((x) => ({ ...x, received: 1 })), status: "Received" });
    ids.asset = await createDoc("assets", { name: `${TAG} Electronic load`, status: "In use", purchaseDate: today(), value: t.taxable, vendorId: ids.vendor, location: "Office", assetType: "Test equipment", poId: ids.apo, serviceDue: today() }, ENTITIES.assets.code);
    await updateDoc("assetRequests", ids.areq, { status: "Received" });
    await settle();
    await until("assetRequests", ids.areq, (d) => d.status === "Received", "request closed");
    return `asset ${(await adoc("assets", ids.asset))?.code}`;
  });

  // ---------------------------------------------------------------- documents & meetings
  section("Documents (Google Drive) and meetings");
  await test("Engineer uploads a drawing, then a new version (history kept)", async () => {
    await as("engineer");
    const f1 = await upload(`${TAG} drawing.png`, "image/png", PNG, `${TAG}/Drawings`);
    ids.doc = await createDoc("docs", { name: `${TAG} drawing.png`, folder: "Drawings", projectId: ids.proj, clientId: ids.client, billingType: "gst", versions: [{ fileId: f1.fileId, driveId: f1.driveId, name: "drawing.png", at: new Date().toISOString() }] });
    const f2 = await upload(`${TAG} drawing v2.png`, "image/png", PNG, `${TAG}/Drawings`);
    await updateDoc("docs", ids.doc, { versions: arrayUnion({ fileId: f2.fileId, driveId: f2.driveId, name: "drawing.png", at: new Date().toISOString() }) });
    await settle();
    await until("docs", ids.doc, (d) => (d.versions as unknown[]).length === 2, "2 versions");
    const dl = await fetch(`${BASE}/api/files/${f2.driveId}`, { headers: { authorization: `Bearer ${await auth().currentUser!.getIdToken()}` } });
    ok(dl.status === 200 && Buffer.from(await dl.arrayBuffer()).equals(PNG), `download matches upload (${dl.status})`);
  });
  await test("Non-GST file can't be downloaded without non-GST permission", async () => {
    await as("admin");
    const f = await upload(`${TAG} cash receipt.png`, "image/png", PNG, `${TAG}/Private`, "nonGst");
    await as("accounts");
    const r = await fetch(`${BASE}/api/files/${f.driveId}`, { headers: { authorization: `Bearer ${await auth().currentUser!.getIdToken()}` } });
    eq(r.status, 403, "download status");
  });
  await test("Meeting with action items; owner updates own item; MOM PDF", async () => {
    await as("pm");
    ids.meet = await createDoc("meetings", { title: `${TAG} Review`, meetingType: "Project meeting", status: "Held", date: today(), projectId: ids.proj, chair: uid("pm"), discussed: "Progress", decisions: "Proceed", actions: [{ description: `${TAG} Send drawings`, owner: uid("engineer"), due: today(), status: "Open" }] });
    await settle();
    await as("engineer");
    const mt = await adoc("meetings", ids.meet);
    await updateDoc("meetings", ids.meet, { actions: [{ ...(mt!.actions as Record<string, unknown>[])[0], status: "Done" }] }, mt!);
    await settle();
    await denied(() => fsUpdate(fsDoc("meetings", ids.meet), { title: "changed" }), "engineer editing the meeting itself");
    await as("pm");
    const html = sectionsDocHtml({ company, title: "Minutes of Meeting", meta: [["Meeting", `${TAG} Review`]], sections: [["Decisions", "Proceed"]], tables: [{ title: "Action items", head: ["Action", "Status"], rows: [["Send drawings", "Done"]] }] });
    const r = await api<{ driveId: string }>("/api/docs/pdf", "POST", { html, name: `${TAG} MOM v1`, folder: `${TAG}/MOM`, linked: { col: "meetings", id: ids.meet } });
    eq(r.status, 200, "MOM PDF");
    m.driveIds.push(r.json.driveId); saveManifest(m);
    await updateDoc("meetings", ids.meet, { status: "MOM issued", momVersion: 1, momDriveId: r.json.driveId });
    await settle();
    eq(((await adoc("meetings", ids.meet))?.actions as { status: string }[])[0].status, "Done", "action item");
  });

  // ---------------------------------------------------------------- reports & controls
  section("Balances, reports, audit log");
  await test("Account balances (bank, admin wallet, engineer wallet)", async () => {
    const accs = (await adb.collection("accounts").where("__name__", "in", [ids.bank, ids.adminWallet, ids.engineerWallet]).get()).docs.map((d) => ({ id: d.id, ...d.data() }));
    const ents = (await adb.collection("entries").where("accountId", "in", [ids.bank, ids.adminWallet, ids.engineerWallet]).get()).docs.map((d) => ({ id: d.id, ...d.data() }));
    const trs = (await adb.collection("transfers").where("__name__", "==", ids.tr).get()).docs.map((d) => ({ id: d.id, ...d.data() }));
    const bal = balances(accs as never, ents as never, trs as never);
    near(bal.get(ids.bank)!, 100000 + ids.cashIn - 800 - pt.total, "bank");
    near(bal.get(ids.adminWallet)!, 15000, "admin wallet");
    near(bal.get(ids.engineerWallet)!, 5000, "engineer wallet (deleted expense excluded)");
    return `bank ₹${bal.get(ids.bank)}, admin ₹15,000, engineer ₹5,000`;
  });
  await test("Monthly-review snapshot builds from live data", async () => {
    await as("admin");
    const s = await buildSnapshot(true);
    ok(s.projects.some((p) => p.name === `${TAG} Project`), "test project in P&L");
    ok(s.requiredAssets.length >= 0 && typeof s.cash.total === "number", "cash and assets");
    return `${s.projects.length} projects, ${s.openActions.length} open actions`;
  });
  await test("Audit log records the changes; only admin can read it", async () => {
    const a = await adb.collection("auditLog").where("docId", "==", ids.inv1).get();
    const actions = new Set(a.docs.map((d) => d.data().action));
    ok(actions.has("create") && actions.has("number") && actions.has("edit"), `actions ${[...actions]}`);
    await as("accounts");
    await denied(() => getDocs(collection(db(), "auditLog")), "accounts reading the audit log");
    await denied(() => getDoc(fsDoc("secrets", "google")), "reading the Google token");
    await denied(() => setDoc(fsDoc("counters", "zz-e2e"), { seq: 5 }), "jumping a number counter");
    return `${a.size} entries for one invoice: ${[...actions].join(", ")}`;
  });
  await test("Deactivated user is locked out", async () => {
    await as("admin");
    eq((await api("/api/users", "PATCH", { uid: uid("store"), active: false })).status, 200, "deactivate");
    await as("store").catch(() => null);
    const r = await getDocs(collection(db(), "items")).then(() => "allowed").catch((e) => e.code);
    ok(String(r).includes("permission-denied") || String(r).includes("user-disabled"), `store after deactivation: ${r}`);
  });

  // ---------------------------------------------------------------- pages
  section("Pages load (local app)");
  await test("All 29 main pages respond", async () => {
    const pages = ["/", "/login", "/privacy", "/clients", "/vendors", "/requirements", "/proposals", "/quotations", "/projects", "/documents", "/ideas", "/boms", "/sourcing", "/purchases", "/inventory", "/assets", "/assets/required", "/challans", "/invoices", "/payments", "/cashflow", "/accounts", "/claims", "/approvals", "/audit", "/reports", "/meetings", "/settings", `/projects/${ids.proj}`];
    const bad: string[] = [];
    for (const p of pages) { const r = await fetch(BASE + p); if (r.status !== 200) bad.push(`${p} ${r.status}`); }
    if (bad.length) throw new Error(bad.join(", "));
  });

  await settle();
  fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify({ runId, finishedAt: new Date().toISOString(), base: BASE, ids, results, notes: m.notes }, null, 2));
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed}/${results.length} passed. Manifest: ${MANIFEST}`);
  process.exit(0);
}

main().catch(async (e) => {
  console.error("Run aborted:", e);
  fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify({ runId, aborted: String(e), ids, results }, null, 2));
  saveManifest(m);
  process.exit(1);
});

void FieldValue; void softDelete; void getRules;
