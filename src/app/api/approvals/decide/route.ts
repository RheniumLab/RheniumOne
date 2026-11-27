import { FieldValue } from "firebase-admin/firestore";
import { adminDb, errorResponse, HttpError, requireUser } from "@/lib/firebase-admin";
import { send } from "@/lib/notify-server";

export const runtime = "nodejs";

type Effects = { col: string; approve: (a: Approval, me: string) => Record<string, unknown>; reject: (a: Approval, comment: string) => Record<string, unknown> };
interface Approval { type: string; col: string; docId: string; approverRole: string; requestedBy: string; status: string }

/** What approving or rejecting each document type does (§10.1). Fixed on the server. */
const EFFECTS: Record<string, Effects> = {
  po: { col: "pos", approve: () => ({ status: "Approved" }), reject: () => ({ status: "Rejected" }) },
  claim: { col: "claims", approve: (_a, me) => ({ status: "approved", approvedBy: me }), reject: (_a, c) => ({ status: "rejected", rejectReason: c }) },
  quotationDiscount: { col: "quotations", approve: () => ({ "approval.status": "approved" }), reject: () => ({ "approval.status": "rejected" }) },
  invoiceCancel: { col: "invoices", approve: () => ({ status: "Cancelled", cancelledAt: new Date().toISOString() }), reject: () => ({ cancelRequested: false }) },
  entryDelete: {
    col: "entries",
    approve: (a) => ({ deleted: true, deletedAt: FieldValue.serverTimestamp(), deletedBy: a.requestedBy, status: "approved" }),
    reject: () => ({ status: "approved", deleteRequested: false }),
  },
};

export async function POST(req: Request) {
  try {
    const me = await requireUser(req);
    const { approvalId, decision, comment } = await req.json();
    if (decision !== "approve" && decision !== "reject") throw new HttpError(400, "decision must be approve or reject");
    const db = adminDb();
    const ref = db.collection("approvals").doc(approvalId);

    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const a = snap.data() as Approval | undefined;
      if (!a) throw new HttpError(404, "Approval not found");
      if (a.status !== "pending") throw new HttpError(409, "Already decided");
      if (!me.role?.isAdmin && me.user.roleId !== a.approverRole) throw new HttpError(403, "This approval is for another role");
      if (a.requestedBy === me.uid && !me.role?.isAdmin) throw new HttpError(403, "You can’t approve your own request");
      const fx = EFFECTS[a.type];
      if (!fx || fx.col !== a.col) throw new HttpError(400, "Unknown approval type");
      const target = db.collection(a.col).doc(a.docId);
      const changes = decision === "approve" ? fx.approve(a, me.uid) : fx.reject(a, comment ?? "");
      tx.update(target, { ...changes, pendingApproval: null, updatedAt: FieldValue.serverTimestamp(), updatedBy: me.uid });
      tx.update(ref, { status: decision === "approve" ? "approved" : "rejected", decidedBy: me.uid, decidedByName: me.user.name, comment: comment ?? "", decidedAt: FieldValue.serverTimestamp() });
      tx.set(db.collection("auditLog").doc(), {
        action: decision, collection: a.col, docId: a.docId, uid: me.uid, userName: me.user.name,
        at: FieldValue.serverTimestamp(), before: { approval: a.type }, after: { ...Object.fromEntries(Object.entries(changes).map(([k, v]) => [k, v instanceof FieldValue ? "(now)" : v])), comment: comment ?? "" },
      });
    });
    // Tell the requester (in-app + push).
    const a = (await ref.get()).data();
    if (a)
      await send([a.requestedBy], {
        type: "approval.decided",
        title: decision === "approve" ? "Approved" : "Rejected",
        body: `${a.summary}${comment ? ` — “${comment}”` : ""} · by ${me.user.name}`,
        link: a.link || "/approvals",
      }, me.uid).catch(() => 0);
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
