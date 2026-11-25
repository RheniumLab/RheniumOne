import { errorResponse, HttpError, requireUser } from "@/lib/firebase-admin";
import { htmlToPdf, recordFile } from "@/lib/google-server";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Renders branded HTML to a PDF in Drive (invoices, proposals, MOMs, POs, challans). */
export async function POST(req: Request) {
  try {
    const me = await requireUser(req);
    const { html, name, folder, billingType, linked } = await req.json();
    if (!html || !name || !folder) throw new HttpError(400, "html, name and folder are required");
    const { driveId, size } = await htmlToPdf(name, html, folder);
    const fileId = await recordFile({ name: `${name}.pdf`, mime: "application/pdf", size, driveId, folder, billingType, linked, uid: me.uid });
    return Response.json({ driveId, fileId });
  } catch (e) {
    return errorResponse(e);
  }
}
