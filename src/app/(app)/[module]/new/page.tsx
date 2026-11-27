"use client";

import { Suspense } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { EntityNew } from "@/components/entity";
import { Empty } from "@/components/ui";
import { entityByPath } from "@/lib/registry";

export default function ModuleNewPage() {
  return (
    <Suspense>
      <ModuleNew />
    </Suspense>
  );
}

/** New record; fields can be pre-filled from the link, e.g. ?clientId=…&requirementId=…&title=… */
function ModuleNew() {
  const { module } = useParams<{ module: string }>();
  const params = useSearchParams();
  const def = entityByPath(module);
  if (!def) return <Empty>Page not found.</Empty>;
  const initial = Object.fromEntries(def.fields.filter((f) => params.get(f.name)).map((f) => [f.name, params.get(f.name)]));
  return <EntityNew def={def} initial={initial} />;
}
