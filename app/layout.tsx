import type { Metadata, Viewport } from "next";
import { Josefin_Sans } from "next/font/google";
import { Toaster } from "sonner";
import "./globals.css";

// Josefin Sans is a true variable font (weight 100-700) — Next.js loads the
// variable instance automatically when no fixed `weight` is given, same as
// self-hosting the @import from Google Fonts but without a render-blocking
// external request.
const josefinSans = Josefin_Sans({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-josefin",
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
  themeColor: "#050e1a",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={`h-full ${josefinSans.variable}`} suppressHydrationWarning>
      <body className="h-full flex flex-col antialiased">
        {children}
        <Toaster
          position="bottom-right"
          expand={false}
          visibleToasts={3}
          gap={6}
          toastOptions={{
            style: {
              background: "#0d2338",
              border: "1px solid rgba(194,59,48,0.22)",
              color: "#9ba5b2",
              fontSize: "11px",
              fontFamily: "var(--font-display)",
              letterSpacing: "0.03em",
              padding: "6px 10px",
              borderRadius: "6px",
              minHeight: "0",
              minWidth: "0",
              maxWidth: "200px",
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
