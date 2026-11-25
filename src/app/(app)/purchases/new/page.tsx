"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { NoAccess, PageHeader, Spinner } from "@/components/ui";
import { useAuth } from "@/lib/auth-context";
import { getDocOnce } from "@/lib/data";
import { PoEditor, type PoDraft } from "../editor";

export default function NewPoPage() {
  return <Suspense><NewPo /></Suspense>;
}

function NewPo() {
  const { can } = useAuth();
  const params = useSearchParams();
  const [initial, setInitial] = useState<Partial<PoDraft> | null>(null);
  useEffect(() => {
    (async () => {
      const init: Partial<PoDraft> = {};
      const reqId = params.get("assetRequestId");
      if (reqId) {
        const r = await getDocOnce("assetRequests", reqId);
        if (r)
          Object.assign(init, {
            assetRequestId: reqId, projectId: r.projectId ?? "", scope: r.projectId ? "project" : "company",
            lines: [{ description: [r.item, r.spec].filter(Boolean).join(" — "), qty: Number(r.qty) || 1, unit: "Nos", rate: Number(r.estCost || 0) / (Number(r.qty) || 1), taxRate: 18, disc: 0, discType: "pct" }],
            notes: `Asset purchase: ${r.item}`,
          });
      }
      const projectId = params.get("projectId");
      if (projectId) Object.assign(init, { projectId, scope: "project" });
      setInitial(init);
    })();
  }, [params]);
  if (!can("purchases", "create")) return <NoAccess />;
  if (!initial) return <Spinner />;
  return (
    <div>
      <PageHeader title="New purchase order" back="/purchases" />
      <PoEditor initial={initial} />
    </div>
  );
}
