# Rhenium One

The company's in-house ERP: cash flow, invoicing, projects, sales, BOMs, purchasing, inventory and assets, for GST and non-GST business. It runs as a web app and installs on phones as an app (PWA) with offline entry.

**Stack (all free tiers):** Next.js 15 on Vercel, Firebase Authentication and Cloud Firestore on the Spark (free) plan.

## Modules (all 23 built)

| # | Module | What it does |
|---|--------|--------------|
| 1–2 | Clients, vendors | Masters with tax, contacts, terms; auto-linked projects, quotations, invoices, dues, POs, bills, price history |
| 3–5 | Requirements → proposals → quotations | Proposals versioned R0, R1… with PDF; quotations with line items, discounts, BOM cost and margin, Google Doc, release to PDF, discount approval, one-click project |
| 6–8 | Projects, documents, product ideas | Money view (quoted, invoiced, received, dues, direct cost, profit), tasks board/list, comments, repos, document folders with versions, idea → requirement → project |
| 9–14 | BOMs, sourcing, POs/GRN, inventory, assets, challans | Multi-level EBOM/MBOM with revisions, vendor quotes, POs from BOM, goods receipt into stock, vendor bills, stock by location, required-assets priority list with funds check, challans with returns and e-way bill details |
| 15–19 | Invoices, payments & TDS, cash flow, accounts, claims | RN/FY/0001 and RN/NG/FY/0001 series, CGST/SGST/IGST, branded PDF, WhatsApp/email share, payments with TDS, ageing, 26AS tracking, cash wallets with confirmed handovers |
| 20–22 | Approvals, audit log, reports | Rule-based approvals (PO amount, claims, quotation discount %, invoice cancel, entry delete), full audit log, 14 reports with filters and Excel/PDF export |
| 23 | Meetings & MOM | Monthly review auto-created with agenda and figures snapshot, MOM PDF versions, action items in project tasks |

Also in place: admin-defined roles with view/create/edit/delete/approve per module, a separate non-GST permission (enforced in Firestore rules), auto codes and FY-wise document numbers, starting categories, first-admin setup, and offline entry on phones.

## Free-tier design notes

- **No Cloud Storage or Cloud Functions.** Neither is available on the Spark plan for new projects. Server work (logins, Google Drive, approvals, PDFs) runs in Next.js API routes on Vercel using `firebase-admin`.
- **Files in Google Drive.** All PDFs and photos are stored in the company Google Drive (15 GB free) under a **RheniumOne** folder, through a one-time OAuth connection with the `drive.file` scope (the app sees only files it creates). Photos taken offline stay on the phone and upload automatically when it is back online. PDFs are made by converting the document to a Google Doc and exporting it, so no paid PDF service is needed.
- **Firestore free quota:** 50k reads, 20k writes per day and 1 GiB stored, which is plenty for a small team.
- **Vercel Hobby** is free but limited to non-commercial use under Vercel's terms. An internal company tool may need the Pro plan; check before going live.
- **Not built (later phase per the requirements):** timesheets, payment reminders, bank reconciliation, AMC tracking, payroll, e-way bill API. If the same record is edited offline on two devices, the last sync wins (no conflict prompt yet).

## Setup

### 1. Firebase (free Spark plan)
1. Create a project at <https://console.firebase.google.com>. Analytics isn't needed.
2. **Authentication → Sign-in method →** enable **Email/Password**.
3. **Firestore Database →** create the database in production mode, region `asia-south1` (Mumbai).
4. **Project settings → Your apps →** add a **Web app** and copy its config.
5. **Project settings → Service accounts → Generate new private key.** Keep this file secret and never commit it.
6. Deploy the security rules and indexes:
   ```bash
   firebase login
   firebase use --add          # pick your project
   firebase deploy --only firestore
   ```

### 2. Google Drive (free)
1. Open <https://console.cloud.google.com> and select the Firebase project.
2. **APIs & Services → Library →** enable **Google Drive API**.
3. **APIs & Services → OAuth consent screen →** User type *External*, app name *Rhenium One*, add your email. Add the scope `.../auth/drive.file`. Then **Publish app** (In production) — otherwise Google expires the connection every 7 days. `drive.file` is a non-sensitive scope, so no Google review is needed.
4. **APIs & Services → Credentials → Create credentials → OAuth client ID →** *Web application*. Authorised redirect URIs: `http://localhost:3000/api/google/callback` and `https://<your-vercel-domain>/api/google/callback`.
5. Put the client ID and secret in `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` (`.env.local` and Vercel).
6. In the app: **Settings → Company → Connect Google Drive**, sign in with the company Google account.

### 3. Local run
```bash
cp .env.example .env.local   # fill in the values from steps 4–5, plus a random SETUP_KEY
npm install
npm run dev
```
Open <http://localhost:3000/setup>, create the admin using the `SETUP_KEY`, then add team members under **Settings → Users**. Each user gets a personal cash wallet automatically.

### 4. GitHub
Create an empty repository on GitHub, then:
```bash
git remote add origin https://github.com/<org>/rhenium-one.git
git push -u origin main
```

### 5. Vercel
1. Go to <https://vercel.com/new>, **Import** the GitHub repo. The framework is detected as Next.js.
2. Add every variable from `.env.local` under **Environment Variables**. Paste `FIREBASE_PRIVATE_KEY` with its `\n` sequences as-is.
3. Deploy. In Firebase, go to **Authentication → Settings → Authorized domains** and add your `*.vercel.app` domain.

Every push to `main` then redeploys automatically.

### Phones
Open the site in Chrome (Android) or Safari (iOS) and choose **Add to Home screen**. Expenses, cash entries, handovers and claims can be entered offline and sync when the phone is back online. Numbered documents (codes, invoices) need a connection, so two people never take the same number.

## Code map
- `src/lib/modules.ts`: the 23 modules and their areas
- `src/lib/permissions.ts`: role model and starting roles
- `src/lib/entities.ts`: field definitions that drive the generic list, form and detail pages
- `src/lib/data.ts`: create, update and soft delete with audit log and auto numbering
- `src/app/(app)/…`: pages; `[module]` serves any module defined in `entities.ts`
- `firestore.rules`: the access rules; this is the real enforcement layer
