"use client";

import { useEffect, useState } from "react";
import { Download, Share, SquarePlus, X } from "lucide-react";

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const isStandalone = () =>
  window.matchMedia("(display-mode: standalone)").matches ||
  window.matchMedia("(display-mode: fullscreen)").matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true;

const isIos = () =>
  /iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

const isPhoneOrTablet = () =>
  /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || isIos();

/**
 * "Install app" button for phones and tablets. Hidden on desktop and when
 * the app is already running as an installed app.
 */
export function InstallApp() {
  const [show, setShow] = useState(false);
  const [prompt, setPrompt] = useState<InstallPromptEvent | null>(null);
  const [help, setHelp] = useState(false);
  const [ios, setIos] = useState(false);

  useEffect(() => {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
    if (isStandalone() || !isPhoneOrTablet()) return;
    setIos(isIos());
    setShow(true);
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setPrompt(e as InstallPromptEvent);
    };
    const onInstalled = () => {
      setShow(false);
      setHelp(false);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (!show) return null;

  async function install() {
    if (prompt) {
      await prompt.prompt();
      const { outcome } = await prompt.userChoice;
      setPrompt(null);
      if (outcome === "accepted") setShow(false);
      return;
    }
    setHelp(true);
  }

  return (
    <>
      <button className="btn-primary !px-2.5 !py-1.5 text-xs" onClick={install} title="Install Rhenium One on this phone">
        <Download size={14} /> Install app
      </button>
      {help && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-3 sm:items-center" onClick={() => setHelp(false)}>
          <div className="w-full max-w-sm overflow-hidden rounded-xl bg-surface shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="bg-brand-gradient h-1" />
            <div className="space-y-4 p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/brand/icon-192.png" alt="" className="h-11 w-11 rounded-lg border border-border" />
                  <div>
                    <div className="font-semibold">Install Rhenium One</div>
                    <div className="text-xs text-muted">Opens like an app, full screen, from your home screen</div>
                  </div>
                </div>
                <button onClick={() => setHelp(false)} className="text-muted" aria-label="Close"><X size={18} /></button>
              </div>
              {ios ? (
                <ol className="space-y-3 text-sm">
                  <li className="flex items-center gap-3"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand text-xs font-bold text-white">1</span><span>Tap the <b>Share</b> button <Share size={15} className="inline text-brand" /> in Safari’s toolbar</span></li>
                  <li className="flex items-center gap-3"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand text-xs font-bold text-white">2</span><span>Scroll and tap <b>Add to Home Screen</b> <SquarePlus size={15} className="inline text-brand" />, then <b>Add</b></span></li>
                  <li className="text-xs text-muted">Using Chrome on iPhone? Open this page in <b>Safari</b> first.</li>
                </ol>
              ) : (
                <ol className="space-y-3 text-sm">
                  <li className="flex items-center gap-3"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand text-xs font-bold text-white">1</span><span>Open the browser menu <b>⋮</b> (top right)</span></li>
                  <li className="flex items-center gap-3"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand text-xs font-bold text-white">2</span><span>Tap <b>Install app</b> or <b>Add to Home screen</b>, then <b>Install</b></span></li>
                </ol>
              )}
              <button className="btn w-full" onClick={() => setHelp(false)}>Got it</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
