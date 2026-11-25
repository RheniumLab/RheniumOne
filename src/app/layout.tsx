import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { AuthProvider } from "@/lib/auth-context";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Rhenium One",
  description: "Rhenium One — in-house ERP",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Rhenium One", statusBarStyle: "black-translucent" },
  icons: { apple: "/brand/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#18212b",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <head>
        {/* Catch the browser's one-time "installable" event before React loads, and register the service worker early. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `window.addEventListener("beforeinstallprompt",function(e){e.preventDefault();window.__r1Install=e;window.dispatchEvent(new Event("r1-installable"));});
if("serviceWorker" in navigator){window.addEventListener("load",function(){navigator.serviceWorker.register("/sw.js").catch(function(){});});}`,
          }}
        />
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable} font-sans antialiased`}>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
