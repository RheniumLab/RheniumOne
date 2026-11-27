/** Checks the alert strategy: right people get alerts, others don't; push service reachable. */
import fs from "fs";
import path from "path";
import { randomBytes } from "crypto";
import { signInWithEmailAndPassword, signOut } from "firebase/auth";
import { collection, doc, getDocs, limit, orderBy, query, serverTimestamp, setDoc, updateDoc, where } from "firebase/firestore";
import { getMessaging } from "firebase-admin/messaging";
import { auth, db } from "@/lib/firebase";
import { aauth, adb, api, denied, eq, ok, OUT, results, section, test, type Manifest } from "./lib";

(async () => {
  const m: Manifest = JSON.parse(fs.readFileSync(path.join(OUT, "manifest.json"), "utf8"));
  const prev = JSON.parse(fs.readFileSync(path.join(OUT, "results.json"), "utf8"));
  const ids = prev.ids;
  const uidOf = async (k: string) => (await aauth.getUserByEmail(m.emails.find((e) => e.includes(`zz-test-${k}-`))!)).uid;
  const signIn = async (k: string) => {
    const email = m.emails.find((e) => e.includes(`zz-test-${k}-`))!;
    const u = await aauth.getUserByEmail(email);
    const pass = "Zz!n-" + randomBytes(6).toString("hex");
    await aauth.updateUser(u.uid, { password: pass });
    if (auth().currentUser) await signOut(auth());
    await signInWithEmailAndPassword(auth(), email, pass);
    return u.uid;
  };
  const inbox = async () => (await getDocs(query(collection(db(), "notifications"), where("to", "==", auth().currentUser!.uid), orderBy("at", "desc"), limit(20)))).docs.map((d) => ({ id: d.id, ...d.data() }) as Record<string, any>); // eslint-disable-line @typescript-eslint/no-explicit-any
  const eng = await uidOf("engineer");
  const auditor = await uidOf("auditor");
  section("Alerts (in-app + push)");
  await test("Task assigned → the assignee is alerted", async () => {
    await signIn("pm");
    const ref = doc(collection(db(), "projects", ids.proj, "tasks"));
    await setDoc(ref, { title: `ZZ Test ${m.runId} Wire panel`, assignee: eng, status: "todo", createdAt: serverTimestamp() });
    const r = await api<{ sent: number }>("/api/notify", "POST", { event: "task.assigned", id: ids.proj, sub: ref.id });
    eq(r.status, 200, `notify ${JSON.stringify(r.json)}`);
    eq(r.json.sent, 1, "recipients");
    await signIn("engineer");
    const n = (await inbox()).find((x) => String(x.title).includes("Wire panel"));
    ok(n && n.link === `/projects/${ids.proj}` && n.read === false, "engineer sees it, unread, links to the project");
    await updateDoc(doc(db(), "notifications", n!.id), { read: true, readAt: new Date().toISOString() });
    return String(n!.title);
  });
  await test("People can only read their own alerts and can't create them", async () => {
    const pm = await uidOf("pm");
    await denied(() => getDocs(query(collection(db(), "notifications"), where("to", "==", pm))), "reading someone else's alerts");
    return await denied(() => setDoc(doc(collection(db(), "notifications")), { to: pm, title: "fake" }), "creating an alert");
  });
  await test("GST invoice issued → Auditor alerted; Engineer not", async () => {
    await signIn("accounts");
    const r = await api<{ sent: number }>("/api/notify", "POST", { event: "invoice.issued", id: ids.inv1 });
    eq(r.status, 200, "notify");
    const toAud = await adb.collection("notifications").where("to", "==", auditor).where("type", "==", "invoice.issued").get();
    const toEng = await adb.collection("notifications").where("to", "==", eng).where("type", "==", "invoice.issued").get();
    ok(toAud.size >= 1, "auditor alerted"); eq(toEng.size, 0, "engineer alerts");
    return `${r.json.sent} people alerted`;
  });
  await test("Non-GST bill → Auditor (no non-GST access) not alerted", async () => {
    await signIn("admin");
    const before = (await adb.collection("notifications").where("to", "==", auditor).get()).size;
    eq((await api("/api/notify", "POST", { event: "invoice.issued", id: ids.ngInv })).status, 200, "notify");
    eq((await adb.collection("notifications").where("to", "==", auditor).get()).size, before, "auditor alerts unchanged");
  });
  await test("Nobody is alerted about their own action", async () => {
    await signIn("engineer");
    const ref = doc(collection(db(), "projects", ids.proj, "tasks"));
    await signIn("pm");
    await setDoc(ref, { title: `ZZ Test ${m.runId} Self task`, assignee: await uidOf("pm"), status: "todo" });
    const r = await api<{ sent: number }>("/api/notify", "POST", { event: "task.assigned", id: ids.proj, sub: ref.id });
    eq(r.json.sent, 0, "recipients");
  });
  await test("Push service (Firebase Cloud Messaging) is reachable", async () => {
    const res = await getMessaging().send({ token: "zz-invalid-test-token", webpush: { data: { title: "t" } } }, true).then(() => "ok").catch((e) => e.code as string);
    ok(/invalid-argument|registration-token|ok/.test(res), `FCM answered: ${res}`);
    return `FCM API enabled (test send to a fake device answered "${res}")`;
  });
  prev.results.push(...results);
  fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify(prev, null, 2));
  console.log(`\nalert checks: ${results.filter((x) => x.ok).length}/${results.length} passed`);
  process.exit(0);
})();
