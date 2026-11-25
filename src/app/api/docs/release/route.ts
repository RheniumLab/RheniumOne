import { FieldValue } from "firebase-admin/firestore";
import { adminDb, errorResponse, HttpError, requireUser } from "@/lib/firebase-admin";
import { exportPdf, recordFile, uploadBytes } from "@/lib/google-server";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Releasing a quotation (status → Sent): converts its Google Doc to PDF, saves
 * it in the client's folder (and the project's, if linked) and keeps each
 * release as a version (§5).
 */
export async function POST(req: Request) {
  try {
    const me = await requireUser(req);
    if (!me.role?.isAdmin && !me.role?.perms?.quotations?.edit) throw new HttpError(403, "No permission to release quotations");
    const { quotationId, clientFolder } = await req.json();
    const ref = adminDb().collection("quotations").doc(quotationId);
    const q = (await ref.get()).data();
    if (!q) throw new HttpError(404, "Quotation not found");
    if (!q.googleDocId) throw new HttpError(400, "Create the Google Doc first");
    if (q.approval?.status === "pending") throw new HttpError(409, "The discount is waiting for approval");
    const pdf = await exportPdf(q.googleDocId);
    const name = `${q.number} R${q.rev ?? 0}.pdf`;
    const folder = clientFolder || "Quotations";
    const driveId = await uploadBytes(name, "application/pdf", pdf, folder);
    const fileId = await recordFile({ name, mime: "application/pdf", size: pdf.length, driveId, folder, billingType: q.billingType, linked: { col: "quotations", id: quotationId }, uid: me.uid });
    // One docs record, linked to both client and project, shows in both document areas.
    await adminDb().collection("docs").add({
      name, folder: "Quotations", clientId: q.clientId ?? null, projectId: q.projectId ?? null,
      linked: { col: "quotations", id: quotationId }, billingType: q.billingType ?? "gst",
      versions: [{ fileId, driveId, uid: me.uid, name: me.user.name, at: new Date().toISOString(), size: pdf.length, mime: "application/pdf" }],
      createdAt: FieldValue.serverTimestamp(), createdBy: me.uid,
    });
    await ref.update({
      status: "Sent",
      releases: FieldValue.arrayUnion({ rev: q.rev ?? 0, driveId, fileId, at: new Date().toISOString(), by: me.uid }),
      updatedAt: FieldValue.serverTimestamp(),
    });
    await adminDb().collection("auditLog").add({ action: "release", collection: "quotations", docId: quotationId, uid: me.uid, userName: me.user.name, at: FieldValue.serverTimestamp(), before: { status: q.status }, after: { status: "Sent", pdf: name } });
    return Response.json({ driveId, fileId });
  } catch (e) {
    return errorResponse(e);
  }
}
