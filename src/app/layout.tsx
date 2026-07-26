import type { Metadata } from "next";
import { TooltipProvider } from "@/components/ui/tooltip";
import { LayoutClient } from "@/components/layout/layout-client";
import { I18nProvider } from "@/lib/i18n";
import { ThemeProvider } from "@/components/providers/theme-provider";
import { ExtensionProvider } from "@/lib/extensions/context";
import { ShortcutProvider } from "@/lib/shortcuts";
import { Toaster } from "@/components/ui/sonner";
import { db } from "@/lib/db";
import { getOnboardingStatus } from "@/actions/onboarding-actions";
import { listAllExtensionStatus } from "@/actions/extension-actions";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI Task Platform - Tower",
  description: "AI task orchestration and multi-project management platform",
};

// Layout reads per-user SQLite state (workspaces, onboarding.username, extension paths).
// Without force-dynamic, `next build` prerenders it on the publisher's machine and bakes
// that state into .next/server/app/*.rsc — users then see the publisher's name flash
// before hydration replaces it with theirs.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const [workspaces, onboardingStatus, extensionStatus] = await Promise.all([
    db.workspace.findMany({
      orderBy: [{ order: "asc" }, { updatedAt: "desc" }],
      select: { id: true, name: true, description: true, updatedAt: true },
    }),
    getOnboardingStatus(),
    listAllExtensionStatus(),
  ]);

  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body className="antialiased">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          <TooltipProvider>
            <I18nProvider>
              <ShortcutProvider>
                <ExtensionProvider initialStatus={extensionStatus}>
                  <LayoutClient workspaces={workspaces} isFirstRun={onboardingStatus.isFirstRun} username={onboardingStatus.username}>
                    {children}
                  </LayoutClient>
                  <Toaster richColors position="top-right" />
                </ExtensionProvider>
              </ShortcutProvider>
            </I18nProvider>
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
