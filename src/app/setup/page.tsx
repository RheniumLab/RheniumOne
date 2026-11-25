"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signInWithEmailAndPassword } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { ErrorBox } from "@/components/ui";

export default function SetupPage() {
  const router = useRouter();
  const [v, setV] = useState({ name: "", email: "", password: "", setupKey: "" });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const res = await fetch("/api/setup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(v) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      setErr(j.error ?? "Setup failed");
      setBusy(false);
      return;
    }
    await signInWithEmailAndPassword(auth(), v.email, v.password);
    router.replace("/settings");
  }

  return (
    <div className="flex min-h-dvh items-center justify-center p-4">
      <form onSubmit={submit} className="card w-full max-w-sm space-y-4 p-6">
        <div>
          <h1 className="text-xl font-semibold">Set up Rhenium One</h1>
          <p className="text-sm text-muted">Creates the admin login, the starting roles and categories. This works only once.</p>
        </div>
        <div><label className="label">Your name</label><input className="input" required value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></div>
        <div><label className="label">Email</label><input className="input" type="email" required value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} /></div>
        <div><label className="label">Password (8+ characters)</label><input className="input" type="password" minLength={8} required value={v.password} onChange={(e) => setV({ ...v, password: e.target.value })} /></div>
        <div><label className="label">Setup key</label><input className="input" required value={v.setupKey} onChange={(e) => setV({ ...v, setupKey: e.target.value })} /><p className="mt-1 text-xs text-muted">The SETUP_KEY value from the server environment.</p></div>
        {err && <ErrorBox>{err}</ErrorBox>}
        <button className="btn-primary w-full" disabled={busy}>{busy ? "Setting up…" : "Create admin"}</button>
      </form>
    </div>
  );
}
