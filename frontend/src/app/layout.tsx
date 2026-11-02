import type { Metadata, Viewport } from "next";
import { Inter, Special_Elite } from "next/font/google";
import { THEME_INIT_SCRIPT } from "@/lib/theme";
import "./globals.css";

// Self-hosted at build time by next/font: no runtime requests to Google.
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const specialElite = Special_Elite({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-special-elite",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Tatar Upload",
  description: "Frontend-only file uploader for TatarBot and friends: presigned POST, PUT and multipart uploads.",
  // Never leak the page URL to storage or API hosts.
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#05070d",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      data-theme="dark"
      suppressHydrationWarning
      className={`${inter.variable} ${specialElite.variable} h-full scroll-smooth antialiased`}
    >
      <head>
        {/* Apply the saved theme before first paint to avoid a flash. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
