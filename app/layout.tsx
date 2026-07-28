import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Axe Capital",
  description: "Bobby's Council — NASDAQ Trading Hub",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full" suppressHydrationWarning>
      <head>
        <style dangerouslySetInnerHTML={{ __html: `@import url('https://fonts.googleapis.com/css2?family=Quantico:ital,wght@0,400;0,700;1,400;1,700&display=swap');` }} />
      </head>
      <body className="h-full flex flex-col antialiased">
        {children}
      </body>
    </html>
  );
}
