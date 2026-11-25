import "server-only";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb, HttpError } from "./firebase-admin";

/**
 * Google Drive access for Rhenium One.
 *
 * The company Google account is connected once by the admin (OAuth, scope
 * `drive.file`: the app sees only files it created). Every PDF and photo is
 * stored under a "RheniumOne" folder in that account's My Drive.
 */
const SCOPES = ["https://www.googleapis.com/auth/drive.file", "openid", "email"];
const ROOT_FOLDER = "RheniumOne";
const DRIVE = "https://www.googleapis.com/drive/v3";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3";

export function redirectUri(req: Request) {
  const origin = process.env.APP_URL || new URL(req.url).origin;
  return `${origin}/api/google/callback`;
}

export function authUrl(req: Request, state: string) {
  const p = new URLSearchParams({
    client_id: must("GOOGLE_CLIENT_ID"),
    redirect_uri: redirectUri(req),
    response_type: "code",
    scope: SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}

function must(name: string) {
  const v = process.env[name];
  if (!v) throw new HttpError(500, `${name} is not set on the server`);
  return v;
}

export async function exchangeCode(req: Request, code: string) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: must("GOOGLE_CLIENT_ID"),
      client_secret: must("GOOGLE_CLIENT_SECRET"),
      redirect_uri: redirectUri(req),
      grant_type: "authorization_code",
    }),
  });
  const j = await res.json();
  if (!res.ok || !j.refresh_token) throw new HttpError(400, j.error_description || "Google did not return a refresh token");
  let email: string | null = null;
  if (j.id_token) {
    try {
      email = JSON.parse(Buffer.from(j.id_token.split(".")[1], "base64url").toString()).email ?? null;
    } catch {}
  }
  await adminDb().doc("secrets/google").set({ refreshToken: j.refresh_token, email, connectedAt: FieldValue.serverTimestamp() });
  await adminDb().doc("settings/google").set({ connected: true, email, rootFolderId: null }, { merge: true });
  cached = { token: j.access_token, exp: Date.now() + (j.expires_in - 60) * 1000 };
}

let cached: { token: string; exp: number } | null = null;

export async function accessToken() {
  if (cached && cached.exp > Date.now()) return cached.token;
  const s = await adminDb().doc("secrets/google").get();
  const refresh = s.data()?.refreshToken;
  if (!refresh) throw new HttpError(409, "Google Drive is not connected. The admin can connect it under Settings → Company.");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refresh,
      client_id: must("GOOGLE_CLIENT_ID"),
      client_secret: must("GOOGLE_CLIENT_SECRET"),
      grant_type: "refresh_token",
    }),
  });
  const j = await res.json();
  if (!res.ok) throw new HttpError(502, `Google token refresh failed: ${j.error_description || j.error}`);
  cached = { token: j.access_token, exp: Date.now() + (j.expires_in - 60) * 1000 };
  return cached.token;
}

async function g(url: string, init: RequestInit = {}) {
  const token = await accessToken();
  const res = await fetch(url, { ...init, headers: { authorization: `Bearer ${token}`, ...(init.headers ?? {}) } });
  if (!res.ok) {
    const text = await res.text();
    throw new HttpError(502, `Google Drive error ${res.status}: ${text.slice(0, 300)}`);
  }
  return res;
}

const safe = (s: string) => s.replace(/[\\/:*?"<>|]+/g, "-").trim().slice(0, 120) || "Untitled";

async function findOrCreateFolder(name: string, parent: string | null) {
  const q = [`mimeType='application/vnd.google-apps.folder'`, `name='${name.replace(/'/g, "\\'")}'`, `trashed=false`, parent ? `'${parent}' in parents` : `'root' in parents`].join(" and ");
  const r = await (await g(`${DRIVE}/files?q=${encodeURIComponent(q)}&fields=files(id)&spaces=drive`)).json();
  if (r.files?.[0]) return r.files[0].id as string;
  const created = await (
    await g(`${DRIVE}/files?fields=id`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder", parents: parent ? [parent] : undefined }),
    })
  ).json();
  return created.id as string;
}

/** Folder id for a path like "Projects/RP-0001 Pump/Drawings" under RheniumOne. Cached in Firestore. */
export async function folderFor(path: string) {
  const parts = [ROOT_FOLDER, ...path.split("/").map(safe).filter(Boolean)];
  const key = parts.join("/");
  const cacheRef = adminDb().collection("driveFolders").doc(Buffer.from(key).toString("base64url").slice(0, 1400));
  const hit = await cacheRef.get();
  if (hit.exists) return hit.data()!.id as string;
  let parent: string | null = null;
  for (const p of parts) parent = await findOrCreateFolder(p, parent);
  await cacheRef.set({ id: parent, path: key });
  return parent!;
}

/** Starts a resumable upload; the browser then PUTs the bytes straight to Google. */
export async function startResumable(name: string, mime: string, size: number, folder: string, origin: string) {
  const parent = await folderFor(folder);
  const res = await g(`${UPLOAD}/files?uploadType=resumable&fields=id,name,mimeType,size`, {
    method: "POST",
    headers: {
      "content-type": "application/json; charset=UTF-8",
      "x-upload-content-type": mime || "application/octet-stream",
      "x-upload-content-length": String(size),
      origin,
    },
    body: JSON.stringify({ name: safe(name), parents: [parent] }),
  });
  const url = res.headers.get("location");
  if (!url) throw new HttpError(502, "Google did not return an upload URL");
  return url;
}

export async function uploadBytes(name: string, mime: string, data: Buffer | Uint8Array, folder: string) {
  const parent = await folderFor(folder);
  const boundary = "r1" + Math.random().toString(36).slice(2);
  const meta = JSON.stringify({ name: safe(name), parents: [parent] });
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\ncontent-type: ${mime}\r\n\r\n`),
    Buffer.from(data),
    Buffer.from(`\r\n--${boundary}--`),
  ]);
  const r = await (await g(`${UPLOAD}/files?uploadType=multipart&fields=id,size`, { method: "POST", headers: { "content-type": `multipart/related; boundary=${boundary}` }, body })).json();
  return r.id as string;
}

export async function download(driveId: string) {
  const meta = await (await g(`${DRIVE}/files/${driveId}?fields=name,mimeType`)).json();
  const res = await g(`${DRIVE}/files/${driveId}?alt=media`);
  return { name: meta.name as string, mime: meta.mimeType as string, body: res.body! };
}

/** Converts HTML to a Google Doc. Returns the Doc id. */
export async function createGoogleDoc(name: string, html: string, folder: string) {
  const parent = await folderFor(folder);
  const boundary = "r1" + Math.random().toString(36).slice(2);
  const meta = JSON.stringify({ name: safe(name), parents: [parent], mimeType: "application/vnd.google-apps.document" });
  const body = `--${boundary}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\ncontent-type: text/html; charset=UTF-8\r\n\r\n${html}\r\n--${boundary}--`;
  const r = await (await g(`${UPLOAD}/files?uploadType=multipart&fields=id`, { method: "POST", headers: { "content-type": `multipart/related; boundary=${boundary}` }, body })).json();
  return r.id as string;
}

export async function exportPdf(docId: string) {
  const res = await g(`${DRIVE}/files/${docId}/export?mimeType=application/pdf`);
  return Buffer.from(await res.arrayBuffer());
}

export async function trash(driveId: string) {
  await g(`${DRIVE}/files/${driveId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ trashed: true }) });
}

/** HTML → Google Doc → PDF stored in Drive. The temporary Doc is removed. */
export async function htmlToPdf(name: string, html: string, folder: string) {
  const tmp = await createGoogleDoc(`${name} (temp)`, html, "_tmp");
  try {
    const pdf = await exportPdf(tmp);
    const id = await uploadBytes(name.endsWith(".pdf") ? name : `${name}.pdf`, "application/pdf", pdf, folder);
    return { driveId: id, size: pdf.length };
  } finally {
    await trash(tmp).catch(() => {});
  }
}

export async function shareWith(driveId: string, email: string, role: "reader" | "writer") {
  await g(`${DRIVE}/files/${driveId}/permissions?sendNotificationEmail=false`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "user", role, emailAddress: email }),
  });
}

/** Makes a file viewable by anyone with the link (for WhatsApp / email sharing). */
export async function shareLink(driveId: string) {
  await g(`${DRIVE}/files/${driveId}/permissions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "anyone", role: "reader" }),
  });
  const r = await (await g(`${DRIVE}/files/${driveId}?fields=webViewLink`)).json();
  return r.webViewLink as string;
}

/** Records a server-created file in the `files` collection (same shape the client uses). */
export async function recordFile(f: { name: string; mime: string; size: number; driveId: string; folder: string; billingType?: string; linked?: { col: string; id: string } | null; uid: string }) {
  const ref = adminDb().collection("files").doc();
  await ref.set({ ...f, billingType: f.billingType ?? "gst", linked: f.linked ?? null, status: "uploaded", at: FieldValue.serverTimestamp() });
  return ref.id;
}
