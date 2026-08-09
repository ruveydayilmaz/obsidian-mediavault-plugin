export type Locale = "en" | "tr";

export const SUPPORTED_LOCALES: { code: Locale; label: string }[] = [
  { code: "en", label: "English" },
  { code: "tr", label: "Türkçe" },
];

export const DEFAULT_LOCALE: Locale = "en";

export type TranslationDict = { [key: string]: string | TranslationDict };

export type TranslationParams = Record<string, string | number>;
