# Rhenium One

The company's in-house ERP: cash flow, invoicing, projects, sales, BOMs, purchasing, inventory and assets, for GST and non-GST business. It runs as a web app and installs on phones as an app (PWA) with offline entry.

**Stack (all free tiers):** Next.js 15 on Vercel, Firebase Authentication and Cloud Firestore on the Spark (free) plan.

## Build status

| # | Module | Status |
|---|--------|--------|
| 1–2 | Client master, Vendor master | ✅ |
| 3 | Requirements (client and internal) | ✅ incl. requirement → project |
| 4–5 | Proposals, Quotations | Next phase |
| 6 | Projects: money view, task board and list, comments, repo links | ✅ |
| 7 | Project documents | Next phase (repo links done) |
| 8 | Product ideas (idea → requirement → project) | ✅ |
| 9–11, 14 | BOMs, sourcing, POs/GRN, challans | Next phase |
| 12–13 | Inventory items, assets | ✅ basic register |
| 15–16 | Invoicing, TDS | Next phase |
| 17 | Cash flow (mandatory bill, GST purchase fields, offline) | ✅ |
| 18 | Accounts and cash custody (wallets, transfers, handover confirmation) | ✅ |
| 19 | Expense claims (submit → approve → pay out to cash flow) | ✅ |
| 20 | Approval rules | Next phase (claims approval done) |
| 21 | Audit log (every create, edit, delete and login, soft delete) | ✅ |
| 22 | Dashboard | ✅ cash position and projects. Reports are next phase |
| 23 | Meetings and MOM | ✅ basic record with action items |

Also in place: admin-defined roles with view/create/edit/delete/approve per module, a separate non-GST permission (enforced in Firestore rules), auto codes (RC-0001, RP-0001 …), the starting categories, and first-admin setup.

## Free-tier design notes

- **No Cloud Storage or Cloud Functions.** On the Spark plan, Cloud Functions isn't available and new projects can't create a Storage bucket. Admin tasks such as creating logins run in Next.js API routes on Vercel using `firebase-admin`. Bill photos and PDFs are compressed and stored in Firestore (`attachments`, 1 GiB free). Because Firestore queues writes offline, a bill photo taken without signal syncs later with its entry. Large project documents (drawings, design files) will go to the company Google Drive in the documents phase.
- **Firestore free quota:** 50k reads, 20k writes per day and 1 GiB stored. That is plenty for a small team.
- **Vercel Hobby** is free but limited to non-commercial use under Vercel's terms. An internal company tool may need the Pro plan; check before going live. The app runs unchanged on any Node host if needed.

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

### 2. Local run
```bash
cp .env.example .env.local   # fill in the values from steps 4–5, plus a random SETUP_KEY
npm install
npm run dev
```
Open <http://localhost:3000/setup>, create the admin using the `SETUP_KEY`, then add team members under **Settings → Users**. Each user gets a personal cash wallet automatically.

### 3. GitHub
Create an empty repository on GitHub, then:
```bash
git remote add origin https://github.com/<org>/rhenium-one.git
git push -u origin main
```

### 4. Vercel
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
