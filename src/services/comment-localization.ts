import { TraktComment } from "../api/trakt";

export function filterAndSortCommentsByLanguage(
  comments: TraktComment[],
  primaryLanguage: string,
  additionalLanguages: string[],
): TraktComment[] {
  const priority = [primaryLanguage, ...additionalLanguages].filter(
    (l) => l.trim().length > 0,
  );
  if (priority.length === 0) return comments;

  const rank = new Map(priority.map((lang, i) => [lang.toLowerCase(), i]));

  return comments
    .filter((c) => c.language !== null && rank.has(c.language.toLowerCase()))
    .sort((a, b) => {
      const rankA = rank.get((a.language as string).toLowerCase()) as number;
      const rankB = rank.get((b.language as string).toLowerCase()) as number;
      return rankA - rankB;
    });
}
