import "server-only";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

function app() {
  const existing = getApps()[0];
  if (existing) return existing;
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (!projectId || !clientEmail || !privateKey) {
    throw new Error(
      "Firebase Admin is not configured. Set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY.",
    );
  }
  return initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
}

export const adminAuth = () => getAuth(app());
export const adminDb = () => getFirestore(app());

/** Verifies the bearer token and returns the caller's uid and role. */
export async function requireUser(req: Request, opts: { admin?: boolean } = {}) {
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) throw new HttpError(401, "Not signed in");
  const decoded = await adminAuth().verifyIdToken(token);
  const userSnap = await adminDb().collection("users").doc(decoded.uid).get();
  const user = userSnap.data();
  if (!user || !user.active) throw new HttpError(403, "User is not active");
  const roleSnap = await adminDb().collection("roles").doc(user.roleId).get();
  const role = roleSnap.data();
  if (opts.admin && !role?.isAdmin) throw new HttpError(403, "Admin only");
  return { uid: decoded.uid, user, role };
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export function errorResponse(e: unknown) {
  const status = e instanceof HttpError ? e.status : 500;
  const message = e instanceof Error ? e.message : "Unexpected error";
  return Response.json({ error: message }, { status });
}
