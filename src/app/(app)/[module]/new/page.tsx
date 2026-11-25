"use client";

import { useParams } from "next/navigation";
import { EntityNew } from "@/components/entity";
import { Empty } from "@/components/ui";
import { entityByPath } from "@/lib/registry";

export default function ModuleNewPage() {
  const { module } = useParams<{ module: string }>();
  const def = entityByPath(module);
  if (!def) return <Empty>Page not found.</Empty>;
  return <EntityNew def={def} />;
}
