"use client";

import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from "react";
import { zh } from "./i18n/zh";
import { en } from "./i18n/en";
export type { TranslationKey } from "./i18n/types";

export type Locale = "zh" | "en";

const translations = { zh, en };

type TranslationKey = keyof typeof zh;

interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: TranslationKey, vars?: Record<string, string>) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  // Always start with "zh" on both server and client to avoid hydration mismatch.
  // The real locale is read from localStorage in useEffect after mount.
  const [locale, setLocaleState] = useState<Locale>("zh");

  useEffect(() => {
    const stored = localStorage.getItem("locale") as Locale | null;
    if (stored && stored !== locale) {
      setLocaleState(stored);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    localStorage.setItem("locale", l);
  }, []);

  const t = useCallback(
    (key: TranslationKey, vars?: Record<string, string>) => {
      let str = translations[locale][key] ?? key;
      if (vars) {
        for (const [k, v] of Object.entries(vars)) {
          str = str.replace(`{${k}}`, v);
        }
      }
      return str;
    },
    [locale]
  );

  return (
    <I18nContext.Provider value={{ locale, setLocale, t }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used within I18nProvider");
  return ctx;
}
