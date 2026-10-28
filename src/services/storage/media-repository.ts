import { BaseRepository, generateId } from "./base-repository";
import { StorageAdapter } from "./storage-adapter";
import { MediaItem, NewMediaItemInput } from "../../models/media";
import { MediaStatus, MediaType } from "../../types/enums";
import { MediaVaultId } from "../../types/common";

export class MediaRepository extends BaseRepository<MediaItem> {
  onUpdated?: (id: MediaVaultId) => void;
  private tmdbIndexCache = { version: -1, map: new Map<string, MediaItem[]>() };
  private tvdbIndexCache = { version: -1, map: new Map<string, MediaItem[]>() };
  private imdbIndexCache = { version: -1, map: new Map<string, MediaItem[]>() };
  private uuidIndexCache = { version: -1, map: new Map<string, MediaItem[]>() };

  constructor(adapter: StorageAdapter) {
    super(adapter, "media");
  }

  async create(input: NewMediaItemInput): Promise<MediaItem> {
    const now = new Date().toISOString();
    return this.save(this.buildItem(generateId(), input, now, now));
  }

  async restore(
    input: NewMediaItemInput & {
      id: MediaVaultId;
      createdAt: string;
      updatedAt: string;
    },
  ): Promise<MediaItem> {
    const { id, createdAt, updatedAt, ...rest } = input;
    return this.save(this.buildItem(id, rest, createdAt, updatedAt));
  }

  private buildItem(
    id: MediaVaultId,
    input: NewMediaItemInput,
    createdAt: string,
    updatedAt: string,
  ): MediaItem {
    const item: MediaItem = {
      id,
      originalTitle: null,
      tvdbId: null,
      imdbId: null,
      tvTimeUuid: null,
      year: null,
      releaseDate: null,
      genres: [],
      genreIds: [],
      runtime: null,
      posterPath: null,
      backdropPath: null,
      cast: [],
      crew: [],
      productionCompanies: [],
      language: null,
      country: null,
      synopsis: null,
      status: MediaStatus.PlanToWatch,
      droppedReason: null,
      tvStatus: null,
      platform: null,
      isFavorite: false,
      liked: false,
      likedAt: null,
      notes: "",
      tags: [],
      averageRating: null,
      watchCount: 0,
      lastWatchedDate: null,
      lastActivityAt: null,
      notePath: null,
      episodesLastSyncedAt: null,
      ...input,
      createdAt,
      updatedAt,
    };

    return item;
  }

  async update(
    id: MediaVaultId,
    patch: Partial<MediaItem>,
  ): Promise<MediaItem | null> {
    const result = await super.update(id, {
      ...patch,
      updatedAt: patch.updatedAt ?? new Date().toISOString(),
    });
    if (result) this.onUpdated?.(id);
    return result;
  }

  async touch(id: MediaVaultId): Promise<void> {
    await this.update(id, {});
  }

  async findByTmdbId(
    tmdbId: number,
    type: MediaType,
  ): Promise<MediaItem | null> {
    const index = this.buildIndex(
      (item) => `${item.type}:${item.tmdbId}`,
      this.tmdbIndexCache,
    );
    return index.get(`${type}:${tmdbId}`)?.[0] ?? null;
  }

  async findByTvdbId(tvdbId: number): Promise<MediaItem | null> {
    const index = this.buildIndex(
      (item) => (item.tvdbId != null ? String(item.tvdbId) : null),
      this.tvdbIndexCache,
    );
    return index.get(String(tvdbId))?.[0] ?? null;
  }

  async findByImdbId(imdbId: string): Promise<MediaItem | null> {
    const index = this.buildIndex(
      (item) => item.imdbId ?? null,
      this.imdbIndexCache,
    );
    return index.get(imdbId)?.[0] ?? null;
  }

  async findByTvTimeUuid(uuid: string): Promise<MediaItem | null> {
    const index = this.buildIndex(
      (item) => item.tvTimeUuid ?? null,
      this.uuidIndexCache,
    );
    return index.get(uuid)?.[0] ?? null;
  }

  async findByStatus(status: MediaStatus): Promise<MediaItem[]> {
    return this.findWhere((item) => item.status === status);
  }

  async findByType(type: MediaType): Promise<MediaItem[]> {
    return this.findWhere((item) => item.type === type);
  }

  async search(query: string): Promise<MediaItem[]> {
    const q = query.trim().toLowerCase();
    if (!q) return this.getAll();
    return this.findWhere(
      (item) =>
        item.title.toLowerCase().includes(q) ||
        (item.originalTitle?.toLowerCase().includes(q) ?? false) ||
        item.tags.some((tag) => tag.toLowerCase().includes(q)),
    );
  }
}
