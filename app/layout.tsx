import type { Metadata, Viewport } from "next";
import { Anta } from "next/font/google";
import { Toaster } from "sonner";
import "./globals.css";

const anta = Anta({
  weight: "400",
  subsets: ["latin"],
  display: "swap",
  variable: "--font-anta",
});

export const metadata: Metadata = {
  title: "Quantz",
  description: "Private NASDAQ scalping hub con Taylor & Bobby",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Quantz",
  },
  icons: {
    icon: [
      { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#030405",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={`h-full ${anta.variable}`} suppressHydrationWarning>
      <body className="h-full flex flex-col antialiased">
        {children}
        <Toaster
          position="bottom-right"
          expand={false}
          visibleToasts={3}
          toastOptions={{
            style: {
              background: "#0c0e12",
              border: "1px solid rgba(168,134,47,0.22)",
              color: "#9aa1ab",
              fontSize: "11px",
              fontFamily: "var(--font-display)",
              letterSpacing: "0.04em",
              padding: "8px 12px",
              borderRadius: "8px",
              minWidth: "0",
              maxWidth: "260px",
            },
            duration: 3500,
          }}
        />
        <script dangerouslySetInnerHTML={{
          __html: `
            if ('serviceWorker' in navigator) {
              window.addEventListener('load', function() {
                navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' });
              });
            }
          `
        }} />
      </body>
    </html>
  );
}
