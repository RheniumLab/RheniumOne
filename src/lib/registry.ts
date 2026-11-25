import { ENTITIES } from "./entities";
import { MODULES } from "./modules";

export const entityByPath = (segment: string) => Object.values(ENTITIES).find((e) => e.basePath === `/${segment}`);
export const moduleByPath = (segment: string) => MODULES.find((m) => m.href === `/${segment}`);
