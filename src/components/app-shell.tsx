"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { LogOut, Menu, Settings, X, WifiOff } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { AREAS, MODULES } from "@/lib/modules";
import { firebaseConfigured } from "@/lib/firebase";
import { Spinner } from "./ui";
import { InstallApp } from "./install-app";
import { where } from "firebase/firestore";
import { useCollection } from "@/lib/hooks";
import { flushOutbox, pendingUploads } from "@/lib/files";

export function AppShell({ children }: { children: ReactNode }) {
  const { loading, user, profile, role, can, isAdmin, logout } = useAuth();
  const router = useRouter();
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const [online, setOnline] = useState(true);

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  useEffect(() => setOpen(false), [path]);

  // Pending items for badges: approvals waiting for my role, handovers waiting for me.
  const approvals = useCollection("approvals", isAdmin ? [where("status", "==", "pending")] : [where("status", "==", "pending"), where("approverRole", "==", profile?.roleId ?? "-")], { includeDeleted: true, enabled: Boolean(profile?.active) }, [isAdmin, profile?.roleId]);
  const handovers = useCollection("transfers", [where("toHolder", "==", user?.uid ?? "-"), where("status", "==", "pending")], { enabled: Boolean(profile?.active) }, [user?.uid]);
  const badges: Record<string, number> = { "/approvals": approvals.rows.length, "/accounts": handovers.rows.length };

  // Upload bill photos / files that were captured offline.
  const [queued, setQueued] = useState(0);
  useEffect(() => {
    if (!user) return;
    const run = () => flushOutbox().finally(() => pendingUploads().then(setQueued));
    run();
    window.addEventListener("online", run);
    const t = setInterval(run, 60_000);
    return () => { window.removeEventListener("online", run); clearInterval(t); };
  }, [user]);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  if (!firebaseConfigured) {
    return (
      <div className="mx-auto max-w-lg p-8 text-sm">
        <h1 className="mb-2 text-lg font-semibold">Firebase is not configured</h1>
        <p className="text-muted">Copy <code>.env.example</code> to <code>.env.local</code>, fill in your Firebase project keys, and restart. See README.md.</p>
      </div>
    );
  }
  if (loading || !user) return <Spinner />;
  if (!profile || !profile.active || !role) {
    return (
      <div className="mx-auto max-w-md p-8 text-center text-sm">
        <p className="mb-4">Your account is not active yet. Ask the admin to activate it and assign a role.</p>
        <button className="btn" onClick={logout}>Sign out</button>
      </div>
    );
  }

  const isActive = (href: string) => (href === "/" ? path === "/" : path === href || path.startsWith(href + "/"));

  const item = (active: boolean) =>
    `flex items-center justify-between rounded-md border-l-2 px-2 py-1.5 transition-colors ${
      active ? "border-brand bg-white/10 font-medium text-white" : "border-transparent text-sidebar-fg/85 hover:bg-white/5 hover:text-white"
    }`;
  const nav = (
    <nav className="flex flex-col gap-4 p-3 text-sm">
      <Link href="/" className={item(isActive("/"))}>
        Dashboard
      </Link>
      {AREAS.map((area) => {
        const items = MODULES.filter((m) => m.area === area && can(m.key, "view"));
        if (!items.length) return null;
        return (
          <div key={area}>
            <div className="mb-1 px-2 text-[11px] font-semibold uppercase tracking-wider text-sidebar-muted">{area}</div>
            {items.map((m) => (
              <Link
                key={m.key}
                href={m.href}
                className={item(isActive(m.href))}
              >
                <span>{m.name}</span>
                {badges[m.href] ? <span className="rounded-full bg-brand px-1.5 text-[10px] font-semibold text-white">{badges[m.href]}</span> : null}
              </Link>
            ))}
          </div>
        );
      })}
      {isAdmin && (
        <div>
          <div className="mb-1 px-2 text-[11px] font-semibold uppercase tracking-wider text-sidebar-muted">Admin</div>
          <Link href="/settings" className={item(isActive("/settings"))}>
            <span className="flex items-center gap-2"><Settings size={14} /> Settings</span>
          </Link>
        </div>
      )}
    </nav>
  );

  return (
    <div className="flex min-h-dvh">
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 overflow-y-auto bg-sidebar text-sidebar-fg lg:block">
        <div className="border-b border-white/10 px-5 py-4">
          <Link href="/" className="flex items-center gap-2.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/mark-on-dark.png" alt="" className="h-8 w-8" />
          <span className="leading-tight">
            <span className="block text-sm font-bold tracking-[0.18em] text-white">RHENIUM</span>
            <span className="block text-[10px] font-semibold tracking-[0.3em] text-brand">ONE</span>
          </span>
        </Link>
        </div>
        <div className="bg-brand-gradient h-0.5" />
        {nav}
      </aside>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 overflow-y-auto bg-sidebar text-sidebar-fg">
            <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
              <Link href="/" className="flex items-center gap-2.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/mark-on-dark.png" alt="" className="h-8 w-8" />
          <span className="leading-tight">
            <span className="block text-sm font-bold tracking-[0.18em] text-white">RHENIUM</span>
            <span className="block text-[10px] font-semibold tracking-[0.3em] text-brand">ONE</span>
          </span>
        </Link>
              <button onClick={() => setOpen(false)} aria-label="Close menu" className="text-sidebar-fg"><X size={18} /></button>
            </div>
            <div className="bg-brand-gradient h-0.5" />
            {nav}
          </aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-border bg-surface/95 px-4 py-2.5 backdrop-blur">
          <button className="lg:hidden" onClick={() => setOpen(true)} aria-label="Open menu"><Menu size={20} /></button>
          <Link href="/" className="flex items-center gap-2 lg:hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/mark.png" alt="" className="h-6 w-6 dark:hidden" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/mark-on-dark.png" alt="" className="hidden h-6 w-6 dark:block" />
            <span className="text-sm font-bold tracking-[0.14em]">RHENIUM <span className="text-brand">ONE</span></span>
          </Link>
          <div className="flex-1" />
          {queued > 0 && <span className="rounded-full bg-brand/15 px-2 py-0.5 text-xs text-brand">{queued} file{queued > 1 ? "s" : ""} to upload</span>}
          {!online && (
            <span className="flex items-center gap-1 rounded-full bg-warn/15 px-2 py-0.5 text-xs text-warn">
              <WifiOff size={12} /> Offline — entries will sync
            </span>
          )}
          <span className="hidden text-sm text-muted sm:inline">{profile.name} · {role.name}</span>
          <InstallApp />
          <button className="btn !px-2 !py-1.5" onClick={logout} title="Sign out"><LogOut size={15} /></button>
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
