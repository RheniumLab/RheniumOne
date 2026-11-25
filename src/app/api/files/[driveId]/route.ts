import { adminDb, errorResponse, HttpError, requireUser } from "@/lib/firebase-admin";
import { download } from "@/lib/google-server";

export const runtime = "nodejs";

/** Streams a Drive file to a signed-in user. Non-GST files need the non-GST permission. */
export async function GET(req: Request, { params }: { params: Promise<{ driveId: string }> }) {
  try {
    const { driveId } = await params;
    const me = await requireUser(req);
    const rec = await adminDb().collection("files").where("driveId", "==", driveId).limit(1).get();
    if (rec.empty) throw new HttpError(404, "File not found");
    const f = rec.docs[0].data();
    const seesNonGst = me.role?.isAdmin || me.role?.nonGst;
    if (f.billingType === "nonGst" && !seesNonGst && f.uid !== me.uid) throw new HttpError(403, "No access to non-GST files");
    const { name, mime, body } = await download(driveId);
    return new Response(body, {
      headers: { "content-type": mime, "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(name)}`, "cache-control": "private, max-age=300" },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
