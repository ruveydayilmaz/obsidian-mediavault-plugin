export interface ParsedSeasonEpisode {
  baseTitle: string;
  season: number | null;
  episode: number | null;
}

interface Pattern {
  regex: RegExp;
  extract: (m: RegExpMatchArray) => {
    season: number | null;
    episode: number | null;
  };
}

const PATTERNS: Pattern[] = [
  // "S01E05", "S1E5", "S01 E05"
  {
    regex: /\bS(\d{1,2})\s?E(\d{1,3})\b/i,
    extract: (m) => ({
      season: parseInt(m[1], 10),
      episode: parseInt(m[2], 10),
    }),
  },
  // "1x03", "12x3"
  {
    regex: /\b(\d{1,2})x(\d{1,3})\b/i,
    extract: (m) => ({
      season: parseInt(m[1], 10),
      episode: parseInt(m[2], 10),
    }),
  },
  // "Season 1 Episode 3", "Season 01, Episode 003"
  {
    regex: /\bSeason\s?(\d{1,2}),?\s+Episode\s?(\d{1,3})\b/i,
    extract: (m) => ({
      season: parseInt(m[1], 10),
      episode: parseInt(m[2], 10),
    }),
  },
  // "S01" alone (no episode)
  {
    regex: /\bS(\d{1,2})\b/i,
    extract: (m) => ({ season: parseInt(m[1], 10), episode: null }),
  },
  // "Season 1", "Season 01" alone
  {
    regex: /\bSeason\s?(\d{1,2})\b/i,
    extract: (m) => ({ season: parseInt(m[1], 10), episode: null }),
  },
];

export function parseSeasonEpisodeFromTitle(
  rawTitle: string,
): ParsedSeasonEpisode | null {
  for (const pattern of PATTERNS) {
    const match = rawTitle.match(pattern.regex);
    if (!match) continue;

    const { season, episode } = pattern.extract(match);
    const baseTitle = (
      rawTitle.slice(0, match.index) +
      rawTitle.slice((match.index ?? 0) + match[0].length)
    )
      .replace(/[-–—:]\s*$/, "")
      .replace(/\s+/g, " ")
      .trim();

    if (!baseTitle) continue;

    return { baseTitle, season, episode };
  }

  return null;
}
