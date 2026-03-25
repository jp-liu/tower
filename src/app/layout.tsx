import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { TooltipProvider } from "@/components/ui/tooltip";
import { LayoutClient } from "@/components/layout/layout-client";
import { I18nProvider } from "@/lib/i18n";
import { db } from "@/lib/db";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "AI Manager - 项目管理平台",
  description: "AI 项目管理看板和任务执行平台",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const workspaces = await db.workspace.findMany({
    orderBy: { updatedAt: "desc" },
    select: { id: true, name: true, description: true, updatedAt: true },
  });

  return (
    <html lang="zh-CN">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,300..700;1,9..40,300..700&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet" />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <TooltipProvider>
          <I18nProvider>
            <LayoutClient workspaces={workspaces}>
              {children}
            </LayoutClient>
          </I18nProvider>
        </TooltipProvider>
      </body>
    </html>
  );
}
