"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { doc, limit, orderBy, updateDoc, where, writeBatch } from "firebase/firestore";
import { Bell, CheckCheck, X } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { db } from "@/lib/firebase";
import { useCollection } from "@/lib/hooks";
import type { Doc } from "@/lib/data";

/** The signed-in user's latest notifications (live). */
export function useNotifications(max = 50) {
  const { user } = useAuth();
  const { rows, loading } = useCollection("notifications", [where("to", "==", user?.uid ?? "-"), orderBy("at", "desc"), limit(max)], { includeDeleted: true, enabled: Boolean(user) }, [user?.uid, max]);
  return { rows, loading, unread: rows.filter((n) => !n.read).length };
}

export const markRead = (n: Doc) => (n.read ? Promise.resolve() : updateDoc(doc(db(), "notifications", n.id), { read: true, readAt: new Date().toISOString() }));

export async function markAllRead(rows: Doc[]) {
  const unread = rows.filter((n) => !n.read);
  if (!unread.length) return;
  const b = writeBatch(db());
  unread.forEach((n) => b.update(doc(db(), "notifications", n.id), { read: true, readAt: new Date().toISOString() }));
  await b.commit();
}

export const ago = (v: unknown) => {
  const d = (v as { toDate?: () => Date })?.toDate?.();
  if (!d) return "just now";
  const s = Math.round((Date.now() - d.getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
};

export function NotificationItem({ n, onOpen }: { n: Doc; onOpen?: () => void }) {
  const router = useRouter();
  return (
    <button
      className={`flex w-full gap-3 px-4 py-3 text-left hover:bg-surface-2 ${n.read ? "" : "bg-brand/5"}`}
      onClick={() => {
        void markRead(n);
        onOpen?.();
        router.push(String(n.link || "/notifications"));
      }}
    >
      <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.read ? "bg-transparent" : "bg-brand"}`} />
      <span className="min-w-0 flex-1">
        <span className={`block text-sm ${n.read ? "" : "font-semibold"}`}>{String(n.title)}</span>
        <span className="block text-xs text-muted">{String(n.body ?? "")}</span>
        <span className="block text-[11px] text-muted">{ago(n.at)}</span>
      </span>
    </button>
  );
}

/** Bell in the top bar: unread count, latest alerts, and a toast when a new one arrives. */
export function NotificationBell() {
  const { rows, unread } = useNotifications(20);
  const [open, setOpen] = useState(false);
  const [toast, setToast] = useState<Doc | null>(null);
  const seen = useRef<string | null>(null);
  const box = useRef<HTMLDivElement>(null);

  // Toast for alerts that arrive while the app is open.
  useEffect(() => {
    const top = rows[0];
    if (!top) return;
    if (seen.current === null) {
      seen.current = top.id;
      return;
    }
    if (top.id !== seen.current) {
      seen.current = top.id;
      if (!top.read) {
        setToast(top);
        const t = setTimeout(() => setToast(null), 6000);
        return () => clearTimeout(t);
      }
    }
  }, [rows]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  return (
    <div className="relative" ref={box}>
      <button className="btn relative !px-2 !py-1.5" onClick={() => setOpen(!open)} aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`} title="Notifications">
        <Bell size={15} />
        {unread > 0 && (
          <span className="absolute -right-1.5 -top-1.5 min-w-[18px] rounded-full bg-brand px-1 text-center text-[10px] font-bold leading-[18px] text-white">{unread > 99 ? "99+" : unread}</span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-2 w-[min(92vw,360px)] overflow-hidden rounded-lg border border-border bg-surface shadow-xl">
          <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
            <span className="text-sm font-semibold">Notifications</span>
            {unread > 0 && <button className="flex items-center gap-1 text-xs text-brand" onClick={() => markAllRead(rows)}><CheckCheck size={13} /> Mark all read</button>}
          </div>
          <div className="max-h-[60vh] divide-y divide-border overflow-y-auto">
            {!rows.length ? <div className="p-6 text-center text-sm text-muted">No notifications yet.</div> : rows.slice(0, 10).map((n) => <NotificationItem key={n.id} n={n} onOpen={() => setOpen(false)} />)}
          </div>
          <Link href="/notifications" className="block border-t border-border px-4 py-2.5 text-center text-xs font-medium text-brand" onClick={() => setOpen(false)}>
            See all · turn on phone alerts
          </Link>
        </div>
      )}
      {toast && (
        <div className="fixed bottom-4 right-4 z-50 w-[min(92vw,340px)] overflow-hidden rounded-lg border border-border bg-surface shadow-2xl">
          <div className="bg-brand-gradient h-1" />
          <div className="flex items-start">
            <div className="flex-1"><NotificationItem n={toast} onOpen={() => setToast(null)} /></div>
            <button className="p-3 text-muted" onClick={() => setToast(null)} aria-label="Dismiss"><X size={14} /></button>
          </div>
        </div>
      )}
    </div>
  );
}
