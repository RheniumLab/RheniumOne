"use client";

import { auth } from "./firebase";

/** Calls a Next.js API route with the user's Firebase ID token. */
export async function api<T = unknown>(path: string, method: string, body?: unknown): Promise<T> {
  const token = await auth().currentUser?.getIdToken();
  const res = await fetch(path, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
  return json as T;
}
