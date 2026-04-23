import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { TooltipProvider } from "@/components/ui/tooltip";
import { LayoutClient } from "@/components/layout/layout-client";
import { I18nProvider } from "@/lib/i18n";
import { ThemeProvider } from "@/components/providers/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { db } from "@/lib/db";
import { getOnboardingStatus } from "@/actions/onboarding-actions";
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
  title: "AI Task Platform - Tower",
  description: "AI task orchestration and multi-project management platform",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const [workspaces, onboardingStatus] = await Promise.all([
    db.workspace.findMany({
      orderBy: { updatedAt: "desc" },
      select: { id: true, name: true, description: true, updatedAt: true },
    }),
    getOnboardingStatus(),
  ]);

  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,300..700;1,9..40,300..700&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet" />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          <TooltipProvider>
            <I18nProvider>
              <LayoutClient workspaces={workspaces} isFirstRun={onboardingStatus.isFirstRun} username={onboardingStatus.username}>
                {children}
              </LayoutClient>
              <Toaster richColors position="top-right" />
            </I18nProvider>
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
