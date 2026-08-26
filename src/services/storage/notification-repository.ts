import { BaseRepository, generateId } from "./base-repository";
import { StorageAdapter } from "./storage-adapter";
import {
  MediaVaultNotification,
  NotificationType,
} from "../../models/notification";
import { MediaVaultId } from "../../types/common";

export class NotificationRepository extends BaseRepository<MediaVaultNotification> {
  constructor(adapter: StorageAdapter) {
    super(adapter, "notifications");
  }

  async record(
    type: NotificationType,
    mediaId: MediaVaultId,
    title: string,
    message: string,
  ): Promise<MediaVaultNotification> {
    return this.save({
      id: generateId(),
      type,
      mediaId,
      title,
      message,
      createdAt: new Date().toISOString(),
      read: false,
    });
  }

  async alreadyNotified(
    type: NotificationType,
    mediaId: MediaVaultId,
  ): Promise<boolean> {
    const all = await this.getAll();
    return all.some((n) => n.type === type && n.mediaId === mediaId);
  }

  async notifiedSince(
    type: NotificationType,
    mediaId: MediaVaultId,
    sinceISO: string,
  ): Promise<boolean> {
    const all = await this.getAll();
    return all.some(
      (n) =>
        n.type === type && n.mediaId === mediaId && n.createdAt >= sinceISO,
    );
  }

  async unreadCount(): Promise<number> {
    const all = await this.getAll();
    return all.filter((n) => !n.read).length;
  }

  async markAllRead(): Promise<void> {
    const all = await this.getAll();
    await Promise.all(
      all.filter((n) => !n.read).map((n) => this.update(n.id, { read: true })),
    );
  }

  async recent(limit = 30): Promise<MediaVaultNotification[]> {
    const all = await this.getAll();
    return [...all]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }

  async deleteByMediaId(mediaId: MediaVaultId): Promise<number> {
    const matches = await this.findWhere((n) => n.mediaId === mediaId);
    for (const n of matches) {
      await this.delete(n.id);
    }
    return matches.length;
  }
}
