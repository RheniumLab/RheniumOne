"use client";

import { api } from "./api";

/**
 * Tells the server something happened, so it can alert the right people
 * (in-app + push). Fire-and-forget: never blocks or fails the user's action.
 * See src/app/api/notify/route.ts for who receives each event.
 */
export function notify(event: string, id: string, extra: { col?: string; sub?: string } = {}) {
  if (typeof navigator !== "undefined" && !navigator.onLine) return;
  void api("/api/notify", "POST", { event, id, ...extra }).catch(() => {});
}
