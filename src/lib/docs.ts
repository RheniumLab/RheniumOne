"use client";

import { arrayUnion } from "firebase/firestore";
import { auth } from "./firebase";
import { createDoc, updateDoc } from "./data";

/** Drive folder names (under RheniumOne). */
export const clientFolder = (c?: Record<string, unknown> | null) => `Clients/${c?.code ?? ""} ${c?.displayName || c?.legalName || "Client"}`.trim();
export const projectFolder = (p?: Record<string, unknown> | null) => `Projects/${p?.code ?? ""} ${p?.name ?? "Project"}`.trim();
export const vendorFolder = (v?: Record<string, unknown> | null) => `Vendors/${v?.code ?? ""} ${v?.name ?? "Vendor"}`.trim();

export const DEFAULT_DOC_FOLDERS = ["Drawings", "Commercial", "Reports", "Photos", "Agreements", "Correspondence"];

export interface DocVersion {
  fileId: string;
  driveId?: string | null;
  name: string;
  uid?: string;
  by?: string;
  at: string;
  size?: number;
  mime?: string;
}

/** A document (with version history) shown in project / client document areas (§6.2). */
export async function addDocRecord(o: {
  name: string;
  folder: string;
  projectId?: string | null;
  clientId?: string | null;
  linked?: { col: string; id: string } | null;
  fileId: string;
  driveId?: string | null;
  billingType?: string;
  size?: number;
  mime?: string;
}) {
  const u = auth().currentUser;
  return createDoc("docs", {
    name: o.name, folder: o.folder, projectId: o.projectId ?? null, clientId: o.clientId ?? null,
    linked: o.linked ?? null, billingType: o.billingType ?? "gst",
    versions: [{ fileId: o.fileId, driveId: o.driveId ?? null, name: o.name, uid: u?.uid, by: u?.displayName || u?.email, at: new Date().toISOString(), size: o.size ?? null, mime: o.mime ?? null }],
  });
}

export async function addDocVersion(docId: string, v: Omit<DocVersion, "at" | "uid" | "by">) {
  const u = auth().currentUser;
  await updateDoc("docs", docId, { versions: arrayUnion({ ...v, uid: u?.uid, by: u?.displayName || u?.email, at: new Date().toISOString() }) });
}
