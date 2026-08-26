import { BaseRepository, generateId } from "./base-repository";
import { StorageAdapter } from "./storage-adapter";
import { MovieProgress } from "../../models/movie-progress";
import { MediaVaultId } from "../../types/common";

export class MovieProgressRepository extends BaseRepository<MovieProgress> {
  private mediaIndexCache = {
    version: -1,
    map: new Map<MediaVaultId, MovieProgress[]>(),
  };

  constructor(adapter: StorageAdapter) {
    super(adapter, "movieProgress");
  }

  async create(input: Omit<MovieProgress, "id">): Promise<MovieProgress> {
    return this.save({ id: generateId(), ...input });
  }

  async update(
    id: MediaVaultId,
    patch: Partial<MovieProgress>,
  ): Promise<MovieProgress | null> {
    return super.update(id, patch);
  }

  async findByMediaId(mediaId: MediaVaultId): Promise<MovieProgress | null> {
    const index = this.buildIndex((p) => p.mediaId, this.mediaIndexCache);
    return index.get(mediaId)?.[0] ?? null;
  }

  async deleteByMediaId(mediaId: MediaVaultId): Promise<number> {
    const existing = await this.findByMediaId(mediaId);
    if (!existing) return 0;
    await this.delete(existing.id);
    return 1;
  }
}
