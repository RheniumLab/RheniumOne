/**
 * Builds scripts/e2e/.out/report.html from results.json and the cleanup dry run.
 *   npx tsx --tsconfig scripts/e2e/tsconfig.json scripts/e2e/report.ts
 */
import fs from "fs";
import path from "path";

const OUT = path.join(process.cwd(), "scripts", "e2e", ".out");
const r = JSON.parse(fs.readFileSync(path.join(OUT, "results.json"), "utf8"));
const dry = fs.existsSync(path.join(OUT, "cleanup-dryrun.txt")) ? fs.readFileSync(path.join(OUT, "cleanup-dryrun.txt"), "utf8") : "";
type Res = { area: string; name: string; ok: boolean; ms: number; detail?: string; retested?: boolean };
const results: Res[] = r.results;
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const passed = results.filter((x) => x.ok).length;
const failed = results.filter((x) => !x.ok);
const areas = [...new Set(results.map((x) => x.area))];

const created = dry
  .split("\n")
  .map((l) => l.match(/^\s{2}(\S.*?)\s{2,}(\d+)(.*)$/))
  .filter(Boolean)
  .map((m) => [m![1].trim(), m![2]]);
const counters = (dry.match(/counters to restore: (.*)/) ?? [])[1] ?? "";

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Rhenium One — Test Report</title>
<style>
:root{--o:#FF6A00;--o2:#FF3D00;--c:#18212B;--g:#E9EDF0;--m:#5b6672;--ok:#1b7f3b;--bad:#d32f2f}
*{box-sizing:border-box}body{margin:0;font-family:system-ui,Segoe UI,Roboto,Arial,sans-serif;background:#f4f6f8;color:var(--c);font-size:14px;line-height:1.5}
header{background:var(--c);color:#fff;padding:28px 16px}header .in,main{max-width:1000px;margin:0 auto}
header h1{margin:0 0 4px;font-size:22px}header p{margin:0;color:#b8c2cc}.bar{height:3px;background:linear-gradient(90deg,var(--o),var(--o2))}
main{padding:20px 16px 48px}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:20px}
.card{background:#fff;border:1px solid var(--g);border-radius:10px;padding:14px}.k{font-size:12px;color:var(--m)}.v{font-size:24px;font-weight:700}
h2{font-size:16px;margin:28px 0 10px}table{width:100%;border-collapse:collapse;background:#fff;border:1px solid var(--g);border-radius:10px;overflow:hidden}
th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--g);vertical-align:top}th{background:var(--g);font-size:12px;color:var(--c)}
.p{color:var(--ok);font-weight:700}.f{color:var(--bad);font-weight:700}.d{color:var(--m);font-size:12.5px}.area td{background:#fafbfc;font-weight:600;color:var(--o)}
.note{background:#fff;border-left:4px solid var(--o);border-radius:6px;padding:12px 14px;margin:10px 0}.warn{border-color:var(--bad)}
code{background:var(--g);padding:1px 5px;border-radius:4px;font-size:12.5px}ul{margin:6px 0;padding-left:20px}
@media (max-width:600px){td:nth-child(3),th:nth-child(3){display:none}}
</style></head><body>
<header><div class="in"><h1>Rhenium One — End-to-end test report</h1>
<p>Run ${esc(r.runId)} · ${esc(new Date(r.finishedAt).toLocaleString("en-IN"))}${r.retestedAt ? ` · re-tested ${esc(new Date(r.retestedAt).toLocaleString("en-IN"))}` : ""} · local app (${esc(r.base)}) against the live Firebase project and Google Drive</p></div></header>
<div class="bar"></div>
<main>
<div class="cards">
<div class="card"><div class="k">Checks run</div><div class="v">${results.length}</div></div>
<div class="card"><div class="k">Passed</div><div class="v" style="color:var(--ok)">${passed}</div></div>
<div class="card"><div class="k">Failed</div><div class="v" style="color:${failed.length ? "var(--bad)" : "var(--ok)"}">${failed.length}</div></div>
<div class="card"><div class="k">Test users / roles</div><div class="v">5 / 4</div></div>
</div>

<h2>Issues found</h2>
<div class="note warn"><b>Security: non-GST records could be listed by users without non-GST permission.</b>
A user without the non-GST permission could fetch the full invoice or project list (bypassing the app's own GST filter) and receive non-GST records. The app's screens always filter, so normal use never showed them, but the database rules must refuse it.
<br><b>Fix:</b> the GST check in <code>firestore.rules</code> now compares the field directly, which Firestore enforces on lists. Checked: none of your real records lack the marker, so nothing legitimate is hidden.
<br><b>Status:</b> ${failed.some((x) => x.name.startsWith("Non-GST")) ? "fixed in code, <b>waiting for your OK to deploy</b> to Firebase; this check passes once deployed." : "deployed and re-tested — passes."}</div>
<div class="note"><b>Test script issue (not the app):</b> "my tasks" across projects failed on the first run because the test loaded a Firestore function incorrectly. Fixed in the test and re-tested — passes.</div>

<h2>Results</h2>
<table><thead><tr><th style="width:56px">Result</th><th>Check</th><th>Details</th></tr></thead><tbody>
${areas.map((a) => `<tr class="area"><td colspan="3">${esc(a)}</td></tr>` + results.filter((x) => x.area === a).map((x) => `<tr><td class="${x.ok ? "p" : "f"}">${x.ok ? "PASS" : "FAIL"}</td><td>${esc(x.name)}${x.retested ? ' <span class="d">(re-tested)</span>' : ""}</td><td class="d">${esc(x.detail ?? "")}</td></tr>`).join("")).join("")}
</tbody></table>

<h2>How it was tested</h2>
<ul>
<li>The app's own code (calculations, numbering, approvals, data saving) was run by a script signed in as each test user, so Firebase's security rules applied exactly as on the live site.</li>
<li>Server features were called over HTTP on the local app: user management, approvals, Google Drive upload/download, Google Doc creation, quotation release and PDF generation.</li>
<li>Real files and PDFs were created in your Google Drive under <code>RheniumOne/ZZ Test ${esc(r.runId)}</code>.</li>
<li>Your company details, approval rules, existing roles, users and accounts were read but not changed.</li>
</ul>

<h2>Not covered by this run</h2>
<ul>
<li>Clicking through the screens themselves (the pages were checked to load; the logic behind them was tested directly). Worth a short manual walk-through.</li>
<li>Installing on a phone, WhatsApp/email sharing, the camera, offline entry and later sync — these need a real device.</li>
<li>Editing a quotation inside Google Docs by hand before release.</li>
<li>Automatic monthly review creation (it depends on the review day in your company settings, which were left untouched) — the figures snapshot it uses was tested.</li>
<li>Approvals by a non-admin approver role: your approval rules route to Admin, and they weren't changed.</li>
</ul>

<h2>Test data created (to be removed on your command)</h2>
<table><thead><tr><th>What</th><th>Count</th></tr></thead><tbody>
${created.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join("")}
</tbody></table>
<p class="d">Number counters reset to their values before the test (so your first real invoice is still <code>…/001</code>): ${esc(counters)}</p>
<p class="d">Cleanup deletes the records and test users, resets the counters and moves the Drive files and folders to the Drive trash (recoverable for 30 days).</p>
</main></body></html>`;

fs.writeFileSync(path.join(OUT, "report.html"), html);
console.log(`report: ${path.join(OUT, "report.html")} (${passed}/${results.length} passed)`);
