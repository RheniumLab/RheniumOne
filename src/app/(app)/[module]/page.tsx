"use client";

import { useParams } from "next/navigation";
import { EntityList } from "@/components/entity";
import { Empty, PageHeader } from "@/components/ui";
import { entityByPath, moduleByPath } from "@/lib/registry";

export default function ModuleListPage() {
  const { module } = useParams<{ module: string }>();
  const def = entityByPath(module);
  if (def) return <EntityList def={def} />;
  const m = moduleByPath(module);
  if (!m) return <Empty>Page not found.</Empty>;
  return (
    <div>
      <PageHeader title={m.name} subtitle={`Module ${m.no} · ${m.area}`} />
      <div className="card">
        <Empty>This module is planned for the next build phase. Its data links (client, project, cash flow) are already in place.</Empty>
      </div>
    </div>
  );
}
