"use client";

import { useParams } from "next/navigation";
import { EntityDetail } from "@/components/entity";
import { Empty } from "@/components/ui";
import { entityByPath } from "@/lib/registry";
import { ConversionActions, LinkedRecords } from "@/components/conversions";

export default function ModuleDetailPage() {
  const { module, id } = useParams<{ module: string; id: string }>();
  const def = entityByPath(module);
  if (!def) return <Empty>Page not found.</Empty>;
  return (
    <EntityDetail
      def={def}
      id={id}
      actions={(d) => <ConversionActions collection={def.collection} id={id} data={d} />}
    >
      {(d) => <LinkedRecords collection={def.collection} id={id} data={d} />}
    </EntityDetail>
  );
}
