"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { sendPasswordResetEmail, signInWithEmailAndPassword } from "firebase/auth";
import { auth, firebaseConfigured } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import { logLogin } from "@/lib/data";
import { ErrorBox } from "@/components/ui";

export default function LoginPage() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [setupNeeded, setSetupNeeded] = useState(false);

  useEffect(() => {
    if (!loading && user) router.replace("/");
  }, [loading, user, router]);

  useEffect(() => {
    fetch("/api/setup").then((r) => r.json()).then((j) => setSetupNeeded(Boolean(j.needed))).catch(() => {});
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await signInWithEmailAndPassword(auth(), email, password);
      void logLogin().catch(() => {});
      router.replace("/");
    } catch {
      setErr("Wrong email or password.");
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center p-4">
      <form onSubmit={submit} className="card w-full max-w-sm space-y-4 p-6">
        <div>
          <h1 className="text-xl font-semibold">Rhenium One</h1>
          <p className="text-sm text-muted">Sign in to continue</p>
        </div>
        {!firebaseConfigured && <ErrorBox>Firebase is not configured. See README.md.</ErrorBox>}
        <div><label className="label">Email</label><input className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></div>
        <div><label className="label">Password</label><input className="input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></div>
        {err && <ErrorBox>{err}</ErrorBox>}
        <button className="btn-primary w-full" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
        <button
          type="button"
          className="w-full text-center text-xs text-muted hover:text-brand"
          onClick={async () => {
            if (!email) return setErr("Enter your email first.");
            await sendPasswordResetEmail(auth(), email).catch(() => {});
            setErr(null);
            alert("If that email has an account, a reset link is on its way.");
          }}
        >
          Forgot password?
        </button>
        {setupNeeded && (
          <Link href="/setup" className="block text-center text-sm text-brand hover:underline">First time? Set up Rhenium One →</Link>
        )}
      </form>
    </div>
  );
}
