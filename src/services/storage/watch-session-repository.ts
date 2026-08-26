import { BaseRepository, generateId } from "./base-repository";
import { StorageAdapter } from "./storage-adapter";
import {
  WatchSession,
  NewWatchSessionInput,
  RatingEvolutionPoint,
} from "../../models/review";
import { MediaVaultId } from "../../types/common";

export class WatchSessionRepository extends BaseRepository<WatchSession> {
  private mediaIndexCache = {
    version: -1,
    map: new Map<MediaVaultId, WatchSession[]>(),
  };

  constructor(adapter: StorageAdapter) {
    super(adapter, "watchSessions");
  }

  async create(input: NewWatchSessionInput): Promise<WatchSession> {
    const now = new Date().toISOString();
    const existing = await this.findByMediaId(input.mediaId);

    const session: WatchSession = {
      id: generateId(),
      completedDate: null,
      rating: null,
      review: "",
      mood: null,
      context: null,
      watchSource: null,
      tags: [],
      externalSource: null,
      externalRef: null,
      episodeId: null,
      ...input,
      rewatchNumber: existing.length, // 0 for first watch, 1 for first rewatch etc
      createdAt: now,
      updatedAt: now,
    };

    return this.save(session);
  }

  async update(
    id: MediaVaultId,
    patch: Partial<WatchSession>,
  ): Promise<WatchSession | null> {
    return super.update(id, { ...patch, updatedAt: new Date().toISOString() });
  }

  async findByMediaId(mediaId: MediaVaultId): Promise<WatchSession[]> {
    const index = this.buildIndex((s) => s.mediaId, this.mediaIndexCache);
    const sessions = index.get(mediaId) ?? [];
    return [...sessions].sort((a, b) => a.watchDate.localeCompare(b.watchDate));
  }

  async getLatest(mediaId: MediaVaultId): Promise<WatchSession | null> {
    const sessions = await this.findByMediaId(mediaId);
    return sessions.length > 0 ? sessions[sessions.length - 1] : null;
  }

  async getFirst(mediaId: MediaVaultId): Promise<WatchSession | null> {
    const sessions = await this.findByMediaId(mediaId);
    return sessions.length > 0 ? sessions[0] : null;
  }

  async getRatingEvolution(
    mediaId: MediaVaultId,
  ): Promise<RatingEvolutionPoint[]> {
    const sessions = await this.findByMediaId(mediaId);
    return sessions.map((s) => ({
      watchSessionId: s.id,
      rewatchNumber: s.rewatchNumber,
      watchDate: s.watchDate,
      rating: s.rating,
    }));
  }

  async getAverageRating(mediaId: MediaVaultId): Promise<number | null> {
    const sessions = (await this.findByMediaId(mediaId)).filter(
      (s) => s.rating !== null,
    );
    if (sessions.length === 0) return null;
    const sum = sessions.reduce((acc, s) => acc + (s.rating as number), 0);
    return sum / sessions.length;
  }

  async deleteByMediaId(mediaId: MediaVaultId): Promise<number> {
    const sessions = await this.findByMediaId(mediaId);
    for (const session of sessions) {
      await this.delete(session.id);
    }
    return sessions.length;
  }
}
