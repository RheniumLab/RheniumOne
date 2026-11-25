import { errorResponse, HttpError, requireUser } from "@/lib/firebase-admin";
import { uploadBytes } from "@/lib/google-server";

export const runtime = "nodejs";

/** Fallback upload through the server (files up to ~4 MB, Vercel's request limit). */
export async function POST(req: Request) {
  try {
    await requireUser(req);
    const form = await req.formData();
    const file = form.get("file");
    const folder = String(form.get("folder") || "Misc");
    if (!(file instanceof File)) throw new HttpError(400, "file is required");
    const driveId = await uploadBytes(file.name, file.type || "application/octet-stream", Buffer.from(await file.arrayBuffer()), folder);
    return Response.json({ driveId });
  } catch (e) {
    return errorResponse(e);
  }
}
