import {
  TraktHttpClient,
  TraktClientConfig,
  TraktApiError,
  TraktAuthError,
} from "./trakt-http-client";
import { TTLCache } from "./tmdb-cache";

export type TraktMediaKind = "movies" | "episodes" | "shows";

export interface TraktIds {
  trakt: number;
  tmdb: number | null;
  imdb: string | null;
}

export interface TraktComment {
  id: number;
  comment: string;
  createdAt: string;
  spoiler: boolean;
  review: boolean;
  likes: number;
  userName: string;
  language: string | null;
  userRating: number | null;
  avatarUrl: string | null;
}

export type TraktCommentTarget =
  | { kind: "movie"; tmdbId: number }
  | { kind: "show"; tmdbId: number }
  | {
      kind: "episode";
      showTmdbId: number;
      season: number;
      episode: number;
      episodeTmdbId: number;
    };

export interface TraktHistoryItem {
  id: number; // Trakt's history entry id
  watchedAt: string;
  type: "movie" | "episode";
  movie?: { title: string; year: number | null; ids: TraktIds };
  show?: { title: string; year: number | null; ids: TraktIds };
  episode?: { season: number; number: number; title: string };
}

export interface TraktRatingItem {
  ratedAt: string;
  rating: number;
  type: "movie" | "episode" | "show";
  movie?: { title: string; year: number | null; ids: TraktIds };
  show?: { title: string; year: number | null; ids: TraktIds };
  episode?: { season: number; number: number; title: string };
}

interface TraktRawIds {
  trakt: number;
  tmdb?: number;
  imdb?: string;
}

interface TraktRawMovie {
  title: string;
  year?: number;
  ids: TraktRawIds;
}

interface TraktRawShow {
  title: string;
  year?: number;
  ids: TraktRawIds;
}

interface TraktRawEpisode {
  season: number;
  number: number;
  title: string;
}

interface TraktRawHistoryEntry {
  id: number;
  watched_at: string;
  type: "movie" | "episode";
  movie?: TraktRawMovie;
  show?: TraktRawShow;
  episode?: TraktRawEpisode;
}

interface TraktRawRatingEntry {
  rated_at: string;
  rating: number;
  type: "movie" | "episode" | "show";
  movie?: TraktRawMovie;
  show?: TraktRawShow;
  episode?: TraktRawEpisode;
}

interface TraktRawSearchResult {
  movie?: { ids: TraktRawIds };
  show?: { ids: TraktRawIds };
}

interface TraktRawComment {
  id: number;
  comment: string;
  created_at: string;
  spoiler?: boolean;
  review?: boolean;
  likes?: number;
  user?: {
    username?: string;
    images?: { avatar?: { full?: string } };
  };
  language?: string;
  user_rating?: number;
}

interface TraktRawUserSettings {
  user?: { username?: string };
}

function normalizeIds(raw: TraktRawIds | undefined): TraktIds {
  return {
    trakt: raw?.trakt ?? 0,
    tmdb: raw?.tmdb ?? null,
    imdb: raw?.imdb ?? null,
  };
}

export function describeTraktError(err: unknown): string {
  if (err instanceof TraktAuthError)
    return "your Trakt connection has expired. Reconnect in Settings.";
  if (err instanceof TraktApiError) {
    if (err.status === 429)
      return "Trakt is rate-limiting requests right now. Try again in a moment.";
    if (err.status === 409) return "Trakt already has this.";
    if (err.status === 422)
      return "Trakt rejected the comment (check its length and content).";
    if (err.status !== null && err.status >= 500)
      return "Trakt's servers are having trouble. Try again shortly.";
    return err.message;
  }
  return err instanceof Error ? err.message : "an unknown error occurred.";
}

export class TraktService {
  private http: TraktHttpClient;
  private cache = new TTLCache<unknown>(() => 30 * 60 * 1000);

  constructor(config: TraktClientConfig) {
    this.http = new TraktHttpClient(config);
  }

  private async cached<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
    const hit = this.cache.get(key) as T | undefined;
    if (hit !== undefined) return hit;
    const value = await fetcher();
    this.cache.set(key, value);
    return value;
  }

  clearCache(): void {
    this.cache.clear();
  }

  async getHistory(
    type: "movies" | "episodes",
    page = 1,
    limit = 100,
  ): Promise<TraktHistoryItem[]> {
    const raw = await this.http.request<TraktRawHistoryEntry[]>(
      `/sync/history/${type}?page=${page}&limit=${limit}`,
    );
    return raw.map((r) => ({
      id: r.id,
      watchedAt: r.watched_at,
      type: r.type,
      movie: r.movie
        ? {
            title: r.movie.title,
            year: r.movie.year ?? null,
            ids: normalizeIds(r.movie.ids),
          }
        : undefined,
      show: r.show
        ? {
            title: r.show.title,
            year: r.show.year ?? null,
            ids: normalizeIds(r.show.ids),
          }
        : undefined,
      episode: r.episode
        ? {
            season: r.episode.season,
            number: r.episode.number,
            title: r.episode.title,
          }
        : undefined,
    }));
  }

  async getRatings(
    type: "movies" | "episodes" | "shows",
  ): Promise<TraktRatingItem[]> {
    const raw = await this.http.request<TraktRawRatingEntry[]>(`/sync/ratings/${type}`);
    return raw.map((r) => ({
      ratedAt: r.rated_at,
      rating: r.rating,
      type: r.type,
      movie: r.movie
        ? {
            title: r.movie.title,
            year: r.movie.year ?? null,
            ids: normalizeIds(r.movie.ids),
          }
        : undefined,
      show: r.show
        ? {
            title: r.show.title,
            year: r.show.year ?? null,
            ids: normalizeIds(r.show.ids),
          }
        : undefined,
      episode: r.episode
        ? {
            season: r.episode.season,
            number: r.episode.number,
            title: r.episode.title,
          }
        : undefined,
    }));
  }

  async addMovieToHistory(tmdbId: number, watchedAt: string): Promise<void> {
    await this.http.request("/sync/history", {
      method: "POST",
      body: { movies: [{ ids: { tmdb: tmdbId }, watched_at: watchedAt }] },
    });
  }

  async addEpisodeToHistory(
    showTmdbId: number,
    season: number,
    episode: number,
    watchedAt: string,
  ): Promise<void> {
    await this.http.request("/sync/history", {
      method: "POST",
      body: {
        shows: [
          {
            ids: { tmdb: showTmdbId },
            seasons: [
              {
                number: season,
                episodes: [{ number: episode, watched_at: watchedAt }],
              },
            ],
          },
        ],
      },
    });
  }

  async addMovieRating(
    tmdbId: number,
    rating: number,
    ratedAt: string,
  ): Promise<void> {
    await this.http.request("/sync/ratings", {
      method: "POST",
      body: {
        movies: [
          {
            ids: { tmdb: tmdbId },
            rating: Math.round(rating),
            rated_at: ratedAt,
          },
        ],
      },
    });
  }

  private async resolveTraktId(
    tmdbId: number,
    kind: "movie" | "show",
  ): Promise<number | null> {
    return this.cached(`resolve:${kind}:${tmdbId}`, async () => {
      const raw = await this.http.request<TraktRawSearchResult[]>(
        `/search/tmdb/${tmdbId}?type=${kind}`,
        {
          authenticated: false,
        },
      );
      const match = raw[0];
      const ids = kind === "movie" ? match?.movie?.ids : match?.show?.ids;
      return ids?.trakt ?? null;
    });
  }

  private normalizeComments(raw: TraktRawComment[]): TraktComment[] {
    return raw.map((c) => ({
      id: c.id,
      comment: c.comment,
      createdAt: c.created_at,
      spoiler: !!c.spoiler,
      review: !!c.review,
      likes: c.likes ?? 0,
      userName: c.user?.username ?? "trakt user",
      language:
        typeof c.language === "string" && c.language.length > 0
          ? c.language
          : null,
      userRating: typeof c.user_rating === "number" ? c.user_rating : null,
      avatarUrl:
        typeof c.user?.images?.avatar?.full === "string"
          ? c.user.images.avatar.full
          : null,
    }));
  }

  async getMovieComments(tmdbId: number): Promise<TraktComment[]> {
    return this.cached(`comments:movie:${tmdbId}`, async () => {
      const traktId = await this.resolveTraktId(tmdbId, "movie");
      if (traktId === null) return [];
      const raw = await this.http.request<TraktRawComment[]>(
        `/movies/${traktId}/comments/newest?extended=full`,
        {
          authenticated: false,
        },
      );
      return this.normalizeComments(raw);
    });
  }

  async getShowComments(tmdbId: number): Promise<TraktComment[]> {
    return this.cached(`comments:show:${tmdbId}`, async () => {
      const traktId = await this.resolveTraktId(tmdbId, "show");
      if (traktId === null) return [];
      const raw = await this.http.request<TraktRawComment[]>(
        `/shows/${traktId}/comments/newest?extended=full`,
        {
          authenticated: false,
        },
      );
      return this.normalizeComments(raw);
    });
  }

  async getEpisodeComments(
    showTmdbId: number,
    season: number,
    episode: number,
  ): Promise<TraktComment[]> {
    return this.cached(
      `comments:episode:${showTmdbId}:${season}:${episode}`,
      async () => {
        const traktId = await this.resolveTraktId(showTmdbId, "show");
        if (traktId === null) return [];
        const raw = await this.http.request<TraktRawComment[]>(
          `/shows/${traktId}/seasons/${season}/episodes/${episode}/comments/newest?extended=full`,
          { authenticated: false },
        );
        return this.normalizeComments(raw);
      },
    );
  }

  async getCurrentUser(): Promise<{ username: string } | null> {
    return this.cached("me:settings", async () => {
      try {
        const raw =
          await this.http.request<TraktRawUserSettings>("/users/settings");
        return raw?.user?.username
          ? { username: raw.user.username }
          : null;
      } catch {
        return null;
      }
    });
  }

  async postComment(
    target: TraktCommentTarget,
    text: string,
    spoiler = false,
  ): Promise<TraktComment> {
    const body: Record<string, unknown> = { comment: text, spoiler };
    if (target.kind === "movie") body.movie = { ids: { tmdb: target.tmdbId } };
    else if (target.kind === "show")
      body.show = { ids: { tmdb: target.tmdbId } };
    else body.episode = { ids: { tmdb: target.episodeTmdbId } };

    const raw = await this.http.request<TraktRawComment>("/comments", {
      method: "POST",
      body,
    });
    this.invalidateCommentsCache(target);
    return this.normalizeComments([raw])[0];
  }

  async updateComment(
    commentId: number,
    text: string,
    spoiler = false,
  ): Promise<TraktComment> {
    const raw = await this.http.request<TraktRawComment>(`/comments/${commentId}`, {
      method: "PUT",
      body: { comment: text, spoiler },
    });
    return this.normalizeComments([raw])[0];
  }

  async deleteComment(commentId: number): Promise<void> {
    await this.http.request(`/comments/${commentId}`, { method: "DELETE" });
  }

  invalidateCommentsCache(target: TraktCommentTarget): void {
    if (target.kind === "movie")
      this.cache.delete(`comments:movie:${target.tmdbId}`);
    else if (target.kind === "show")
      this.cache.delete(`comments:show:${target.tmdbId}`);
    else
      this.cache.delete(
        `comments:episode:${target.showTmdbId}:${target.season}:${target.episode}`,
      );
  }
}
