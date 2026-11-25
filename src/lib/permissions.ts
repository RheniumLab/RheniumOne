import { MODULES, type ModuleKey } from "./modules";

export const ACTIONS = ["view", "create", "edit", "delete", "approve"] as const;
export type Action = (typeof ACTIONS)[number];
export type ModulePerms = Partial<Record<Action, boolean>>;
export type Perms = Partial<Record<ModuleKey, ModulePerms>>;

export interface Role {
  id: string;
  name: string;
  isAdmin?: boolean;
  /** Can see non-GST data. Separate from module permissions (requirements §2). */
  nonGst: boolean;
  perms: Perms;
}

export interface UserProfile {
  uid: string;
  name: string;
  email: string;
  phone?: string;
  roleId: string;
  active: boolean;
}

export function can(role: Role | null | undefined, module: ModuleKey, action: Action): boolean {
  if (!role) return false;
  if (role.isAdmin) return true;
  return Boolean(role.perms?.[module]?.[action]);
}

export const seesNonGst = (role: Role | null | undefined) => Boolean(role?.isAdmin || role?.nonGst);

const all = (): ModulePerms => ({ view: true, create: true, edit: true, delete: true, approve: true });
const work = (): ModulePerms => ({ view: true, create: true, edit: true });
const viewOnly = (): ModulePerms => ({ view: true });

/** Starting roles from requirements §2. The admin can change all of these. */
export function defaultRoles(): Role[] {
  const allModules = Object.fromEntries(MODULES.map((m) => [m.key, all()])) as Perms;
  const everyoneClaims: Perms = { claims: { view: true, create: true }, custody: { view: true, create: true }, meetings: viewOnly() };
  return [
    { id: "admin", name: "Admin", isAdmin: true, nonGst: true, perms: allModules },
    {
      id: "accounts",
      name: "Accounts",
      nonGst: false,
      perms: {
        ...everyoneClaims,
        clients: work(), vendors: work(), invoices: work(), tds: work(), cashflow: work(),
        custody: work(), claims: work(), inventory: work(), assets: work(), purchases: work(),
        reports: viewOnly(), projects: viewOnly(),
      },
    },
    {
      id: "pm",
      name: "Project Manager",
      nonGst: false,
      perms: {
        ...everyoneClaims,
        clients: viewOnly(), requirements: work(), proposals: work(), quotations: work(),
        projects: work(), documents: work(), ideas: work(), boms: work(), sourcing: work(),
        purchases: { view: true, create: true }, meetings: work(), reports: viewOnly(),
      },
    },
    {
      id: "engineer",
      name: "Engineer",
      nonGst: false,
      perms: { ...everyoneClaims, projects: work(), documents: work(), ideas: work(), boms: work(), sourcing: work() },
    },
    {
      id: "developer",
      name: "Developer",
      nonGst: false,
      perms: { ...everyoneClaims, projects: work(), documents: work(), ideas: work() },
    },
    {
      // View and download GST records only, for filing GST returns (non-GST data stays hidden).
      id: "auditor",
      name: "Auditor",
      nonGst: false,
      perms: {
        invoices: viewOnly(), tds: viewOnly(), cashflow: viewOnly(), purchases: viewOnly(),
        clients: viewOnly(), vendors: viewOnly(), reports: viewOnly(), documents: viewOnly(),
      },
    },
    {
      id: "store",
      name: "Store",
      nonGst: false,
      perms: { ...everyoneClaims, inventory: work(), assets: work(), challans: work(), purchases: viewOnly() },
    },
  ];
}
