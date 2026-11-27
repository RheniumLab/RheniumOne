/**
 * One test login per role (for checking what each role sees), plus sample
 * assignments so each has something to look at. Recorded in the e2e manifest,
 * so cleanup.ts removes them with the rest of the test data.
 */
import fs from "fs";
import path from "path";
import { randomInt } from "crypto";
import { FieldValue } from "firebase-admin/firestore";
import { signInWithEmailAndPassword } from "firebase/auth";
import { aauth, adb, api, OUT, saveManifest, type Manifest } from "./lib";
import { auth } from "@/lib/firebase";

const ROLES = [
  ["accounts", "Accounts"], ["auditor", "Auditor"], ["pm", "Project Manager"],
  ["engineer", "Engineer"], ["developer", "Developer"], ["store", "Store"],
] as const;

(async () => {
  const m: Manifest = JSON.parse(fs.readFileSync(path.join(OUT, "manifest.json"), "utf8"));
  const ids = JSON.parse(fs.readFileSync(path.join(OUT, "results.json"), "utf8")).ids;
  const out: { role: string; email: string; password: string; uid: string }[] = [];
  for (const [roleId, label] of ROLES) {
    const email = `${roleId}.test@rheniumone.test`;
    const password = `Rhenium@${label.split(" ")[0]}${randomInt(1000, 9999)}`;
    let uid: string;
    try {
      uid = (await aauth.getUserByEmail(email)).uid;
      await aauth.updateUser(uid, { password, disabled: false });
    } catch {
      uid = (await aauth.createUser({ email, password, displayName: `ZZ Test ${label}` })).uid;
      await adb.collection("accounts").add({ name: `Cash — ZZ Test ${label}`, kind: "cash", holderId: uid, openingBalance: 0, active: true, e2e: m.runId });
    }
    await adb.collection("users").doc(uid).set({ name: `ZZ Test ${label}`, email, roleId, active: true, e2e: m.runId });
    if (!m.uids.includes(uid)) { m.uids.push(uid); m.emails.push(email); }
    out.push({ role: label, email, password, uid });
  }
  saveManifest(m);
  const U = Object.fromEntries(out.map((o) => [o.role, o.uid]));

  // Sample assignments so each role has something to see.
  const proj = adb.collection("projects").doc(ids.proj);
  await proj.update({ managerId: U["Project Manager"] });
  const tasks = proj.collection("tasks");
  const mk = (title: string, who: string, status: string, due: string, milestone: string) =>
    tasks.add({ title: `ZZ Test ${title}`, assignee: who, status, due, milestone, createdAt: FieldValue.serverTimestamp(), createdBy: m.uids[0] });
  const today = new Date().toISOString().slice(0, 10);
  const later = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
  const t = [
    await mk("Panel wiring drawing", U.Engineer, "doing", later, "M1 Design"),
    await mk("Site survey report", U.Engineer, "todo", today, "M1 Design"),
    await mk("HMI screens", U.Developer, "todo", later, "M2 Software"),
    await mk("PLC logic review", U.Developer, "doing", later, "M2 Software"),
  ];
  const meet = await adb.collection("meetings").add({
    title: "ZZ Test Kick-off", meetingType: "Project meeting", status: "Held", date: today, projectId: ids.proj, chair: U["Project Manager"],
    discussed: "Scope and schedule", decisions: "Start design", e2e: m.runId, createdBy: m.uids[0], createdAt: FieldValue.serverTimestamp(),
    actions: [
      { description: "Share cable schedule", owner: U.Engineer, due: later, status: "Open" },
      { description: "Set up code repository", owner: U.Developer, due: later, status: "Open" },
    ],
  });

  // Send their alerts through the real alert service (as the test admin).
  const adminEmail = m.emails.find((e) => e.includes("zz-test-admin-"))!;
  const pass = `Zz!${randomInt(1e6, 9e6)}`;
  await aauth.updateUser((await aauth.getUserByEmail(adminEmail)).uid, { password: pass });
  await signInWithEmailAndPassword(auth(), adminEmail, pass);
  for (const x of t) await api("/api/notify", "POST", { event: "task.assigned", id: ids.proj, sub: x.id });
  await api("/api/notify", "POST", { event: "record.saved", col: "meetings", id: meet.id });
  await api("/api/notify", "POST", { event: "record.saved", col: "projects", id: ids.proj });
  await api("/api/notify", "POST", { event: "invoice.issued", id: ids.inv1 });
  await api("/api/notify", "POST", { event: "bill.recorded", id: ids.bill });

  fs.writeFileSync(path.join(OUT, "role-logins.json"), JSON.stringify(out, null, 2));
  for (const o of out) console.log(`${o.role.padEnd(16)} ${o.email.padEnd(32)} ${o.password}`);
  for (const [k, v] of Object.entries(U)) {
    const n = await adb.collection("notifications").where("to", "==", v).get();
    console.log(`  ${k}: ${n.size} alert(s) waiting`);
  }
  process.exit(0);
})();
