import en from "./locales/en";
import tr from "./locales/tr";
import it from "./locales/it";
import zhCN from "./locales/zh-CN";
import esES from "./locales/es-ES";
import esMX from "./locales/es-MX";
import ptBR from "./locales/pt-BR";
import ptPT from "./locales/pt-PT";
import koKR from "./locales/ko-KR";
import {
  DEFAULT_LOCALE,
  Locale,
  TranslationDict,
  TranslationParams,
} from "./types";

const LOCALES: Record<Locale, TranslationDict> = {
  en,
  tr,
  it,
  "zh-CN": zhCN,
  "es-ES": esES,
  "es-MX": esMX,
  "pt-BR": ptBR,
  "pt-PT": ptPT,
  "ko-KR": koKR,
};

const LOCALE_INTL_TAG: Record<Locale, string> = {
  en: "en-US",
  tr: "tr-TR",
  it: "it-IT",
  "zh-CN": "zh-CN",
  "es-ES": "es-ES",
  "es-MX": "es-MX",
  "pt-BR": "pt-BR",
  "pt-PT": "pt-PT",
  "ko-KR": "ko-KR",
};

const LOCALE_RUNTIME_UNITS: Record<Locale, { hour: string; minute: string }> = {
  en: { hour: "h", minute: "m" },
  tr: { hour: "s", minute: "dk" },
  it: { hour: "h", minute: "min" },
  "zh-CN": { hour: "时", minute: "分" },
  "es-ES": { hour: "h", minute: "min" },
  "es-MX": { hour: "h", minute: "min" },
  "pt-BR": { hour: "h", minute: "min" },
  "pt-PT": { hour: "h", minute: "min" },
  "ko-KR": { hour: "시간", minute: "분" },
};

type Listener = (locale: Locale) => void;

export class I18nService {
  private locale: Locale = DEFAULT_LOCALE;
  private listeners: Set<Listener> = new Set();

  setLocale(locale: Locale): void {
    if (!LOCALES[locale]) locale = DEFAULT_LOCALE;
    if (this.locale === locale) return;
    this.locale = locale;
    for (const listener of this.listeners) listener(this.locale);
  }

  getLocale(): Locale {
    return this.locale;
  }

  onChange(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private lookup(dict: TranslationDict, key: string): string | undefined {
    const parts = key.split(".");
    let node: string | TranslationDict = dict;
    for (const part of parts) {
      if (node == null || typeof node !== "object") return undefined;
      const next: string | TranslationDict | undefined = node[part];
      if (next === undefined) return undefined;
      node = next;
    }
    return typeof node === "string" ? node : undefined;
  }

  private interpolate(str: string, params?: TranslationParams): string {
    if (!params) return str;
    return str.replace(/\{(\w+)\}/g, (match: string, key: string) => {
      const value = params[key];
      return value === undefined ? match : String(value);
    });
  }

  t(key: string, params?: TranslationParams): string {
    const current = LOCALES[this.locale];
    let str = this.lookup(current, key);
    if (str === undefined && this.locale !== DEFAULT_LOCALE) {
      str = this.lookup(LOCALES[DEFAULT_LOCALE], key);
    }
    if (str === undefined) return key;
    return this.interpolate(str, params);
  }

  private get intlLocale(): string {
    return LOCALE_INTL_TAG[this.locale] ?? LOCALE_INTL_TAG[DEFAULT_LOCALE];
  }

  formatNumber(n: number, options?: Intl.NumberFormatOptions): string {
    return new Intl.NumberFormat(this.intlLocale, options).format(n);
  }

  formatPercent(n: number): string {
    return new Intl.NumberFormat(this.intlLocale, {
      style: "percent",
      maximumFractionDigits: 0,
    }).format(n);
  }

  formatRating(n: number): string {
    return new Intl.NumberFormat(this.intlLocale, {
      maximumFractionDigits: 1,
      minimumFractionDigits: n % 1 === 0 ? 0 : 1,
    }).format(n);
  }

  formatRuntime(totalMinutes: number): string {
    const hours = Math.floor(totalMinutes / 60);
    const minutes = Math.round(totalMinutes % 60);
    const units = LOCALE_RUNTIME_UNITS[this.locale] ?? LOCALE_RUNTIME_UNITS[DEFAULT_LOCALE];
    const hUnit = units.hour;
    const mUnit = units.minute;
    if (hours <= 0) return `${minutes}${mUnit}`;
    if (minutes <= 0) return `${hours}${hUnit}`;
    return `${hours}${hUnit} ${minutes}${mUnit}`;
  }

  formatDate(iso: string, options?: Intl.DateTimeFormatOptions): string {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso;
    return new Intl.DateTimeFormat(
      this.intlLocale,
      options ?? { year: "numeric", month: "short", day: "numeric" },
    ).format(date);
  }

  formatMonthYear(iso: string): string {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso;
    return new Intl.DateTimeFormat(this.intlLocale, {
      year: "numeric",
      month: "long",
    }).format(date);
  }

  formatWeekday(iso: string): string {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso;
    return new Intl.DateTimeFormat(this.intlLocale, { weekday: "long" }).format(
      date,
    );
  }

  formatRelativeTime(iso: string): string {
    const then = new Date(iso).getTime();
    if (Number.isNaN(then)) return iso;
    const diffMs = Date.now() - then;
    const diffMinutes = Math.floor(diffMs / 60000);

    if (diffMinutes < 1) return this.t("common.justNow");
    if (diffMinutes < 60)
      return this.t("common.minutesAgo", { n: diffMinutes });

    const diffHours = Math.floor(diffMinutes / 60);
    if (diffHours < 24) return this.t("common.hoursAgo", { n: diffHours });

    const diffDays = Math.floor(diffHours / 24);
    if (diffDays === 1) return this.t("common.yesterday");
    if (diffDays < 7) return this.t("common.daysAgo", { n: diffDays });
    if (diffDays < 14) return this.t("common.lastWeek");
    if (diffDays < 30) {
      try {
        const rtf = new Intl.RelativeTimeFormat(this.intlLocale, {
          numeric: "auto",
        });
        return rtf.format(-Math.floor(diffDays / 7), "week");
      } catch {
        return this.t("common.daysAgo", { n: diffDays });
      }
    }
    if (diffDays < 60) return this.t("common.lastMonth");

    return this.formatDate(iso);
  }
}

export const i18n = new I18nService();

export function t(key: string, params?: TranslationParams): string {
  return i18n.t(key, params);
}
