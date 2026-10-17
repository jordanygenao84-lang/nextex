import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "@/context/AuthContext";
import { PwaRegister } from "@/components/layout/PwaRegister";

export const metadata: Metadata = {
  title: "Nextex — AI & Automation Platform",
  description: "Nextex is an AI and automation platform for agents, tasks, tools and autonomous workflows. Developed by Nexora Texter.",
  applicationName: "Nextex",
  authors: [{ name: "Nexora Texter" }],
  manifest: "/manifest.json",
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    shortcut: "/icon.svg",
    apple: [
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
  },
  openGraph: {
    title: "Nextex — AI & Automation Platform",
    description: "Nextex is an AI and automation platform for agents, tasks, tools and autonomous workflows.",
    siteName: "Nextex",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Nextex — AI & Automation Platform",
    description: "Nextex is an AI and automation platform for agents, tasks, tools and autonomous workflows.",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es" className="dark">
      <body className="min-h-screen bg-texter-bg text-texter-text-primary antialiased selection:bg-texter-indigo/30 selection:text-white">
        <PwaRegister />
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
