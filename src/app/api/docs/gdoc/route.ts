import { FieldValue } from "firebase-admin/firestore";
import { adminDb, errorResponse, HttpError, requireUser } from "@/lib/firebase-admin";
import { createGoogleDoc, shareWith } from "@/lib/google-server";

export const runtime = "nodejs";

/**
 * Quotations are written in Google Docs (§5). Creates the quotation's Google
 * Doc from its current content (if it has none) and gives the requesting user
 * edit access. Returns the Doc URL.
 */
export async function POST(req: Request) {
  try {
    const me = await requireUser(req);
    if (!me.role?.isAdmin && !me.role?.perms?.quotations?.edit) throw new HttpError(403, "No permission to edit quotations");
    const { quotationId, html, name, folder } = await req.json();
    const ref = adminDb().collection("quotations").doc(quotationId);
    const q = (await ref.get()).data();
    if (!q) throw new HttpError(404, "Quotation not found");
    let docId = q.googleDocId as string | undefined;
    if (!docId) {
      if (!html) throw new HttpError(400, "html is required to create the Doc");
      docId = await createGoogleDoc(name, html, folder);
      await ref.update({ googleDocId: docId, updatedAt: FieldValue.serverTimestamp() });
    }
    if (me.user.email) await shareWith(docId, me.user.email, "writer").catch(() => {});
    return Response.json({ docId, url: `https://docs.google.com/document/d/${docId}/edit` });
  } catch (e) {
    return errorResponse(e);
  }
}
