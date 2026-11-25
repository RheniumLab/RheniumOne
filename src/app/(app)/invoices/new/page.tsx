"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { NoAccess, PageHeader, Spinner } from "@/components/ui";
import { useAuth } from "@/lib/auth-context";
import { getDocOnce } from "@/lib/data";
import type { Line } from "@/lib/tax";
import { InvoiceEditor, type InvoiceDraft } from "../editor";

export default function NewInvoicePage() {
  return <Suspense><NewInvoice /></Suspense>;
}

/** An invoice can be created from a project, a quotation or a delivery challan, or by hand (§8.1). */
function NewInvoice() {
  const { can } = useAuth();
  const params = useSearchParams();
  const [initial, setInitial] = useState<Partial<InvoiceDraft> | null>(null);

  useEffect(() => {
    (async () => {
      const init: Partial<InvoiceDraft> = {};
      const projectId = params.get("projectId");
      const quotationId = params.get("quotationId");
      const challanId = params.get("challanId");
      if (projectId) {
        const p = await getDocOnce("projects", projectId);
        if (p) Object.assign(init, { projectId, clientId: p.clientId ?? "", billingType: p.billingType ?? "gst" });
      }
      if (quotationId) {
        const q = await getDocOnce("quotations", quotationId);
        if (q) Object.assign(init, { quotationId, clientId: q.clientId, projectId: q.projectId ?? init.projectId ?? "", billingType: q.billingType, lines: q.lines ?? [], adj: { ...(q.adj ?? {}), advance: 0 } });
      }
      if (challanId) {
        const c = await getDocOnce("challans", challanId);
        if (c) {
          const lines: Line[] = [];
          for (const l of (c.lines ?? []) as Record<string, unknown>[]) {
            const it = l.itemId ? await getDocOnce("items", String(l.itemId)) : null;
            lines.push({ itemId: (l.itemId as string) ?? null, description: String(l.description ?? it?.name ?? ""), hsn: String(it?.hsn ?? ""), qty: Number(l.qty), unit: String(l.unit ?? it?.unit ?? "Nos"), rate: Number(it?.rate ?? 0), discType: "pct", disc: 0, taxRate: 18 });
          }
          Object.assign(init, { challanId, clientId: c.clientId ?? "", projectId: c.projectId ?? "", lines });
        }
      }
      setInitial(init);
    })();
  }, [params]);

  if (!can("invoices", "create")) return <NoAccess />;
  if (!initial) return <Spinner />;
  return (
    <div>
      <PageHeader title="New invoice" subtitle="Saved as a draft. The number is given when you issue it." back="/invoices" />
      <InvoiceEditor initial={initial} />
    </div>
  );
}
