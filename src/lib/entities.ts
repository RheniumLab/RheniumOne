import type { ModuleKey } from "./modules";
import { pad, type CodeSpec } from "./data";
import { PROJECT_STATUSES } from "./seed";

export type FieldType =
  | "text"
  | "textarea"
  | "number"
  | "money"
  | "date"
  | "email"
  | "tel"
  | "url"
  | "select"
  | "checkbox"
  | "ref"
  | "users"
  | "list";

export interface Field {
  name: string;
  label: string;
  type: FieldType;
  section?: string;
  required?: boolean;
  options?: string[];
  /** For `ref`: collection to pick from and the field shown. */
  ref?: { collection: string; label: string; gstAware?: boolean };
  /** For `list`: sub-fields of each row. */
  fields?: Field[];
  default?: unknown;
  help?: string;
  /** Only shown when this returns true for the current form values. */
  when?: (v: Record<string, unknown>) => boolean;
  wide?: boolean;
}

export interface EntityDef {
  module: ModuleKey;
  collection: string;
  singular: string;
  plural: string;
  basePath: string;
  title: (d: Record<string, unknown>) => string;
  code?: CodeSpec;
  fields: Field[];
  columns: { field: string; label: string; kind?: "money" | "date" | "status" }[];
  /** Records carry `billingType` (gst / nonGst). */
  gstAware?: boolean;
  /** Default filters/tabs on the list page. */
  statusField?: string;
}

const YN = ["Yes", "No"];

const contactFields: Field[] = [
  { name: "name", label: "Name", type: "text", required: true },
  { name: "designation", label: "Designation", type: "text" },
  { name: "phone", label: "Phone", type: "tel" },
  { name: "email", label: "Email", type: "email" },
  { name: "whatsapp", label: "WhatsApp", type: "tel" },
  { name: "roleTag", label: "Role", type: "select", options: ["Decision maker", "Technical", "Accounts"] },
  { name: "primary", label: "Primary", type: "checkbox" },
];

const addressFields: Field[] = [
  { name: "label", label: "Label", type: "text" },
  { name: "address", label: "Address", type: "textarea", wide: true },
  { name: "state", label: "State", type: "text" },
  { name: "pin", label: "PIN", type: "text" },
];

export const ENTITIES: Record<string, EntityDef> = {
  clients: {
    module: "clients",
    collection: "clients",
    singular: "Client",
    plural: "Clients",
    basePath: "/clients",
    title: (d) => String(d.displayName || d.legalName || ""),
    code: { counter: "client", field: "code", format: (n) => `RC-${pad(n)}` },
    statusField: "status",
    fields: [
      { section: "Basic", name: "legalName", label: "Legal name", type: "text", required: true },
      { section: "Basic", name: "displayName", label: "Display name", type: "text" },
      { section: "Basic", name: "clientType", label: "Client type", type: "select", options: ["Company", "Individual", "Government"], default: "Company" },
      { section: "Basic", name: "status", label: "Status", type: "select", options: ["Lead", "Active", "Inactive"], default: "Lead" },
      { section: "Tax", name: "gstRegistered", label: "GST registered", type: "select", options: YN, default: "Yes" },
      { section: "Tax", name: "gstin", label: "GSTIN", type: "text", when: (v) => v.gstRegistered === "Yes" },
      { section: "Tax", name: "pan", label: "PAN", type: "text" },
      { section: "Tax", name: "state", label: "State (place of supply)", type: "text", required: true },
      { section: "Tax", name: "tdsApplicable", label: "TDS applicable", type: "select", options: YN, default: "No" },
      { section: "Tax", name: "tdsRate", label: "Usual TDS rate %", type: "number", when: (v) => v.tdsApplicable === "Yes" },
      { section: "Addresses", name: "billingAddress", label: "Billing address", type: "textarea", wide: true },
      { section: "Addresses", name: "siteAddresses", label: "Site / shipping addresses", type: "list", fields: addressFields, wide: true },
      { section: "Contacts", name: "contacts", label: "Contacts", type: "list", fields: contactFields, wide: true },
      { section: "Commercial", name: "paymentTermsDays", label: "Payment terms (days)", type: "number", default: 30 },
      { section: "Commercial", name: "creditLimit", label: "Credit limit", type: "money" },
      { section: "Commercial", name: "billingType", label: "Default billing type", type: "select", options: ["gst", "nonGst"], default: "gst" },
      { section: "Internal", name: "ownerId", label: "Account owner", type: "users" },
      { section: "Internal", name: "source", label: "Source", type: "select", options: ["Referral", "Website", "Repeat", "Other"] },
      { section: "Internal", name: "tags", label: "Tags", type: "text", help: "Comma separated" },
      { section: "Internal", name: "notes", label: "Notes", type: "textarea", wide: true },
    ],
    columns: [
      { field: "code", label: "Code" },
      { field: "displayName", label: "Name" },
      { field: "clientType", label: "Type" },
      { field: "state", label: "State" },
      { field: "status", label: "Status", kind: "status" },
    ],
  },

  vendors: {
    module: "vendors",
    collection: "vendors",
    singular: "Vendor",
    plural: "Vendors",
    basePath: "/vendors",
    title: (d) => String(d.name || ""),
    code: { counter: "vendor", field: "code", format: (n) => `RV-${pad(n)}` },
    statusField: "status",
    fields: [
      { section: "Basic", name: "name", label: "Vendor name", type: "text", required: true },
      { section: "Basic", name: "vendorType", label: "Type", type: "select", options: ["Supplier", "Fabricator", "Service", "Contractor"], default: "Supplier" },
      { section: "Basic", name: "status", label: "Status", type: "select", options: ["Active", "Inactive"], default: "Active" },
      { section: "Tax", name: "gstRegistered", label: "GST registered", type: "select", options: YN, default: "Yes" },
      { section: "Tax", name: "gstin", label: "GSTIN", type: "text", when: (v) => v.gstRegistered === "Yes" },
      { section: "Tax", name: "pan", label: "PAN", type: "text" },
      { section: "Tax", name: "state", label: "State", type: "text" },
      { section: "Contacts and address", name: "address", label: "Address", type: "textarea", wide: true },
      { section: "Contacts and address", name: "contacts", label: "Contacts", type: "list", fields: contactFields.slice(0, 5), wide: true },
      { section: "Commercial", name: "supplies", label: "Items or services supplied", type: "textarea", wide: true },
      { section: "Commercial", name: "paymentTermsDays", label: "Payment terms (days)", type: "number" },
      { section: "Commercial", name: "bankName", label: "Bank name", type: "text" },
      { section: "Commercial", name: "bankAccount", label: "Account number", type: "text" },
      { section: "Commercial", name: "ifsc", label: "IFSC", type: "text" },
    ],
    columns: [
      { field: "code", label: "Code" },
      { field: "name", label: "Name" },
      { field: "vendorType", label: "Type" },
      { field: "gstin", label: "GSTIN" },
      { field: "status", label: "Status", kind: "status" },
    ],
  },

  requirements: {
    module: "requirements",
    collection: "requirements",
    singular: "Requirement",
    plural: "Requirements",
    basePath: "/requirements",
    title: (d) => String(d.title || ""),
    code: { counter: "requirement", field: "code", format: (n) => `RQ-${pad(n)}` },
    statusField: "status",
    fields: [
      { name: "kind", label: "Kind", type: "select", options: ["Client", "Internal"], default: "Client" },
      { name: "title", label: "Title", type: "text", required: true },
      { name: "clientId", label: "Client", type: "ref", ref: { collection: "clients", label: "displayName" }, when: (v) => v.kind !== "Internal" },
      { name: "ideaId", label: "Product idea", type: "ref", ref: { collection: "ideas", label: "title" }, when: (v) => v.kind === "Internal" },
      { name: "status", label: "Status", type: "select", options: ["New", "Under study", "Proposal sent", "Approved", "Converted to project", "Closed - won", "Closed - lost", "Dropped"], default: "New" },
      { name: "targetDate", label: "Target date", type: "date" },
      { name: "description", label: "Description", type: "textarea", wide: true },
      { name: "specifications", label: "Specifications / features", type: "textarea", wide: true },
      { name: "quantities", label: "Quantities", type: "text" },
      { name: "targetUsers", label: "Target users", type: "text", when: (v) => v.kind === "Internal" },
      { name: "targetCost", label: "Target cost", type: "money", when: (v) => v.kind === "Internal" },
      { name: "sellingPrice", label: "Target selling price", type: "money", when: (v) => v.kind === "Internal" },
    ],
    columns: [
      { field: "code", label: "Code" },
      { field: "title", label: "Title" },
      { field: "kind", label: "Kind" },
      { field: "targetDate", label: "Target", kind: "date" },
      { field: "status", label: "Status", kind: "status" },
    ],
  },

  proposals: {
    module: "proposals",
    collection: "proposals",
    singular: "Proposal",
    plural: "Proposals",
    basePath: "/proposals",
    title: (d) => `${d.title ?? ""} · R${d.rev ?? 0}`,
    code: { counter: "proposal", field: "code", format: (n) => `PR-${pad(n)}` },
    statusField: "status",
    fields: [
      { name: "title", label: "Title", type: "text", required: true },
      { name: "clientId", label: "Client", type: "ref", ref: { collection: "clients", label: "displayName" }, required: true },
      { name: "requirementId", label: "Requirement", type: "ref", ref: { collection: "requirements", label: "title" } },
      { name: "status", label: "Status", type: "select", options: ["Draft", "Sent", "Accepted", "Rejected"], default: "Draft" },
      { name: "rev", label: "Revision (R)", type: "number", default: 0 },
      { name: "validUntil", label: "Valid until", type: "date" },
      { name: "scope", label: "Scope", type: "textarea", wide: true },
      { name: "approach", label: "Technical approach", type: "textarea", wide: true },
      { name: "deliverables", label: "Deliverables", type: "textarea", wide: true },
      { name: "timeline", label: "Timeline", type: "textarea", wide: true },
      { name: "terms", label: "Terms", type: "textarea", wide: true },
    ],
    columns: [
      { field: "code", label: "Code" },
      { field: "title", label: "Title" },
      { field: "rev", label: "Rev" },
      { field: "validUntil", label: "Valid until", kind: "date" },
      { field: "status", label: "Status", kind: "status" },
    ],
  },

  ideas: {
    module: "ideas",
    collection: "ideas",
    singular: "Product idea",
    plural: "Product ideas",
    basePath: "/ideas",
    title: (d) => String(d.title || ""),
    statusField: "stage",
    fields: [
      { name: "title", label: "Title", type: "text", required: true },
      { name: "stage", label: "Stage", type: "select", options: ["Idea", "Evaluating", "Approved", "In development", "Launched", "Dropped"], default: "Idea" },
      { name: "dropReason", label: "Reason dropped", type: "text", when: (v) => v.stage === "Dropped" },
      { name: "proposedBy", label: "Proposed by", type: "users" },
      { name: "description", label: "Description", type: "textarea", wide: true },
      { name: "problem", label: "Problem it solves", type: "textarea", wide: true },
      { name: "targetCustomers", label: "Target customers", type: "text" },
      { name: "roughCost", label: "Rough cost estimate", type: "money" },
      { name: "roughTime", label: "Rough time estimate", type: "text" },
      { name: "links", label: "Links", type: "textarea", wide: true },
    ],
    columns: [
      { field: "title", label: "Title" },
      { field: "targetCustomers", label: "Target customers" },
      { field: "roughCost", label: "Est. cost", kind: "money" },
      { field: "stage", label: "Stage", kind: "status" },
    ],
  },

  inventory: {
    module: "inventory",
    collection: "items",
    singular: "Item",
    plural: "Inventory items",
    basePath: "/inventory",
    title: (d) => String(d.name || ""),
    code: { counter: "item", field: "code", format: (n) => `IT-${pad(n, 5)}` },
    fields: [
      { name: "name", label: "Name", type: "text", required: true },
      { name: "unit", label: "Unit", type: "select", options: ["Nos", "Kg", "m", "L", "Set", "Box", "Roll"], default: "Nos" },
      { name: "category", label: "Category", type: "text" },
      { name: "hsn", label: "HSN", type: "text" },
      { name: "rate", label: "Standard rate", type: "money" },
      { name: "reorderLevel", label: "Reorder level", type: "number" },
      { name: "reservations", label: "Reserved for projects", type: "list", wide: true, help: "Stock levels come from movements (GRN, issue, challan, scrap) on the Inventory page.", fields: [
        { name: "projectId", label: "Project", type: "ref", ref: { collection: "projects", label: "name", gstAware: true } },
        { name: "qty", label: "Qty", type: "number" },
      ] },
    ],
    columns: [
      { field: "code", label: "Code" },
      { field: "name", label: "Name" },
      { field: "unit", label: "Unit" },
      { field: "hsn", label: "HSN" },
      { field: "reorderLevel", label: "Reorder at" },
    ],
  },

  assets: {
    module: "assets",
    collection: "assets",
    singular: "Asset",
    plural: "Assets",
    basePath: "/assets",
    title: (d) => String(d.name || ""),
    code: { counter: "asset", field: "code", format: (n) => `RA-${pad(n)}` },
    statusField: "status",
    fields: [
      { name: "name", label: "Name", type: "text", required: true },
      { name: "assetType", label: "Type", type: "select", options: ["Machine", "Tool", "Laptop", "Test equipment", "Vehicle", "Other"] },
      { name: "status", label: "Status", type: "select", options: ["In use", "Under repair", "At site", "Disposed"], default: "In use" },
      { name: "purchaseDate", label: "Purchase date", type: "date" },
      { name: "value", label: "Value", type: "money" },
      { name: "vendorId", label: "Vendor", type: "ref", ref: { collection: "vendors", label: "name" } },
      { name: "location", label: "Location", type: "text" },
      { name: "assignedTo", label: "Assigned person", type: "users" },
      { name: "serviceDue", label: "Next service", type: "date" },
      { name: "calibrationDue", label: "Calibration due", type: "date" },
      { name: "warrantyUntil", label: "Warranty until", type: "date" },
      { name: "notes", label: "Notes", type: "textarea", wide: true },
    ],
    columns: [
      { field: "code", label: "Code" },
      { field: "name", label: "Name" },
      { field: "location", label: "Location" },
      { field: "value", label: "Value", kind: "money" },
      { field: "status", label: "Status", kind: "status" },
    ],
  },

  meetings: {
    module: "meetings",
    collection: "meetings",
    singular: "Meeting",
    plural: "Meetings",
    basePath: "/meetings",
    title: (d) => String(d.title || ""),
    statusField: "status",
    fields: [
      { name: "title", label: "Title", type: "text", required: true },
      { name: "meetingType", label: "Type", type: "select", options: ["Monthly review", "Project meeting", "Client meeting", "Internal meeting"], default: "Internal meeting" },
      { name: "status", label: "Status", type: "select", options: ["Scheduled", "Held", "MOM issued", "Cancelled"], default: "Scheduled" },
      { name: "date", label: "Date", type: "date", required: true },
      { name: "time", label: "Time", type: "text" },
      { name: "place", label: "Place or online link", type: "text" },
      { name: "chair", label: "Chair", type: "users" },
      { name: "projectId", label: "Project", type: "ref", ref: { collection: "projects", label: "name", gstAware: true } },
      { name: "clientId", label: "Client", type: "ref", ref: { collection: "clients", label: "displayName" } },
      { name: "attendees", label: "Attendees", type: "textarea", wide: true },
      { name: "agenda", label: "Agenda", type: "textarea", wide: true },
      { name: "discussed", label: "Points discussed", type: "textarea", wide: true },
      { name: "decisions", label: "Decisions taken", type: "textarea", wide: true },
      { name: "actions", label: "Action items", type: "list", wide: true, fields: [
        { name: "description", label: "Description", type: "text" },
        { name: "owner", label: "Owner", type: "users" },
        { name: "due", label: "Due", type: "date" },
        { name: "status", label: "Status", type: "select", options: ["Open", "In progress", "Done"] },
      ] },
    ],
    columns: [
      { field: "date", label: "Date", kind: "date" },
      { field: "title", label: "Title" },
      { field: "meetingType", label: "Type" },
      { field: "status", label: "Status", kind: "status" },
    ],
  },

  projects: {
    module: "projects",
    collection: "projects",
    singular: "Project",
    plural: "Projects",
    basePath: "/projects",
    title: (d) => String(d.name || ""),
    code: { counter: "project", field: "code", format: (n) => `RP-${pad(n)}` },
    gstAware: true,
    statusField: "status",
    fields: [
      { name: "name", label: "Project name", type: "text", required: true },
      { name: "projectType", label: "Type", type: "select", options: ["Client project", "Internal product"], default: "Client project" },
      { name: "clientId", label: "Client", type: "ref", ref: { collection: "clients", label: "displayName" }, when: (v) => v.projectType !== "Internal product", required: true },
      { name: "status", label: "Status", type: "select", options: PROJECT_STATUSES, default: "Planned" },
      { name: "managerId", label: "Project manager", type: "users" },
      { name: "startDate", label: "Start date", type: "date" },
      { name: "targetDate", label: "Target date", type: "date" },
      { name: "value", label: "Project value", type: "money", when: (v) => v.projectType !== "Internal product" },
      { name: "budget", label: "Development budget", type: "money", when: (v) => v.projectType === "Internal product" },
      { name: "billingType", label: "Billing type", type: "select", options: ["gst", "nonGst"], default: "gst" },
      { name: "scope", label: "Scope", type: "textarea", wide: true },
      { name: "repos", label: "Code repositories", type: "list", wide: true, fields: [
        { name: "url", label: "Repository URL", type: "url" },
        { name: "branch", label: "Main branch", type: "text" },
      ] },
    ],
    columns: [
      { field: "code", label: "Code" },
      { field: "name", label: "Name" },
      { field: "projectType", label: "Type" },
      { field: "targetDate", label: "Target", kind: "date" },
      { field: "status", label: "Status", kind: "status" },
    ],
  },
};
