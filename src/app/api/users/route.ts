import { FieldValue } from "firebase-admin/firestore";
import { adminAuth, adminDb, errorResponse, HttpError, requireUser } from "@/lib/firebase-admin";

export const runtime = "nodejs";

function audit(uid: string, userName: string, action: string, docId: string, before: unknown, after: unknown) {
  return adminDb().collection("auditLog").add({
    action, collection: "users", docId, uid, userName, at: FieldValue.serverTimestamp(), before: before ?? null, after: after ?? null,
  });
}

/** Admin creates a team member: login, profile and personal cash wallet (§2). */
export async function POST(req: Request) {
  try {
    const me = await requireUser(req, { admin: true });
    const { name, email, password, roleId, phone } = await req.json();
    if (!name || !email || !password || !roleId) throw new HttpError(400, "Name, email, password and role are required");
    if (String(password).length < 8) throw new HttpError(400, "Password must be at least 8 characters");
    const role = await adminDb().collection("roles").doc(roleId).get();
    if (!role.exists) throw new HttpError(400, "Unknown role");

    const u = await adminAuth().createUser({ email, password, displayName: name });
    const db = adminDb();
    const batch = db.batch();
    const profile = { name, email, phone: phone ?? null, roleId, active: true, createdAt: FieldValue.serverTimestamp() };
    batch.set(db.collection("users").doc(u.uid), profile);
    batch.set(db.collection("accounts").doc(), { name: `Cash — ${name}`, kind: "cash", holderId: u.uid, openingBalance: 0, active: true, createdAt: FieldValue.serverTimestamp() });
    await batch.commit();
    await audit(me.uid, me.user.name, "create", u.uid, null, { name, email, roleId });
    return Response.json({ uid: u.uid });
  } catch (e) {
    return errorResponse(e);
  }
}

/** Admin changes a user's role, active flag, name or password. */
export async function PATCH(req: Request) {
  try {
    const me = await requireUser(req, { admin: true });
    const { uid, roleId, active, name, password } = await req.json();
    if (!uid) throw new HttpError(400, "uid is required");
    if (uid === me.uid && (active === false || (roleId && roleId !== me.user.roleId)))
      throw new HttpError(400, "You can’t deactivate yourself or change your own role");
    const ref = adminDb().collection("users").doc(uid);
    const before = (await ref.get()).data();
    if (!before) throw new HttpError(404, "User not found");

    const changes: Record<string, unknown> = {};
    if (roleId !== undefined) changes.roleId = roleId;
    if (active !== undefined) changes.active = Boolean(active);
    if (name !== undefined) changes.name = name;
    const authChanges: Record<string, unknown> = {};
    if (active !== undefined) authChanges.disabled = !active;
    if (name) authChanges.displayName = name;
    if (password) {
      if (String(password).length < 8) throw new HttpError(400, "Password must be at least 8 characters");
      authChanges.password = password;
    }
    if (Object.keys(authChanges).length) await adminAuth().updateUser(uid, authChanges);
    if (Object.keys(changes).length) await ref.update(changes);
    await audit(me.uid, me.user.name, "edit", uid,
      Object.fromEntries(Object.keys(changes).map((k) => [k, before[k] ?? null])),
      { ...changes, ...(password ? { password: "(changed)" } : {}) });
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
