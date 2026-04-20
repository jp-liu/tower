import type { zh } from "./zh";

export type TranslationKey = keyof typeof zh;
export type Translations = Record<TranslationKey, string>;
