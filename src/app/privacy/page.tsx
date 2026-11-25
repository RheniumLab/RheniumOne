import type { Metadata } from "next";

export const metadata: Metadata = { title: "Privacy policy — Rhenium One" };

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-2xl space-y-4 p-6 text-sm leading-6">
      <h1 className="text-xl font-semibold">Rhenium One — Privacy policy</h1>
      <p>
        Rhenium One is the internal business system of Rhenium Innovation Labs. It is used only by the company&apos;s own
        team members, who sign in with accounts created by the company administrator.
      </p>
      <h2 className="font-semibold">What data it holds</h2>
      <p>
        Business records entered by the team: clients, vendors, projects, quotations, invoices, payments, purchases,
        inventory, assets, meetings and related documents, plus each team member&apos;s name and email for sign-in.
      </p>
      <h2 className="font-semibold">Google Drive</h2>
      <p>
        With the company&apos;s permission, Rhenium One stores the PDFs and photos it creates in the company&apos;s own Google
        Drive, in a folder named &ldquo;RheniumOne&rdquo;. It uses the <code>drive.file</code> permission, so it can only
        see and manage files it created itself, not any other files in the Drive. Google user data is used only to store
        and show these company documents, and is not shared with anyone or used for any other purpose.
      </p>
      <h2 className="font-semibold">Where data is stored</h2>
      <p>
        Records are stored in Google Firebase (Cloud Firestore); files are stored in the company&apos;s Google Drive. Data
        is not sold or shared with third parties, and is not used for advertising.
      </p>
      <h2 className="font-semibold">Contact</h2>
      <p>For any question about this policy or to have data removed, contact the company administrator.</p>
    </main>
  );
}
