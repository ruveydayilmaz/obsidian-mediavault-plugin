export function parseFlexibleDate(raw: string | null): string | null {
  if (!raw) return null;
  const parsed = new Date(raw);
  if (isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

export function normalizeTitle(title: string): string {
  return title
    .normalize("NFKD")
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/['"]/g, "")
    .replace(/&/g, " and ")
    .replace(/[:\-–—_,.!?()[\]{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function stripSubtitle(title: string): string | null {
  const match = title.match(/^(.+?)\s*[:\-–—]\s+.+$/);
  return match ? match[1].trim() : null;
}

const KNOWN_COUNTRY_CODES = new Set([
  "US",
  "UK",
  "GB",
  "KR",
  "JP",
  "CN",
  "TW",
  "HK",
  "IN",
  "FR",
  "DE",
  "ES",
  "IT",
  "BR",
  "MX",
  "CA",
  "AU",
  "NZ",
  "TH",
  "RU",
  "SE",
  "NO",
  "DK",
  "FI",
  "NL",
  "BE",
  "PL",
  "TR",
  "PH",
  "ID",
  "VN",
  "AR",
  "PT",
  "GR",
  "CZ",
  "IE",
  "AT",
  "CH",
  "ZA",
  "EG",
  "SA",
  "AE",
  "IL",
  "SG",
  "MY",
  "CO",
  "CL",
  "PE",
  "HU",
  "RO",
  "UA",
]);

const KNOWN_LANGUAGE_NAMES: Record<string, string> = {
  english: "en",
  korean: "ko",
  japanese: "ja",
  mandarin: "zh",
  cantonese: "zh",
  chinese: "zh",
  spanish: "es",
  french: "fr",
  german: "de",
  italian: "it",
  portuguese: "pt",
  russian: "ru",
  thai: "th",
  hindi: "hi",
  arabic: "ar",
  turkish: "tr",
  dutch: "nl",
  swedish: "sv",
  norwegian: "no",
  danish: "da",
  polish: "pl",
  vietnamese: "vi",
  indonesian: "id",
  filipino: "tl",
  tagalog: "tl",
  greek: "el",
  finnish: "fi",
  czech: "cs",
  hungarian: "hu",
  romanian: "ro",
  ukrainian: "uk",
};

export interface TitleMetadata {
  title: string;
  year: number | null;
  country: string | null;
  language: string | null;
  alternateTitle: string | null;
}

export function extractTitleMetadata(rawTitle: string): TitleMetadata {
  let title = rawTitle.trim();
  let year: number | null = null;
  let country: string | null = null;
  let language: string | null = null;
  let alternateTitle: string | null = null;

  for (let i = 0; i < 4; i++) {
    const match = title.match(/^(.*?)\s*\(([^()]+)\)\s*$/);
    if (!match) break;
    const [, rest, raw] = match;
    const content = raw.trim();

    if (/^\d{4}$/.test(content)) {
      const asNum = Number(content);
      if (asNum >= 1900 && asNum <= 2100 && year === null) {
        year = asNum;
        title = rest.trim();
        continue;
      }
    }

    if (
      /^[A-Za-z]{2,3}$/.test(content) &&
      KNOWN_COUNTRY_CODES.has(content.toUpperCase()) &&
      country === null
    ) {
      country = content.toUpperCase();
      title = rest.trim();
      continue;
    }

    const languageCode = KNOWN_LANGUAGE_NAMES[content.toLowerCase()];
    if (languageCode && language === null) {
      language = languageCode;
      title = rest.trim();
      continue;
    }

    if (alternateTitle === null) {
      alternateTitle = content;
      title = rest.trim();
    }
    break;
  }

  return { title: title.trim(), year, country, language, alternateTitle };
}

function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let prevRow = Array.from({ length: b.length + 1 }, (_, j) => j);

  for (let i = 1; i <= a.length; i++) {
    const currRow = [i];
    for (let j = 1; j <= b.length; j++) {
      currRow[j] =
        a[i - 1] === b[j - 1]
          ? prevRow[j - 1]
          : 1 + Math.min(prevRow[j - 1], prevRow[j], currRow[j - 1]);
    }
    prevRow = currRow;
  }

  return prevRow[b.length];
}

export function titleSimilarity(a: string, b: string): number {
  const na = normalizeTitle(a);
  const nb = normalizeTitle(b);
  if (na === nb) return 1;

  const maxLen = Math.max(na.length, nb.length);
  if (maxLen === 0) return 1;

  return 1 - levenshteinDistance(na, nb) / maxLen;
}
