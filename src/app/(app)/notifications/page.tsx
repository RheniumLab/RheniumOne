"use client";

import { useEffect, useState } from "react";
import { BellRing, CheckCheck, Smartphone } from "lucide-react";
import { Empty, ErrorBox, PageHeader, Spinner } from "@/components/ui";
import { markAllRead, NotificationItem, useNotifications } from "@/components/notifications";
import { disablePush, enablePush, pushState, type PushState } from "@/lib/push";

const STATE_TEXT: Record<PushState, string> = {
  on: "Alerts are on for this device. You’ll get them even when the app is closed.",
  off: "Get alerts on this device even when the app is closed — like any other app.",
  blocked: "Notifications are blocked for this site. Allow them in your browser or phone settings (site settings → Notifications), then come back.",
  unsupported: "This browser can’t show app notifications. On iPhone, install the app first (Share → Add to Home Screen) and open it from the home screen.",
  "not-configured": "Phone and desktop alerts aren’t set up on the server yet. In-app notifications still work.",
};

export default function NotificationsPage() {
  const { rows, loading, unread } = useNotifications(100);
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    pushState().then(setState).catch(() => setState("unsupported"));
  }, []);

  const shown = filter === "unread" ? rows.filter((n) => !n.read) : rows;

  return (
    <div className="max-w-3xl space-y-4">
      <PageHeader title="Notifications" subtitle="Alerts about tasks, bills, invoices, approvals and more — no email or SMS" />

      <div className="card flex flex-wrap items-center gap-3 p-4">
        <div className="rounded-full bg-brand/10 p-2 text-brand"><Smartphone size={18} /></div>
        <div className="min-w-0 flex-1 text-sm">
          <div className="font-semibold">Phone &amp; desktop alerts</div>
          <div className="text-muted">{state ? STATE_TEXT[state] : "Checking…"}</div>
        </div>
        {state === "off" && (
          <button className="btn-primary" disabled={busy} onClick={async () => {
            setBusy(true);
            setErr(null);
            try { setState(await enablePush()); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
            setBusy(false);
          }}><BellRing size={15} /> {busy ? "Turning on…" : "Turn on"}</button>
        )}
        {state === "on" && <button className="btn" onClick={async () => { await disablePush(); setState("off"); }}>Turn off</button>}
        {err && <div className="w-full"><ErrorBox>{err}</ErrorBox></div>}
      </div>

      <div className="card">
        <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
          <button className={filter === "all" ? "btn-primary !py-1" : "btn !py-1"} onClick={() => setFilter("all")}>All</button>
          <button className={filter === "unread" ? "btn-primary !py-1" : "btn !py-1"} onClick={() => setFilter("unread")}>Unread {unread ? `(${unread})` : ""}</button>
          <div className="flex-1" />
          {unread > 0 && <button className="btn !py-1" onClick={() => markAllRead(rows)}><CheckCheck size={14} /> Mark all read</button>}
        </div>
        {loading ? <Spinner /> : !shown.length ? <Empty>{filter === "unread" ? "You’re all caught up." : "No notifications yet."}</Empty> : (
          <div className="divide-y divide-border">{shown.map((n) => <NotificationItem key={n.id} n={n} />)}</div>
        )}
      </div>
    </div>
  );
}
