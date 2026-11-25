export type ModuleKey =
  | "clients"
  | "vendors"
  | "requirements"
  | "proposals"
  | "quotations"
  | "projects"
  | "documents"
  | "ideas"
  | "boms"
  | "sourcing"
  | "purchases"
  | "inventory"
  | "assets"
  | "challans"
  | "invoices"
  | "tds"
  | "cashflow"
  | "custody"
  | "claims"
  | "approvals"
  | "audit"
  | "reports"
  | "meetings";

export type Area =
  | "Masters"
  | "Sales"
  | "Projects"
  | "Engineering and supply"
  | "Money"
  | "Controls"
  | "Reports";

export interface ModuleDef {
  key: ModuleKey;
  no: number;
  name: string;
  area: Area;
  href: string;
  /** Built in the current phase. Unbuilt modules show a placeholder. */
  ready: boolean;
}

export const MODULES: ModuleDef[] = [
  { no: 1, key: "clients", name: "Clients", area: "Masters", href: "/clients", ready: true },
  { no: 2, key: "vendors", name: "Vendors", area: "Masters", href: "/vendors", ready: true },
  { no: 3, key: "requirements", name: "Requirements", area: "Sales", href: "/requirements", ready: true },
  { no: 4, key: "proposals", name: "Proposals", area: "Sales", href: "/proposals", ready: true },
  { no: 5, key: "quotations", name: "Quotations", area: "Sales", href: "/quotations", ready: true },
  { no: 6, key: "projects", name: "Projects", area: "Projects", href: "/projects", ready: true },
  { no: 7, key: "documents", name: "Documents & repos", area: "Projects", href: "/documents", ready: true },
  { no: 8, key: "ideas", name: "Product ideas", area: "Projects", href: "/ideas", ready: true },
  { no: 9, key: "boms", name: "EBOM / MBOM", area: "Engineering and supply", href: "/boms", ready: true },
  { no: 10, key: "sourcing", name: "Sourcing", area: "Engineering and supply", href: "/sourcing", ready: true },
  { no: 11, key: "purchases", name: "Purchase orders & GRN", area: "Engineering and supply", href: "/purchases", ready: true },
  { no: 12, key: "inventory", name: "Inventory", area: "Engineering and supply", href: "/inventory", ready: true },
  { no: 13, key: "assets", name: "Assets", area: "Engineering and supply", href: "/assets", ready: true },
  { no: 14, key: "challans", name: "Challans & e-way bills", area: "Engineering and supply", href: "/challans", ready: true },
  { no: 15, key: "invoices", name: "Invoices", area: "Money", href: "/invoices", ready: true },
  { no: 16, key: "tds", name: "Payments & TDS", area: "Money", href: "/payments", ready: true },
  { no: 17, key: "cashflow", name: "Cash flow", area: "Money", href: "/cashflow", ready: true },
  { no: 18, key: "custody", name: "Accounts & cash custody", area: "Money", href: "/accounts", ready: true },
  { no: 19, key: "claims", name: "Expense claims", area: "Money", href: "/claims", ready: true },
  { no: 20, key: "approvals", name: "Approvals", area: "Controls", href: "/approvals", ready: true },
  { no: 21, key: "audit", name: "Logs", area: "Controls", href: "/audit", ready: true },
  { no: 22, key: "reports", name: "Reports", area: "Reports", href: "/reports", ready: true },
  { no: 23, key: "meetings", name: "Meetings & MOM", area: "Projects", href: "/meetings", ready: true },
];

export const AREAS: Area[] = [
  "Masters",
  "Sales",
  "Projects",
  "Engineering and supply",
  "Money",
  "Controls",
  "Reports",
];

export const moduleByKey = (k: string) => MODULES.find((m) => m.key === k);
export const moduleByHref = (path: string) =>
  MODULES.find((m) => m.href !== "/" && (path === m.href || path.startsWith(m.href + "/")));
