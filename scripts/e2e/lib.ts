/**
 * End-to-end test helpers for Rhenium One.
 *
 * Runs the app's own library code (src/lib) with the Firebase client SDK,
 * signed in as test users, against the real project, plus the app's HTTP API
 * on the local dev server. Every test user / role is named "ZZ Test …" and
 * everything created is recorded in scripts/e2e/.out/manifest.json for cleanup.
 */
import fs from "fs";
import path from "path";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { signInWithEmailAndPassword, signOut } from "firebase/auth";
import { waitForPendingWrites } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";

export const BASE = process.env.E2E_BASE ?? "http://localhost:3000";
export const OUT = path.join(process.cwd(), "scripts", "e2e", ".out");
fs.mkdirSync(OUT, { recursive: true });

// ---- Admin SDK (setup, verification, cleanup only) -------------------
if (!getApps().length)
  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID!,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL!,
      privateKey: process.env.FIREBASE_PRIVATE_KEY!.replace(/\\n/g, "\n"),
    }),
  });
export const adb = getFirestore();
export const aauth = getAuth();

// ---- Manifest ----------------------------------------------------------
export interface Manifest {
  runId: string;
  startedAt: string;
  uids: string[];
  roles: string[];
  emails: string[];
  counters: Record<string, number>;
  driveFoldersBefore: string[];
  driveIds: string[];
  notes: string[];
}
export const MANIFEST = path.join(OUT, "manifest.json");
export function saveManifest(m: Manifest) {
  fs.writeFileSync(MANIFEST, JSON.stringify(m, null, 2));
}

// ---- Users -------------------------------------------------------------
export interface TestUser { key: string; uid: string; email: string; password: string; name: string; roleId: string }
export const users: Record<string, TestUser> = {};
let current: string | null = null;

export async function as(key: string) {
  if (current === key) return users[key];
  await settle();
  if (auth().currentUser) await signOut(auth());
  const u = users[key];
  await signInWithEmailAndPassword(auth(), u.email, u.password);
  current = key;
  return u;
}

/** Waits until queued (non-awaited) client writes reach the server. */
export async function settle() {
  if (auth().currentUser) await waitForPendingWrites(db());
}

export async function token() {
  return auth().currentUser!.getIdToken();
}

export async function api<T = Record<string, unknown>>(p: string, method = "GET", body?: unknown, opts: { auth?: boolean } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json", origin: BASE };
  if (opts.auth !== false && auth().currentUser) headers.authorization = `Bearer ${await token()}`;
  const res = await fetch(BASE + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json: unknown = null;
  try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 200) }; }
  return { status: res.status, json: json as T };
}

// ---- Test runner -------------------------------------------------------
export interface Result { area: string; name: string; ok: boolean; ms: number; detail?: string }
export const results: Result[] = [];
let area = "General";
export const section = (a: string) => { area = a; console.log(`\n== ${a}`); };

export async function test(name: string, fn: () => Promise<unknown>) {
  const t0 = Date.now();
  try {
    const detail = await fn();
    results.push({ area, name, ok: true, ms: Date.now() - t0, detail: typeof detail === "string" ? detail : undefined });
    console.log(`  PASS ${name}${typeof detail === "string" ? ` — ${detail}` : ""}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    results.push({ area, name, ok: false, ms: Date.now() - t0, detail: msg });
    console.log(`  FAIL ${name} — ${msg}`);
  }
}

export function eq<T>(actual: T, expected: T, what = "value") {
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${what}: expected ${b}, got ${a}`);
}
export function near(actual: number, expected: number, what = "value", eps = 0.011) {
  if (Math.abs(actual - expected) > eps) throw new Error(`${what}: expected ${expected}, got ${actual}`);
}
export function ok(cond: unknown, what: string) {
  if (!cond) throw new Error(what);
}

/** Expects a Firestore operation to be refused by the security rules. */
export async function denied(fn: () => Promise<unknown>, what: string) {
  try {
    await fn();
  } catch (e) {
    const code = (e as { code?: string }).code ?? "";
    if (code.includes("permission-denied")) return `denied (${what})`;
    throw new Error(`${what}: expected permission-denied, got ${code || (e as Error).message}`);
  }
  throw new Error(`${what}: expected permission-denied, but it was allowed`);
}

export async function adoc(col: string, id: string) {
  const s = await adb.collection(col).doc(id).get();
  return s.exists ? ({ id: s.id, ...s.data() } as Record<string, unknown> & { id: string }) : null;
}

/** Polls (admin) until a document matches, for writes that are queued client-side. */
export async function until(col: string, id: string, check: (d: Record<string, unknown>) => boolean, what: string, ms = 15000) {
  const t0 = Date.now();
  let last: Record<string, unknown> | null = null;
  while (Date.now() - t0 < ms) {
    last = await adoc(col, id);
    if (last && check(last)) return last;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${what} (last state: ${JSON.stringify(last)?.slice(0, 300)})`);
}

export const today = () => new Date().toISOString().slice(0, 10);
