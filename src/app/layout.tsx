import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { TooltipProvider } from "@/components/ui/tooltip";
import { LayoutClient } from "@/components/layout/layout-client";
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
  });

  return (
    <html lang="zh-CN">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <TooltipProvider>
          <LayoutClient workspaces={workspaces}>
            {children}
          </LayoutClient>
        </TooltipProvider>
      </body>
    </html>
  );
}
