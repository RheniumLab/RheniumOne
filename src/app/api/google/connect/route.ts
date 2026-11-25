import { randomBytes } from "crypto";
import { adminDb, errorResponse, requireUser } from "@/lib/firebase-admin";
import { authUrl } from "@/lib/google-server";

export const runtime = "nodejs";

/** Admin starts connecting the company Google account. Returns the Google consent URL. */
export async function POST(req: Request) {
  try {
    const me = await requireUser(req, { admin: true });
    const state = randomBytes(24).toString("base64url");
    await adminDb().doc(`oauthState/${state}`).set({ uid: me.uid, exp: Date.now() + 10 * 60 * 1000 });
    return Response.json({ url: authUrl(req, state) });
  } catch (e) {
    return errorResponse(e);
  }
}
