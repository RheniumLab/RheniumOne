import { FieldValue } from "firebase-admin/firestore";
import { adminAuth, adminDb, errorResponse, HttpError } from "@/lib/firebase-admin";
import { defaultRoles } from "@/lib/permissions";
import { DEFAULT_CATEGORIES } from "@/lib/seed";

export const runtime = "nodejs";

async function hasUsers() {
  const s = await adminDb().collection("users").limit(1).get();
  return !s.empty;
}

/** Whether first-time setup is still needed. */
export async function GET() {
  try {
    return Response.json({ needed: !(await hasUsers()) });
  } catch (e) {
    return errorResponse(e);
  }
}

/**
 * First-time setup: creates the admin user, the starting roles and categories.
 * Works only while there are no users, and needs SETUP_KEY from the server env.
 */
export async function POST(req: Request) {
  try {
    const { name, email, password, setupKey } = await req.json();
    if (!process.env.SETUP_KEY || setupKey !== process.env.SETUP_KEY) throw new HttpError(403, "Setup key is wrong");
    if (await hasUsers()) throw new HttpError(409, "Setup is already done");
    if (!name || !email || !password || String(password).length < 8) throw new HttpError(400, "Name, email and a password of 8+ characters are required");

    const db = adminDb();
    const batch = db.batch();
    for (const r of defaultRoles()) {
      const { id, ...rest } = r;
      batch.set(db.collection("roles").doc(id), rest);
    }
    for (const group of DEFAULT_CATEGORIES)
      for (const n of group.names)
        batch.set(db.collection("categories").doc(), { type: group.type, name: n, active: true, createdAt: FieldValue.serverTimestamp() });

    const user = await adminAuth().createUser({ email, password, displayName: name });
    batch.set(db.collection("users").doc(user.uid), { name, email, roleId: "admin", active: true, createdAt: FieldValue.serverTimestamp() });
    batch.set(db.collection("accounts").doc(), { name: `Cash — ${name}`, kind: "cash", holderId: user.uid, openingBalance: 0, active: true, createdAt: FieldValue.serverTimestamp() });
    batch.set(db.collection("settings").doc("company"), { name: "Rhenium", gstInvoicePrefix: "RN", nonGstInvoicePrefix: "RN/NG" });
    await batch.commit();
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
