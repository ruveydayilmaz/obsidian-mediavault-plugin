import { BaseRepository, generateId } from "./base-repository";
import { StorageAdapter } from "./storage-adapter";
import {
  Episode,
  EpisodeProgress,
  SeasonProgress,
  ShowProgress,
} from "../../models/episode";
import { MediaVaultId } from "../../types/common";

export class EpisodeRepository extends BaseRepository<Episode> {
  private mediaIndexCache = {
    version: -1,
    map: new Map<MediaVaultId, Episode[]>(),
  };

  constructor(adapter: StorageAdapter) {
    super(adapter, "episodes");
  }

  async create(input: Omit<Episode, "id">): Promise<Episode> {
    return this.save({ id: generateId(), ...input });
  }

  async findByMediaId(mediaId: MediaVaultId): Promise<Episode[]> {
    const index = this.buildIndex((e) => e.mediaId, this.mediaIndexCache);
    const episodes = index.get(mediaId) ?? [];
    return [...episodes].sort(
      (a, b) =>
        a.seasonNumber - b.seasonNumber || a.episodeNumber - b.episodeNumber,
    );
  }

  async findBySeason(
    mediaId: MediaVaultId,
    seasonNumber: number,
  ): Promise<Episode[]> {
    const episodes = await this.findByMediaId(mediaId);
    return episodes.filter((e) => e.seasonNumber === seasonNumber);
  }

  async deleteByMediaId(mediaId: MediaVaultId): Promise<number> {
    const episodes = await this.findByMediaId(mediaId);
    for (const episode of episodes) {
      await this.delete(episode.id);
    }
    return episodes.length;
  }
}

export class EpisodeProgressRepository extends BaseRepository<EpisodeProgress> {
  private mediaIndexCache = {
    version: -1,
    map: new Map<MediaVaultId, EpisodeProgress[]>(),
  };
  private episodeIndexCache = {
    version: -1,
    map: new Map<MediaVaultId, EpisodeProgress[]>(),
  };

  constructor(adapter: StorageAdapter) {
    super(adapter, "episodeProgress");
  }

  async create(
    input: Omit<EpisodeProgress, "id" | "updatedAt">,
  ): Promise<EpisodeProgress> {
    return this.save({
      id: generateId(),
      updatedAt: new Date().toISOString(),
      ...input,
    });
  }

  async update(
    id: MediaVaultId,
    patch: Partial<EpisodeProgress>,
  ): Promise<EpisodeProgress | null> {
    return super.update(id, { ...patch, updatedAt: new Date().toISOString() });
  }

  async findByMediaId(mediaId: MediaVaultId): Promise<EpisodeProgress[]> {
    const index = this.buildIndex((p) => p.mediaId, this.mediaIndexCache);
    return index.get(mediaId) ?? [];
  }

  async findByEpisodeId(
    episodeId: MediaVaultId,
  ): Promise<EpisodeProgress | null> {
    const index = this.buildIndex((p) => p.episodeId, this.episodeIndexCache);
    return index.get(episodeId)?.[0] ?? null;
  }

  async deleteByMediaId(mediaId: MediaVaultId): Promise<number> {
    const progress = await this.findByMediaId(mediaId);
    for (const p of progress) {
      await this.delete(p.id);
    }
    return progress.length;
  }

  async markWatched(
    episode: Episode,
    watched: boolean,
    watchedDate?: string,
  ): Promise<EpisodeProgress> {
    const existing = await this.findByEpisodeId(episode.id);

    if (existing) {
      const updated = await this.update(existing.id, {
        watched,
        watchedDate: watched ? (watchedDate ?? new Date().toISOString()) : null,
      });
      return updated as EpisodeProgress;
    }

    return this.create({
      mediaId: episode.mediaId,
      episodeId: episode.id,
      seasonNumber: episode.seasonNumber,
      episodeNumber: episode.episodeNumber,
      watched,
      watchedDate: watched ? (watchedDate ?? new Date().toISOString()) : null,
      rating: null,
      review: null,
      emotion: null,
      isFavorite: false,
      liked: false,
      likedAt: null,
      comfortNote: null,
    });
  }

  async markSeasonWatched(
    episodes: Episode[],
    watched: boolean,
  ): Promise<EpisodeProgress[]> {
    const results: EpisodeProgress[] = [];
    for (const episode of episodes) {
      results.push(await this.markWatched(episode, watched));
    }
    return results;
  }

  async getShowProgress(
    mediaId: MediaVaultId,
    episodes: Episode[],
  ): Promise<ShowProgress> {
    const progress = await this.findByMediaId(mediaId);
    const progressByEpisodeId = new Map(progress.map((p) => [p.episodeId, p]));

    const seasonNumbers = [
      ...new Set(episodes.map((e) => e.seasonNumber)),
    ].sort((a, b) => a - b);

    const seasons: SeasonProgress[] = seasonNumbers.map((seasonNumber) => {
      const seasonEpisodes = episodes.filter(
        (e) => e.seasonNumber === seasonNumber,
      );
      const watchedEpisodes = seasonEpisodes.filter(
        (e) => progressByEpisodeId.get(e.id)?.watched,
      ).length;
      const totalRuntimeWatched = seasonEpisodes
        .filter((e) => progressByEpisodeId.get(e.id)?.watched)
        .reduce((sum, e) => sum + (e.runtime ?? 0), 0);

      return {
        seasonNumber,
        totalEpisodes: seasonEpisodes.length,
        watchedEpisodes,
        percentWatched:
          seasonEpisodes.length > 0
            ? (watchedEpisodes / seasonEpisodes.length) * 100
            : 0,
        totalRuntimeWatched,
      };
    });

    const totalEpisodes = episodes.length;
    const watchedEpisodes = seasons.reduce(
      (sum, s) => sum + s.watchedEpisodes,
      0,
    );
    const totalRuntimeWatched = seasons.reduce(
      (sum, s) => sum + s.totalRuntimeWatched,
      0,
    );

    return {
      mediaId,
      seasons,
      totalEpisodes,
      watchedEpisodes,
      remainingEpisodes: totalEpisodes - watchedEpisodes,
      percentWatched:
        totalEpisodes > 0 ? (watchedEpisodes / totalEpisodes) * 100 : 0,
      totalRuntimeWatched,
    };
  }
}
