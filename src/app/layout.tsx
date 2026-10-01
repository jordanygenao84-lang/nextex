import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Nextex — AI & Automation Platform",
  description: "Nextex is an AI and automation platform for agents, tasks, tools and autonomous workflows. Developed by Nexora Texter.",
  applicationName: "Nextex",
  authors: [{ name: "Nexora Texter" }],
  icons: {
    icon: "/icon.svg",
    shortcut: "/icon.svg",
    apple: "/icon.svg",
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
        {children}
      </body>
    </html>
  );
}
