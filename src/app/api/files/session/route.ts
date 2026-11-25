import { errorResponse, HttpError, requireUser } from "@/lib/firebase-admin";
import { startResumable } from "@/lib/google-server";

export const runtime = "nodejs";

/** Starts a resumable Drive upload so the browser can send large files straight to Google. */
export async function POST(req: Request) {
  try {
    await requireUser(req);
    const { name, mime, size, folder } = await req.json();
    if (!name || !size) throw new HttpError(400, "name and size are required");
    if (size > 100 * 1024 * 1024) throw new HttpError(400, "Files over 100 MB are not allowed");
    const origin = req.headers.get("origin") || new URL(req.url).origin;
    const uploadUrl = await startResumable(name, mime, size, folder || "Misc", origin);
    return Response.json({ uploadUrl });
  } catch (e) {
    return errorResponse(e);
  }
}
