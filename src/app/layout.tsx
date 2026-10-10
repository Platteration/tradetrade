import type { Metadata } from "next";
import { connection } from "next/server";
import { site } from "@/lib/site";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: `${site.name} — Coming soon`, template: `%s | ${site.name}` },
  description: site.description,
  robots: { index: false, follow: false },
  icons: { icon: "/icon.svg" },
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // Render per request so Next can apply the nonce supplied by the proxy.
  await connection();

  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main">Skip to content</a>
        {children}
      </body>
    </html>
  );
}
