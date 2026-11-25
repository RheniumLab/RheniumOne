"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { NoAccess, PageHeader, Spinner } from "@/components/ui";
import { useAuth } from "@/lib/auth-context";
import { getDocOnce } from "@/lib/data";
import type { Line } from "@/lib/tax";
import { unitCosts, type BomLine } from "@/lib/bom";
import { QuotationEditor, type QuotationDraft } from "../editor";

export default function NewQuotationPage() {
  return <Suspense><NewQuotation /></Suspense>;
}

/** A quotation is created from a proposal, a requirement or a BOM, so costs and margin are visible (§5). */
function NewQuotation() {
  const { can } = useAuth();
  const params = useSearchParams();
  const [initial, setInitial] = useState<Partial<QuotationDraft> | null>(null);

  useEffect(() => {
    (async () => {
      const init: Partial<QuotationDraft> = {};
      const setClient = async (clientId: string) => {
        const c = await getDocOnce("clients", clientId);
        Object.assign(init, { clientId, placeOfSupply: c?.state ?? "", billingType: c?.billingType ?? "gst" });
      };
      const reqId = params.get("requirementId");
      const propId = params.get("proposalId");
      const bomId = params.get("bomId");
      if (reqId) {
        const r = await getDocOnce("requirements", reqId);
        if (r) {
          Object.assign(init, { requirementId: reqId, title: r.title, scope: [r.description, r.specifications].filter(Boolean).join("\n\n") });
          if (r.clientId) await setClient(String(r.clientId));
        }
      }
      if (propId) {
        const p = await getDocOnce("proposals", propId);
        if (p) {
          Object.assign(init, { proposalId: propId, requirementId: p.requirementId ?? init.requirementId ?? null, title: p.title, scope: p.scope ?? "", terms: p.terms ?? "" });
          if (p.clientId) await setClient(String(p.clientId));
        }
      }
      if (bomId) {
        const b = await getDocOnce("boms", bomId);
        if (b) {
          const bl = (b.lines ?? []) as BomLine[];
          const unit = unitCosts(bl);
          const lines: Line[] = bl
            .map((l, i) => ({ l, cost: unit[i] }))
            .filter(({ l }) => Number(l.level ?? 0) === 0)
            .map(({ l, cost }) => ({ itemId: l.itemId ?? null, description: [l.partNo, l.description].filter(Boolean).join(" — "), qty: Number(l.qty) || 1, unit: String(l.unit ?? "Nos"), rate: 0, cost, discType: "pct", disc: 0, taxRate: 18 }));
          Object.assign(init, { bomId, lines, title: init.title || String(b.name ?? "") });
          if (b.projectId) {
            const pr = await getDocOnce("projects", String(b.projectId));
            if (pr?.clientId) await setClient(String(pr.clientId));
            init.projectId = String(b.projectId);
          }
        }
      }
      setInitial(init);
    })();
  }, [params]);

  if (!can("quotations", "create")) return <NoAccess />;
  if (!initial) return <Spinner />;
  return (
    <div>
      <PageHeader title="New quotation" back="/quotations" />
      <QuotationEditor initial={initial} />
    </div>
  );
}
