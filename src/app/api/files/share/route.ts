import { errorResponse, HttpError, requireUser } from "@/lib/firebase-admin";
import { shareLink } from "@/lib/google-server";

export const runtime = "nodejs";

/** Makes a document PDF viewable by link, for sending by email or WhatsApp. */
export async function POST(req: Request) {
  try {
    await requireUser(req);
    const { driveId } = await req.json();
    if (!driveId) throw new HttpError(400, "driveId is required");
    return Response.json({ url: await shareLink(driveId) });
  } catch (e) {
    return errorResponse(e);
  }
}
