/**
 * Re-runs the checks that failed in the main run, against the same test data,
 * and updates results.json. Usage: npx tsx --tsconfig scripts/e2e/tsconfig.json --env-file=.env.local scripts/e2e/retest.ts
 */
import fs from "fs";
import path from "path";
import { collection, collectionGroup, getDoc, getDocs, doc, query, where } from "firebase/firestore";
import { signInWithEmailAndPassword } from "firebase/auth";
import { auth, db } from "@/lib/firebase";
import { aauth, denied, ok, OUT, results, section, test } from "./lib";

(async () => {
  const m = JSON.parse(fs.readFileSync(path.join(OUT, "manifest.json"), "utf8"));
  const prev = JSON.parse(fs.readFileSync(path.join(OUT, "results.json"), "utf8"));
  const ids = prev.ids;
  const signIn = async (k: string) => {
    const email = m.emails.find((e: string) => e.includes(`zz-test-${k}-`));
    const u = await aauth.getUserByEmail(email);
    const pass = "Zz!re-" + Date.now();
    await aauth.updateUser(u.uid, { password: pass });
    await signInWithEmailAndPassword(auth(), email, pass);
    return u.uid;
  };
  section("Re-test");
  await test("Engineer's 'my tasks' across projects (collection-group query)", async () => {
    const uid = await signIn("engineer");
    const s = await getDocs(query(collectionGroup(db(), "tasks"), where("assignee", "==", uid)));
    ok(s.size >= 2, `found ${s.size}`);
    return `${s.size} tasks found`;
  });
  await test("Non-GST bill: hidden from accounts, own series", async () => {
    await signIn("accounts");
    await denied(() => getDocs(collection(db(), "invoices")), "accounts listing invoices without the GST filter");
    await denied(() => getDocs(collection(db(), "projects")), "accounts listing projects without the GST filter");
    await denied(() => getDoc(doc(db(), "invoices", ids.ngInv)), "accounts opening the non-GST bill");
    const gst = await getDocs(query(collection(db(), "invoices"), where("billingType", "==", "gst")));
    ok(gst.size >= 2 && !gst.docs.some((d) => d.id === ids.ngInv), "GST list works and excludes the non-GST bill");
    return `unfiltered lists refused; GST list shows ${gst.size}`;
  });
  for (const r of results) {
    const i = prev.results.findIndex((x: { name: string }) => x.name === r.name);
    if (i >= 0) prev.results[i] = { ...prev.results[i], ok: r.ok, detail: r.detail, retested: true };
  }
  prev.retestedAt = new Date().toISOString();
  fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify(prev, null, 2));
  console.log(`\nre-test: ${results.filter((r) => r.ok).length}/${results.length} passed`);
  process.exit(0);
})();
