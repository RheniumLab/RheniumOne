"use client";

import { addDoc, collection, serverTimestamp, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useCollection } from "@/lib/hooks";

/** Category picker that lets permitted users add a category from the entry screen (§4.3). */
export function CategorySelect({ type, value, onChange, required }: { type: "company" | "project" | "income"; value: string; onChange: (v: string) => void; required?: boolean }) {
  const { rows } = useCollection("categories", [where("type", "==", type)], {}, [type]);
  const names = rows.filter((r) => r.active !== false).map((r) => String(r.name)).sort();
  return (
    <select
      className="input"
      value={value}
      required={required}
      onChange={async (e) => {
        if (e.target.value === "__new") {
          const name = prompt("New category name")?.trim();
          if (name) {
            void addDoc(collection(db(), "categories"), { type, name, active: true, createdAt: serverTimestamp() });
            onChange(name);
          }
          return;
        }
        onChange(e.target.value);
      }}
    >
      <option value="">Select category</option>
      {names.map((n) => <option key={n}>{n}</option>)}
      {value && !names.includes(value) && <option>{value}</option>}
      <option value="__new">+ Add category…</option>
    </select>
  );
}
