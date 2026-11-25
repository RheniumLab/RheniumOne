"use client";

import { EntityList } from "@/components/entity";
import { ENTITIES } from "@/lib/entities";

export default function ProjectsPage() {
  return <EntityList def={ENTITIES.projects} />;
}
