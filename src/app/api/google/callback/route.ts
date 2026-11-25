import { adminDb } from "@/lib/firebase-admin";
import { exchangeCode, folderFor } from "@/lib/google-server";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const back = (msg: string) => Response.redirect(new URL(`/settings?tab=company&google=${encodeURIComponent(msg)}`, url.origin), 302);
  try {
    const state = url.searchParams.get("state") ?? "";
    const code = url.searchParams.get("code");
    if (url.searchParams.get("error")) return back(url.searchParams.get("error")!);
    const ref = adminDb().doc(`oauthState/${state}`);
    const s = await ref.get();
    await ref.delete().catch(() => {});
    if (!state || !s.exists || s.data()!.exp < Date.now() || !code) return back("Link expired, try again");
    await exchangeCode(req, code);
    await folderFor(""); // creates the RheniumOne folder now
    return back("connected");
  } catch (e) {
    return back(e instanceof Error ? e.message : "failed");
  }
}
