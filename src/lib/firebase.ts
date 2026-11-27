"use client";

import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";
import {
  initializeFirestore,
  getFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore,
} from "firebase/firestore";

const config = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  // Needed for push notifications; it's the project number, which is part of the app id (1:<number>:web:…).
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID?.split(":")[1],
};

let app: FirebaseApp | undefined;
let firestore: Firestore | undefined;

export function getApp(): FirebaseApp {
  if (!app) app = getApps()[0] ?? initializeApp(config);
  return app;
}

/** Firebase Auth (browser only). */
export function auth(): Auth {
  return getAuth(getApp());
}

/**
 * Firestore with a persistent offline cache, so entries made without a
 * connection are queued and synced when the device is back online.
 */
export function db(): Firestore {
  if (firestore) return firestore;
  const a = getApp();
  try {
    firestore = initializeFirestore(a, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    });
  } catch {
    firestore = getFirestore(a);
  }
  return firestore;
}

export const firebaseConfigured = Boolean(config.apiKey && config.projectId);
