/** Makes a sample invoice PDF (in the e2e test Drive folder) to check layout, legal name, logo and bank details. */
import fs from "fs";
import path from "path";
import { signInWithEmailAndPassword } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { commercialDocHtml } from "@/lib/doc-html";
import type { CompanySettings } from "@/lib/business";
import { aauth, adb, api, BASE, OUT, saveManifest, type Manifest } from "./lib";
(async () => {
  const m: Manifest = JSON.parse(fs.readFileSync(path.join(OUT, "manifest.json"), "utf8"));
  const email = m.emails.find((e) => e.includes("zz-test-admin-"))!;
  const u = await aauth.getUserByEmail(email);
  const pass = "Zz!s-" + Date.now();
  await aauth.updateUser(u.uid, { password: pass });
  await signInWithEmailAndPassword(auth(), email, pass);
  const c = ((await adb.doc("settings/company").get()).data() ?? {}) as CompanySettings;
  const logo = "data:image/png;base64," + fs.readFileSync("public/brand/logo.png").toString("base64");
  const html = commercialDocHtml({
    company: { ...c, logoDataUrl: logo }, title: "Tax Invoice",
    party: { name: "ZZ Test Client Pvt Ltd", address: "Sample address, Bengaluru", gstin: "29AAAAA0000A1Z5", state: c.state },
    meta: [["Invoice no.", "RIL/261126/001 (SAMPLE)"], ["Date", "26 Nov 2026"], ["Due date", "26 Dec 2026"], ["Place of supply", c.state]],
    lines: [
      { description: "Control panel assembly", hsn: "8537", qty: 1, unit: "Nos", rate: 125000, taxRate: 18 },
      { description: "Installation & commissioning", hsn: "9987", qty: 1, unit: "Job", rate: 15000, discType: "pct", disc: 10, taxRate: 18 },
    ],
    adj: { roundOff: true }, gst: true, intraState: true, terms: "Payment within 30 days.", showBank: true,
  });
  const r = await api<{ driveId: string; error?: string }>("/api/docs/pdf", "POST", { html, name: "ZZ Test SAMPLE invoice layout", folder: `ZZ Test ${m.runId}/Invoices` });
  if (r.status !== 200) throw new Error(JSON.stringify(r.json));
  m.driveIds.push(r.json.driveId); saveManifest(m);
  const pdf = Buffer.from(await (await fetch(`${BASE}/api/files/${r.json.driveId}`, { headers: { authorization: `Bearer ${await auth().currentUser!.getIdToken()}` } })).arrayBuffer());
  const out = path.join(OUT, "sample-invoice.pdf");
  fs.writeFileSync(out, pdf);
  const s = pdf.toString("latin1");
  console.log(`PDF ${Math.round(pdf.length / 1024)} KB, images embedded: ${(s.match(/\/Subtype\s*\/Image/g) ?? []).length}, saved ${out}`);
  process.exit(0);
})();
