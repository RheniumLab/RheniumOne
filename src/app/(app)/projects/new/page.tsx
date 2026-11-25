"use client";

import { EntityNew } from "@/components/entity";
import { ENTITIES } from "@/lib/entities";
import { projectTransform } from "../transform";

export default function NewProjectPage() {
  return <EntityNew def={ENTITIES.projects} transform={projectTransform} />;
}
