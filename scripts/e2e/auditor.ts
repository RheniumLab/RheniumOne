/**
 * Creates the Auditor role (if missing) and checks what an auditor can and can't do,
 * using a temporary test user (removed by cleanup.ts) and the e2e test data.
 */
import fs from "fs";
import path from "path";
import { randomBytes } from "crypto";
import { signInWithEmailAndPassword, signOut } from "firebase/auth";
import { collection, doc, getDoc, getDocs, query, setDoc, where } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { defaultRoles } from "@/lib/permissions";
import { aauth, adb, api, BASE, denied, ok, OUT, results, saveManifest, section, test, type Manifest } from "./lib";

(async () => {
  const m: Manifest = JSON.parse(fs.readFileSync(path.join(OUT, "manifest.json"), "utf8"));
  const prev = JSON.parse(fs.readFileSync(path.join(OUT, "results.json"), "utf8"));
  const ids = prev.ids;
  const signIn = async (email: string) => {
    const u = await aauth.getUserByEmail(email);
    const pass = "Zz!a-" + randomBytes(6).toString("hex");
    await aauth.updateUser(u.uid, { password: pass });
    if (auth().currentUser) await signOut(auth());
    await signInWithEmailAndPassword(auth(), email, pass);
    return u.uid;
  };
  section("Auditor role");
  await test("Auditor role exists (created if missing, view-only, no non-GST)", async () => {
    const ref = adb.doc("roles/auditor");
    const snap = await ref.get();
    const def = defaultRoles().find((r) => r.id === "auditor")!;
    if (!snap.exists) await ref.set({ name: def.name, nonGst: false, perms: def.perms });
    const r = (await ref.get()).data()!;
    ok(r.nonGst === false && !r.isAdmin, "no non-GST, not admin");
    ok(Object.values(r.perms as Record<string, Record<string, boolean>>).every((p) => !p.create && !p.edit && !p.delete), "view only");
    return snap.exists ? "already existed" : "created";
  });
  await test("Admin adds an auditor user through /api/users", async () => {
    await signIn(m.emails.find((e) => e.includes("zz-test-admin-"))!);
    const email = `zz-test-auditor-${m.runId.toLowerCase()}@rhenium-e2e.test`;
    const r = await api<{ uid: string }>("/api/users", "POST", { name: `ZZ Test ${m.runId} auditor`, email, password: "Zz!" + randomBytes(9).toString("base64url"), roleId: "auditor" });
    if (r.status !== 200) throw new Error(JSON.stringify(r.json));
    m.uids.push(r.json.uid); m.emails.push(email); saveManifest(m);
    await signIn(email);
  });
  await test("Auditor sees GST invoices, opens and downloads the invoice PDF", async () => {
    const inv = await getDocs(query(collection(db(), "invoices"), where("billingType", "==", "gst")));
    ok(inv.size >= 2, `GST invoices: ${inv.size}`);
    const d = (await getDoc(doc(db(), "invoices", ids.inv1))).data()!;
    const r = await fetch(`${BASE}/api/files/${d.pdfDriveId}`, { headers: { authorization: `Bearer ${await auth().currentUser!.getIdToken()}` } });
    ok(r.status === 200 && Buffer.from(await r.arrayBuffer()).subarray(0, 4).toString() === "%PDF", `invoice PDF download ${r.status}`);
    return `${inv.size} GST invoices, PDF downloaded`;
  });
  await test("Auditor sees GST vendor bills and downloads the bill file", async () => {
    const bills = await getDocs(query(collection(db(), "purchaseBills"), where("billingType", "==", "gst")));
    ok(bills.size >= 1, "bills");
    const f = (await getDoc(doc(db(), "files", bills.docs[0].data().fileId))).data()!;
    const r = await fetch(`${BASE}/api/files/${f.driveId}`, { headers: { authorization: `Bearer ${await auth().currentUser!.getIdToken()}` } });
    ok(r.status === 200, `bill download ${r.status}`);
    return `${bills.size} bill(s), file downloaded`;
  });
  await test("Auditor sees GST cash flow, payments and TDS", async () => {
    const e = await getDocs(query(collection(db(), "entries"), where("billingType", "==", "gst")));
    const p = await getDocs(query(collection(db(), "payments"), where("billingType", "==", "gst")));
    ok(e.size >= 1 && p.size >= 1, `entries ${e.size}, payments ${p.size}`);
    return `${e.size} GST entries, ${p.size} payment(s)`;
  });
  await test("Auditor can't see non-GST records", async () => {
    await denied(() => getDocs(collection(db(), "invoices")), "listing invoices without the GST filter");
    await denied(() => getDoc(doc(db(), "invoices", ids.ngInv)), "opening the non-GST bill");
    return await denied(() => getDocs(collection(db(), "entries")), "listing cash flow without the GST filter");
  });
  await test("Auditor can't change anything or see logs, claims, approvals' secrets", async () => {
    await denied(() => setDoc(doc(collection(db(), "invoices")), { billingType: "gst", status: "Draft" }), "creating an invoice");
    await denied(() => setDoc(doc(db(), "invoices", ids.inv1), { status: "Draft" }, { merge: true }), "editing an invoice");
    await denied(() => setDoc(doc(collection(db(), "entries")), { billingType: "gst", accountHolder: null }), "adding a cash entry");
    await denied(() => getDocs(collection(db(), "auditLog")), "reading logs");
    return await denied(() => getDocs(collection(db(), "projects")), "listing projects");
  });
  prev.results.push(...results);
  fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify(prev, null, 2));
  console.log(`\nauditor checks: ${results.filter((r) => r.ok).length}/${results.length} passed`);
  process.exit(0);
})();
