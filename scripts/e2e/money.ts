/** Checks the "Can see money" switch on documents, using the test engineer (money off) and test admin. */
import fs from "fs";
import path from "path";
import { randomBytes } from "crypto";
import { signInWithEmailAndPassword, signOut } from "firebase/auth";
import { collection, doc, getDoc, getDocs, query, where } from "firebase/firestore";
import { FieldValue } from "firebase-admin/firestore";
import { auth, db } from "@/lib/firebase";
import { aauth, adb, denied, ok, OUT, results, section, test, type Manifest } from "./lib";

(async () => {
  const m: Manifest = JSON.parse(fs.readFileSync(path.join(OUT, "manifest.json"), "utf8"));
  const prev = JSON.parse(fs.readFileSync(path.join(OUT, "results.json"), "utf8"));
  const proj = prev.ids.proj as string;
  const signIn = async (k: string) => {
    const email = m.emails.find((e) => e.includes(`zz-test-${k}-`))!;
    const u = await aauth.getUserByEmail(email);
    const pass = "Zz!m-" + randomBytes(6).toString("hex");
    await aauth.updateUser(u.uid, { password: pass });
    if (auth().currentUser) await signOut(auth());
    await signInWithEmailAndPassword(auth(), email, pass);
    return u.uid;
  };
  const adminUid = (await aauth.getUserByEmail(m.emails.find((e) => e.includes("zz-test-admin-"))!)).uid;
  const mk = (name: string, folder: string, commercial: boolean) =>
    adb.collection("docs").add({ name: `ZZ Test ${m.runId} ${name}`, folder, projectId: proj, clientId: null, billingType: "gst", commercial, versions: [], createdBy: adminUid, createdAt: FieldValue.serverTimestamp() });
  const inv = await mk("invoice.pdf", "Invoices", true);
  const drw = await mk("drawing.pdf", "Drawings", false);
  section("Can see money");
  await test("Engineer (money off) lists project documents without the commercial ones", async () => {
    await signIn("engineer");
    const s = await getDocs(query(collection(db(), "docs"), where("projectId", "==", proj), where("commercial", "==", false), where("billingType", "==", "gst")));
    ok(s.docs.some((d) => d.id === drw.id) && !s.docs.some((d) => d.id === inv.id), "drawing visible, invoice not");
    return `${s.size} document(s) visible`;
  });
  await test("Engineer can't open or list commercial documents", async () => {
    await denied(() => getDoc(doc(db(), "docs", inv.id)), "opening an invoice document");
    return await denied(() => getDocs(query(collection(db(), "docs"), where("projectId", "==", proj), where("billingType", "==", "gst"))), "listing documents without the commercial filter");
  });
  await test("Admin sees commercial documents", async () => {
    await signIn("admin");
    ok((await getDoc(doc(db(), "docs", inv.id))).exists(), "invoice document readable");
  });
  await test("Live roles: Accounts / Project Manager / Auditor see money; Engineer / Developer / Store don't", async () => {
    const r = Object.fromEntries((await adb.collection("roles").get()).docs.map((d) => [d.id, d.data()]));
    for (const k of ["accounts", "pm", "auditor"]) if (r[k]) ok(r[k].money === true, `${k} money on`);
    for (const k of ["engineer", "developer", "store"]) if (r[k]) ok(!r[k].money, `${k} money off`);
  });
  prev.results.push(...results);
  fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify(prev, null, 2));
  console.log(`\nmoney checks: ${results.filter((x) => x.ok).length}/${results.length} passed`);
  process.exit(0);
})();
