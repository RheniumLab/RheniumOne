import type { ReactNode } from "react";

/** Branded full-screen frame for sign-in and setup: charcoal with a soft Rhenium orange glow. */
export function BrandScreen({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-charcoal p-4">
      <div className="pointer-events-none absolute -left-32 top-1/4 h-96 w-96 rounded-full bg-brand/25 blur-3xl" />
      <div className="pointer-events-none absolute -right-24 bottom-0 h-80 w-80 rounded-full bg-brand-2/20 blur-3xl" />
      <div className="relative w-full max-w-sm overflow-hidden theme-light rounded-xl bg-white shadow-2xl">
        <div className="bg-brand-gradient h-1" />
        <div className="space-y-5 p-6">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/logo.png" alt="Rhenium — Innovation in Motion" className="mx-auto h-auto w-44" />
          {children}
        </div>
      </div>
      <p className="absolute bottom-4 text-xs tracking-[0.3em] text-white/40">RHENIUM ONE</p>
    </div>
  );
}
