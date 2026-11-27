"use client";

import { deleteDoc, doc, serverTimestamp, setDoc } from "firebase/firestore";
import { auth, db, getApp } from "./firebase";

/**
 * Phone / desktop notifications through Firebase Cloud Messaging (free).
 * Each device is registered once in `pushTokens`; the server sends to them.
 */
const VAPID = process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY;
const KEY = "r1-push-token";

export type PushState = "unsupported" | "not-configured" | "blocked" | "off" | "on";

export async function pushState(): Promise<PushState> {
  if (typeof window === "undefined" || !("Notification" in window) || !("serviceWorker" in navigator)) return "unsupported";
  const { isSupported } = await import("firebase/messaging");
  if (!(await isSupported())) return "unsupported";
  if (!VAPID) return "not-configured";
  if (Notification.permission === "denied") return "blocked";
  if (Notification.permission === "granted" && localStorageGet(KEY)) return "on";
  return "off";
}

/** Asks permission (must be called from a tap/click) and registers this device. */
export async function enablePush(): Promise<PushState> {
  const state = await pushState();
  if (state === "unsupported" || state === "not-configured") return state;
  const perm = await Notification.requestPermission();
  if (perm !== "granted") return perm === "denied" ? "blocked" : "off";
  const { getMessaging, getToken } = await import("firebase/messaging");
  const reg = (await navigator.serviceWorker.getRegistration("/")) ?? (await navigator.serviceWorker.register("/sw.js"));
  await navigator.serviceWorker.ready;
  const token = await getToken(getMessaging(getApp()), { vapidKey: VAPID, serviceWorkerRegistration: reg });
  if (!token) return "off";
  await setDoc(doc(db(), "pushTokens", token), { token, uid: auth().currentUser!.uid, ua: navigator.userAgent.slice(0, 200), at: serverTimestamp() });
  localStorageSet(KEY, token);
  return "on";
}

/** Keeps this device's registration fresh (tokens can rotate); silent if not enabled. */
export async function refreshPush() {
  try {
    if ((await pushState()) === "on") await enablePush();
  } catch {}
}

export async function disablePush() {
  const token = localStorageGet(KEY);
  if (token) await deleteDoc(doc(db(), "pushTokens", token)).catch(() => {});
  localStorageSet(KEY, "");
}

function localStorageGet(k: string) {
  try {
    return localStorage.getItem(k) || "";
  } catch {
    return "";
  }
}
function localStorageSet(k: string, v: string) {
  try {
    if (v) localStorage.setItem(k, v);
    else localStorage.removeItem(k);
  } catch {}
}
