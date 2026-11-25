"use client";

import { collection, doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { auth, db } from "./firebase";

/**
 * Bills and receipts are stored as compressed data URLs in Firestore
 * (`attachments`). Firebase Storage needs the paid Blaze plan for new
 * projects; Firestore is free (1 GiB) and queues writes offline, so a bill
 * photo taken at a site with no signal syncs later with its entry.
 */
const MAX_BYTES = 900_000; // Firestore documents are limited to 1 MiB.

async function compressImage(file: File): Promise<string> {
  const img = await createImageBitmap(file);
  let maxSide = 1600;
  let quality = 0.7;
  for (let i = 0; i < 6; i++) {
    const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
    const url = canvas.toDataURL("image/jpeg", quality);
    if (url.length < MAX_BYTES) return url;
    maxSide *= 0.8;
    quality -= 0.1;
  }
  throw new Error("Image is too large even after compression.");
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = () => rej(r.error);
    r.readAsDataURL(file);
  });
}

export async function saveAttachment(file: File, meta: { billingType?: string; linked?: string } = {}) {
  let data: string;
  if (file.type.startsWith("image/")) data = await compressImage(file);
  else {
    data = await readAsDataUrl(file);
    if (data.length > MAX_BYTES) throw new Error("PDF is too large (limit about 650 KB). Take a photo instead or compress the PDF.");
  }
  const ref = doc(collection(db(), "attachments"));
  void setDoc(ref, {
    name: file.name,
    type: file.type.startsWith("image/") ? "image/jpeg" : file.type,
    data,
    billingType: meta.billingType ?? "gst",
    linked: meta.linked ?? null,
    uid: auth().currentUser?.uid,
    at: serverTimestamp(),
  });
  return ref.id;
}

export async function openAttachment(id: string) {
  const s = await getDoc(doc(db(), "attachments", id));
  const d = s.data();
  if (!d) return alert("Attachment not found");
  const blob = await (await fetch(d.data)).blob();
  window.open(URL.createObjectURL(blob), "_blank");
}
