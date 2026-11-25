"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { LogOut, Menu, Settings, X, WifiOff } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { AREAS, MODULES } from "@/lib/modules";
import { firebaseConfigured } from "@/lib/firebase";
import { Spinner } from "./ui";

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

  const nav = (
    <nav className="flex flex-col gap-4 p-3 text-sm">
      <Link href="/" className={`rounded-md px-2 py-1.5 ${isActive("/") ? "bg-brand/10 font-medium text-brand" : "hover:bg-surface-2"}`}>
        Dashboard
      </Link>
      {AREAS.filter((a) => a !== "Reports").map((area) => {
        const items = MODULES.filter((m) => m.area === area && can(m.key, "view"));
        if (!items.length) return null;
        return (
          <div key={area}>
            <div className="mb-1 px-2 text-[11px] font-semibold uppercase tracking-wide text-muted">{area}</div>
            {items.map((m) => (
              <Link
                key={m.key}
                href={m.href}
                className={`flex items-center justify-between rounded-md px-2 py-1.5 ${isActive(m.href) ? "bg-brand/10 font-medium text-brand" : "hover:bg-surface-2"}`}
              >
                <span>{m.name}</span>
                {!m.ready && <span className="text-[10px] text-muted">soon</span>}
              </Link>
            ))}
          </div>
        );
      })}
      {isAdmin && (
        <div>
          <div className="mb-1 px-2 text-[11px] font-semibold uppercase tracking-wide text-muted">Admin</div>
          <Link href="/settings" className={`flex items-center gap-2 rounded-md px-2 py-1.5 ${isActive("/settings") ? "bg-brand/10 font-medium text-brand" : "hover:bg-surface-2"}`}>
            <Settings size={14} /> Settings
          </Link>
        </div>
      )}
    </nav>
  );

  return (
    <div className="flex min-h-dvh">
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 overflow-y-auto border-r border-border bg-surface lg:block">
        <div className="border-b border-border px-5 py-4 font-semibold">Rhenium One</div>
        {nav}
      </aside>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 overflow-y-auto bg-surface">
            <div className="flex items-center justify-between border-b border-border px-5 py-4 font-semibold">
              Rhenium One
              <button onClick={() => setOpen(false)} aria-label="Close menu"><X size={18} /></button>
            </div>
            {nav}
          </aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-border bg-surface/95 px-4 py-2.5 backdrop-blur">
          <button className="lg:hidden" onClick={() => setOpen(true)} aria-label="Open menu"><Menu size={20} /></button>
          <span className="font-semibold lg:hidden">Rhenium One</span>
          <div className="flex-1" />
          {!online && (
            <span className="flex items-center gap-1 rounded-full bg-warn/15 px-2 py-0.5 text-xs text-warn">
              <WifiOff size={12} /> Offline — entries will sync
            </span>
          )}
          <span className="hidden text-sm text-muted sm:inline">{profile.name} · {role.name}</span>
          <button className="btn !px-2 !py-1.5" onClick={logout} title="Sign out"><LogOut size={15} /></button>
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
