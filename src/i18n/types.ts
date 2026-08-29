export type Locale =
  | "en"
  | "tr"
  | "it"
  | "zh-CN"
  | "es-ES"
  | "es-MX"
  | "pt-BR"
  | "pt-PT"
  | "ko-KR";

export const SUPPORTED_LOCALES: { code: Locale; label: string }[] = [
  { code: "en", label: "English" },
  { code: "tr", label: "Türkçe" },
  { code: "it", label: "Italiano" },
  { code: "zh-CN", label: "中文 (简体)" },
  { code: "es-ES", label: "Español (España)" },
  { code: "es-MX", label: "Español (Latinoamérica)" },
  { code: "pt-BR", label: "Português (Brasil)" },
  { code: "pt-PT", label: "Português (Portugal)" },
  { code: "ko-KR", label: "한국어" },
];

export const DEFAULT_LOCALE: Locale = "en";

export type TranslationDict = { [key: string]: string | TranslationDict };

export type TranslationParams = Record<string, string | number>;
