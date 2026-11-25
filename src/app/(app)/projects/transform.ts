import { getDocOnce } from "@/lib/data";

/** The client's default billing type fills in on the project (§9). */
export async function projectTransform(next: Record<string, unknown>, changed: string) {
  if (changed === "clientId" && next.clientId) {
    const c = await getDocOnce("clients", String(next.clientId));
    if (c?.billingType) return { ...next, billingType: c.billingType };
  }
  if (changed === "projectType" && next.projectType === "Internal product") return { ...next, clientId: null };
  return next;
}
