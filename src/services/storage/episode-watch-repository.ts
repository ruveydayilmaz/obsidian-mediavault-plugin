import { BaseRepository, generateId } from "./base-repository";
import { StorageAdapter } from "./storage-adapter";
import { EpisodeWatch } from "../../models/episode";
import { MediaVaultId } from "../../types/common";

export class EpisodeWatchRepository extends BaseRepository<EpisodeWatch> {
  private episodeIndexCache = {
    version: -1,
    map: new Map<MediaVaultId, EpisodeWatch[]>(),
  };
  private mediaIndexCache = {
    version: -1,
    map: new Map<MediaVaultId, EpisodeWatch[]>(),
  };

  constructor(adapter: StorageAdapter) {
    super(adapter, "episodeWatches");
  }

  async create(
    input: Omit<EpisodeWatch, "id" | "createdAt" | "updatedAt">,
  ): Promise<EpisodeWatch> {
    const now = new Date().toISOString();
    return this.save({
      id: generateId(),
      createdAt: now,
      updatedAt: now,
      ...input,
    });
  }

  async update(
    id: MediaVaultId,
    patch: Partial<EpisodeWatch>,
  ): Promise<EpisodeWatch | null> {
    return super.update(id, { ...patch, updatedAt: new Date().toISOString() });
  }

  async findByEpisodeId(episodeId: MediaVaultId): Promise<EpisodeWatch[]> {
    const index = this.buildIndex((w) => w.episodeId, this.episodeIndexCache);
    return [...(index.get(episodeId) ?? [])];
  }

  async findByMediaId(mediaId: MediaVaultId): Promise<EpisodeWatch[]> {
    const index = this.buildIndex((w) => w.mediaId, this.mediaIndexCache);
    return [...(index.get(mediaId) ?? [])];
  }

  async deleteByMediaId(mediaId: MediaVaultId): Promise<number> {
    const watches = await this.findByMediaId(mediaId);
    for (const watch of watches) {
      await this.delete(watch.id);
    }
    return watches.length;
  }
}
