"use client";

import Link from "next/link";
import { EntityList } from "@/components/entity";
import { Badge, Cell } from "@/components/ui";
import { useAuth } from "@/lib/auth-context";
import { useCollection } from "@/lib/hooks";
import { ENTITIES } from "@/lib/entities";

/** Asset register with service, calibration and warranty reminders (§7.5). */
export default function AssetsPage() {
  const { can } = useAuth();
  const { rows } = useCollection("assets", [], { enabled: can("assets", "view") });
  const soon = new Date();
  soon.setDate(soon.getDate() + 30);
  const lim = soon.toISOString().slice(0, 10);
  const due = rows
    .filter((a) => a.status !== "Disposed")
    .flatMap((a) => (["serviceDue", "calibrationDue", "warrantyUntil"] as const).filter((k) => a[k] && String(a[k]) <= lim).map((k) => ({ a, k })))
    .sort((x, y) => String(x.a[x.k]).localeCompare(String(y.a[y.k])));
  const label = { serviceDue: "Service", calibrationDue: "Calibration", warrantyUntil: "Warranty ends" };
  return (
    <div className="space-y-4">
      {due.length > 0 && (
        <div className="card border-warn/50 p-4">
          <h2 className="mb-2 text-sm font-semibold">Due in the next 30 days</h2>
          {due.map(({ a, k }) => (
            <Link key={a.id + k} href={`/assets/${a.id}`} className="flex justify-between py-1 text-sm hover:text-brand">
              <span>{String(a.code)} · {String(a.name)}</span>
              <span className="flex gap-2"><Badge kind={String(a[k]) < new Date().toISOString().slice(0, 10) ? "danger" : "warn"}>{label[k]}</Badge><Cell value={a[k]} kind="date" /></span>
            </Link>
          ))}
        </div>
      )}
      <EntityList def={ENTITIES.assets} extraActions={<Link className="btn" href="/assets/required">Required assets (priority list)</Link>} />
    </div>
  );
}
