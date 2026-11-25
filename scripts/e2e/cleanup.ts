/**
 * Removes everything an e2e run created, using its manifest.
 *   npx tsx --tsconfig scripts/e2e/tsconfig.json --env-file=.env.local scripts/e2e/cleanup.ts        (dry run: list only)
 *   npx tsx --tsconfig scripts/e2e/tsconfig.json --env-file=.env.local scripts/e2e/cleanup.ts --yes  (delete)
 *
 * Finds records by the test users who created them (createdBy / uid /
 * requestedBy / holderId), deletes the test users and roles, restores the
 * numbering counters to their values before the run, and moves the test's
 * Google Drive files and folders to the Drive trash (recoverable for 30 days).
 */
import fs from "fs";
import { adb, aauth, MANIFEST, type Manifest } from "./lib";

const YES = process.argv.includes("--yes");
const m = JSON.parse(fs.readFileSync(MANIFEST, "utf8")) as Manifest;
const chunks = <T,>(a: T[], n = 10) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

const COLLECTIONS = [
  "clients", "vendors", "items", "ideas", "requirements", "proposals", "quotations", "projects", "invoices", "payments",
  "entries", "transfers", "claims", "boms", "pos", "grns", "purchaseBills", "stockMoves", "challans", "assets",
  "assetRequests", "docs", "meetings", "accounts", "categories",
];

async function byField(col: string, field: string, values: string[]) {
  const out = new Map<string, FirebaseFirestore.DocumentReference>();
  for (const c of chunks(values)) {
    if (!c.length) continue;
    const s = await adb.collection(col).where(field, "in", c).get();
    s.docs.forEach((d) => out.set(d.ref.path, d.ref));
  }
  return out;
}

async function driveToken() {
  const s = (await adb.doc("secrets/google").get()).data();
  if (!s?.refreshToken) return null;
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ refresh_token: s.refreshToken, client_id: process.env.GOOGLE_CLIENT_ID!, client_secret: process.env.GOOGLE_CLIENT_SECRET!, grant_type: "refresh_token" }),
  });
  return r.ok ? ((await r.json()).access_token as string) : null;
}

(async () => {
  console.log(`${YES ? "CLEANUP" : "DRY RUN (nothing deleted; add --yes to delete)"} for run ${m.runId}, ${m.uids.length} test users\n`);
  const refs = new Map<string, FirebaseFirestore.DocumentReference>();
  const counts: Record<string, number> = {};
  const add = (label: string, found: Map<string, FirebaseFirestore.DocumentReference>) => {
    found.forEach((r, k) => refs.set(k, r));
    if (found.size) counts[label] = (counts[label] ?? 0) + found.size;
  };

  for (const col of COLLECTIONS) add(col, await byField(col, "createdBy", m.uids));
  add("accounts (test wallets)", await byField("accounts", "holderId", m.uids));
  add("accounts (e2e)", await byField("accounts", "e2e", [m.runId]));
  add("files", await byField("files", "uid", m.uids));
  add("approvals", await byField("approvals", "requestedBy", m.uids));
  add("auditLog", await byField("auditLog", "uid", m.uids));
  add("users", new Map(m.uids.map((u) => [`users/${u}`, adb.collection("users").doc(u)])));
  add("roles", new Map(m.roles.map((r) => [`roles/${r}`, adb.collection("roles").doc(r)])));

  // Drive: files recorded by the test, quotation Google Docs, and folders created during the run.
  const driveIds = new Set(m.driveIds);
  for (const ref of refs.values()) {
    if (ref.parent.id === "files" || ref.parent.id === "quotations") {
      const d = (await ref.get()).data();
      if (d?.driveId) driveIds.add(d.driveId);
      if (d?.googleDocId) driveIds.add(d.googleDocId);
      for (const r of (d?.releases ?? []) as { driveId?: string }[]) if (r.driveId) driveIds.add(r.driveId);
    }
  }
  const folderDocs = (await adb.collection("driveFolders").get()).docs.filter((d) => !m.driveFoldersBefore.includes(d.id));
  const folderIds = folderDocs.map((d) => d.data().id as string);

  // Counters: restore values from before the run; remove counters the run created.
  const counterNow = await adb.collection("counters").get();
  const counterOps = counterNow.docs
    .map((c) => ({ id: c.id, now: c.data().seq as number, before: m.counters[c.id] }))
    .filter((c) => c.before !== c.now);

  for (const [k, v] of Object.entries(counts)) console.log(`  ${k.padEnd(26)} ${v}`);
  console.log(`  ${"auth users".padEnd(26)} ${m.uids.length}`);
  console.log(`  ${"Drive files → trash".padEnd(26)} ${driveIds.size}`);
  console.log(`  ${"Drive folders → trash".padEnd(26)} ${folderIds.length}  ${folderDocs.map((d) => d.data().path).join(" | ")}`);
  console.log(`  counters to restore: ${counterOps.map((c) => `${c.id} ${c.now}→${c.before ?? "(remove)"}`).join(", ") || "none"}`);
  if (!YES) process.exit(0);

  let n = 0;
  for (const ref of refs.values()) {
    if (ref.parent.id === "projects") await adb.recursiveDelete(ref);
    else await ref.delete();
    n++;
  }
  for (const c of counterOps) {
    if (c.before === undefined) await adb.collection("counters").doc(c.id).delete();
    else await adb.collection("counters").doc(c.id).set({ seq: c.before });
  }
  for (const u of m.uids) await aauth.deleteUser(u).catch((e) => console.log("  auth delete:", u, e.code));
  const token = await driveToken();
  let trashed = 0;
  if (token) {
    // Also the run's own top folder ("ZZ Test <run>"), which holds the subfolders above.
    const q = encodeURIComponent(`name='ZZ Test ${m.runId}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
    const top = await (await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)`, { headers: { authorization: `Bearer ${token}` } })).json();
    for (const f of (top.files ?? []) as { id: string }[]) folderIds.push(f.id);
    for (const id of [...driveIds, ...folderIds]) {
      const r = await fetch(`https://www.googleapis.com/drive/v3/files/${id}`, { method: "PATCH", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ trashed: true }) });
      if (r.ok || r.status === 404) trashed++;
    }
    for (const d of folderDocs) await d.ref.delete();
  } else console.log("  Drive not reachable — files left in Drive");
  console.log(`\nDeleted ${n} records, ${m.uids.length} users, restored ${counterOps.length} counters, trashed ${trashed} Drive items.`);
  fs.renameSync(MANIFEST, MANIFEST.replace(".json", `.${m.runId}.cleaned.json`));
  process.exit(0);
})();
