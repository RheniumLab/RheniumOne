"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { fmtDate, inr } from "@/lib/data";

export function PageHeader({ title, subtitle, actions, back }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; back?: string }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        {back && (
          <Link href={back} className="mb-1 inline-block text-xs text-muted hover:text-brand">
            ← Back
          </Link>
        )}
        <h1 className="truncate text-xl font-semibold">{title}</h1>
        {subtitle && <div className="mt-0.5 text-sm text-muted">{subtitle}</div>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Spinner({ label = "Loading…" }: { label?: string }) {
  return <div className="p-8 text-center text-sm text-muted">{label}</div>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="p-8 text-center text-sm text-muted">{children}</div>;
}

export function ErrorBox({ children }: { children: ReactNode }) {
  return <div className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{children}</div>;
}

const tone: Record<string, string> = {
  ok: "bg-ok/15 text-ok",
  warn: "bg-warn/15 text-warn",
  danger: "bg-danger/15 text-danger",
  brand: "bg-brand/15 text-brand",
  muted: "bg-surface-2 text-muted",
};

const statusTone = (s: string) => {
  const v = s.toLowerCase();
  if (/(active|completed|paid|approved|done|won|launched|in use|received|confirmed|issued)/.test(v)) return "ok";
  if (/(hold|pending|repair|partly|evaluating|under|submitted|scheduled|lead)/.test(v)) return "warn";
  if (/(cancel|reject|lost|dropped|disposed|inactive|deleted|overdue)/.test(v)) return "danger";
  if (/(progress|development|sent|new|planned|idea)/.test(v)) return "brand";
  return "muted";
};

export function Badge({ children, kind }: { children: ReactNode; kind?: keyof typeof tone }) {
  const k = kind ?? (typeof children === "string" ? statusTone(children) : "muted");
  return <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${tone[k]}`}>{children}</span>;
}

export function GstBadge({ type }: { type?: string }) {
  if (type === "nonGst") return <Badge kind="warn">Non-GST</Badge>;
  return <Badge kind="muted">GST</Badge>;
}

export function Cell({ value, kind }: { value: unknown; kind?: "money" | "date" | "status" }) {
  if (value === null || value === undefined || value === "") return <span className="text-muted">—</span>;
  if (kind === "money") return <span className="whitespace-nowrap tabular-nums">{inr(Number(value))}</span>;
  if (kind === "date") return <>{fmtDate(value)}</>;
  if (kind === "status") return <Badge>{String(value)}</Badge>;
  return <>{String(value)}</>;
}

/** Smaller text for long amounts so they never spill out of the card. */
const statSize = (v: ReactNode) => {
  const n = typeof v === "string" || typeof v === "number" ? String(v).length : 0;
  return n > 16 ? "text-base" : n > 12 ? "text-lg" : "text-xl";
};

export function Stat({ label, value, hint, tone: t }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "ok" | "danger" }) {
  return (
    <div className="card min-w-0 p-4">
      <div className="truncate text-xs font-medium text-muted" title={label}>{label}</div>
      <div
        className={`mt-1 font-semibold leading-tight tabular-nums [overflow-wrap:anywhere] ${statSize(value)} ${t === "ok" ? "text-ok" : t === "danger" ? "text-danger" : ""}`}
        title={typeof value === "string" ? value : undefined}
      >
        {value}
      </div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </div>
  );
}

export function NoAccess() {
  return <Empty>You don’t have permission to view this. Ask your admin to update your role.</Empty>;
}
