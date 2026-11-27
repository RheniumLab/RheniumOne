import "server-only";
import { FieldValue } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";
import { adminDb } from "./firebase-admin";
import { can, seesMoney, seesNonGst, type Action, type Role } from "./permissions";
import type { ModuleKey } from "./modules";

/**
 * In-app and push notifications (no email, no SMS).
 * Each alert is saved in `notifications` for the recipient (bell / left bar)
 * and pushed to their installed app or browser through Firebase Cloud Messaging.
 */

export interface Member { uid: string; name: string; roleId: string; role: Role }

export async function team(): Promise<Member[]> {
  const [u, r] = await Promise.all([adminDb().collection("users").where("active", "==", true).get(), adminDb().collection("roles").get()]);
  const roles = new Map(r.docs.map((d) => [d.id, { id: d.id, ...d.data() } as Role]));
  return u.docs.filter((d) => roles.has(d.data().roleId)).map((d) => ({ uid: d.id, name: String(d.data().name ?? ""), roleId: d.data().roleId, role: roles.get(d.data().roleId)! }));
}

/** People who may see a record: module permission, plus money / non-GST visibility. */
export function who(members: Member[], o: { module: ModuleKey; action?: Action; money?: boolean; billingType?: unknown }) {
  return members
    .filter((m) => can(m.role, o.module, o.action ?? "view"))
    .filter((m) => !o.money || seesMoney(m.role))
    .filter((m) => o.billingType !== "nonGst" || seesNonGst(m.role))
    .map((m) => m.uid);
}

export const rupees = (n: unknown) => `₹${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

export interface Note { type: string; title: string; body: string; link: string }

/** Saves the notification for each recipient (except the person who caused it) and pushes it. */
export async function send(recipients: (string | null | undefined)[], n: Note, actor?: string) {
  const to = [...new Set(recipients.filter((x): x is string => Boolean(x) && x !== actor))];
  if (!to.length) return 0;
  const db = adminDb();
  const batch = db.batch();
  for (const uid of to)
    batch.set(db.collection("notifications").doc(), { ...n, to: uid, by: actor ?? null, read: false, at: FieldValue.serverTimestamp() });
  await batch.commit();
  await push(to, n).catch((e) => console.warn("push failed", e));
  return to.length;
}

async function push(to: string[], n: Note) {
  const db = adminDb();
  const tokens: { token: string; ref: FirebaseFirestore.DocumentReference }[] = [];
  for (let i = 0; i < to.length; i += 10) {
    const s = await db.collection("pushTokens").where("uid", "in", to.slice(i, i + 10)).get();
    s.docs.forEach((d) => tokens.push({ token: d.data().token, ref: d.ref }));
  }
  if (!tokens.length) return;
  const res = await getMessaging().sendEachForMulticast({
    tokens: tokens.map((t) => t.token),
    // Data-only: the app's service worker shows it (title, body, tap opens the link).
    webpush: { headers: { Urgency: "high", TTL: "86400" }, data: { title: n.title, body: n.body, link: n.link, type: n.type } },
  });
  // Forget devices that are no longer subscribed.
  await Promise.all(
    res.responses.map((r, i) =>
      !r.success && /registration-token-not-registered|invalid-registration-token|invalid-argument/.test(r.error?.code ?? "") ? tokens[i].ref.delete() : null,
    ),
  );
}
