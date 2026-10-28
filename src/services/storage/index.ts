import type { Plugin } from "obsidian";
import { StorageAdapter } from "./storage-adapter";
import { MediaRepository } from "./media-repository";
import { WatchSessionRepository } from "./watch-session-repository";
import {
  EpisodeRepository,
  EpisodeProgressRepository,
} from "./episode-repository";
import { EpisodeWatchRepository } from "./episode-watch-repository";
import { MovieProgressRepository } from "./movie-progress-repository";
import {
  ComfortRepository,
  ComfortPresetRepository,
} from "./comfort-repository";
import { SettingsRepository } from "./settings-repository";
import { CustomListRepository } from "./list-repository";
import { NotificationRepository } from "./notification-repository";

export * from "./schema";
export * from "./storage-adapter";
export * from "./base-repository";
export * from "./media-repository";
export * from "./watch-session-repository";
export * from "./episode-repository";
export * from "./episode-watch-repository";
export * from "./movie-progress-repository";
export * from "./comfort-repository";
export * from "./settings-repository";
export * from "./list-repository";
export * from "./notification-repository";

export class StorageService {
  readonly adapter: StorageAdapter;

  readonly media: MediaRepository;
  readonly watchSessions: WatchSessionRepository;
  readonly episodes: EpisodeRepository;
  readonly episodeProgress: EpisodeProgressRepository;
  readonly episodeWatches: EpisodeWatchRepository;
  readonly movieProgress: MovieProgressRepository;
  readonly comfortProfiles: ComfortRepository;
  readonly comfortPresets: ComfortPresetRepository;
  readonly settings: SettingsRepository;
  readonly customLists: CustomListRepository;
  readonly notifications: NotificationRepository;

  constructor(plugin: Plugin) {
    this.adapter = new StorageAdapter(plugin);

    this.media = new MediaRepository(this.adapter);
    this.watchSessions = new WatchSessionRepository(this.adapter);
    this.episodes = new EpisodeRepository(this.adapter);
    this.episodeProgress = new EpisodeProgressRepository(this.adapter);
    this.episodeWatches = new EpisodeWatchRepository(this.adapter);
    this.movieProgress = new MovieProgressRepository(this.adapter);
    this.comfortProfiles = new ComfortRepository(this.adapter);
    this.comfortPresets = new ComfortPresetRepository(this.adapter);
    this.settings = new SettingsRepository(this.adapter);
    this.customLists = new CustomListRepository(this.adapter);
    this.notifications = new NotificationRepository(this.adapter);

    const touch = (record: { mediaId: string }) => this.touchMedia(record.mediaId);
    this.watchSessions.onMutated = touch;
    this.episodeProgress.onMutated = touch;
    this.episodeWatches.onMutated = touch;
    this.movieProgress.onMutated = touch;
    this.comfortProfiles.onMutated = touch;
  }

  invalidateAll(): void {
    [
      this.media,
      this.watchSessions,
      this.episodes,
      this.episodeProgress,
      this.episodeWatches,
      this.movieProgress,
      this.comfortProfiles,
      this.customLists,
      this.notifications,
    ].forEach((repo) => repo.invalidate());
  }

  private pipelineDepth = 0;

  get pipelineBusy(): boolean {
    return this.pipelineDepth > 0;
  }

  private pipelineWaiters: (() => void)[] = [];

  acquirePipeline(): () => void {
    this.pipelineDepth++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.pipelineDepth = Math.max(0, this.pipelineDepth - 1);
      if (this.pipelineDepth === 0) this.pipelineWaiters.shift()?.();
    };
  }

  async acquirePipelineWhenFree(): Promise<() => void> {
    while (this.pipelineDepth > 0) {
      await new Promise<void>((resolve) => this.pipelineWaiters.push(resolve));
    }
    return this.acquirePipeline();
  }

  releasePipelineWaiters(): void {
    const waiters = this.pipelineWaiters;
    this.pipelineWaiters = [];
    waiters.forEach((wake) => wake());
  }

  private touchQueue = new Set<string>();
  private touchTimer: number | null = null;
  private touchSuppressed = 0;

  private touchMedia(mediaId: string): void {
    if (this.touchSuppressed > 0) return;
    this.touchQueue.add(mediaId);
    if (this.touchTimer !== null) return;
    this.touchTimer = window.setTimeout(() => {
      this.touchTimer = null;
      void this.flushTouches();
    }, 250);
  }

  async flushTouches(): Promise<void> {
    if (this.touchTimer !== null) {
      window.clearTimeout(this.touchTimer);
      this.touchTimer = null;
    }
    const ids = [...this.touchQueue];
    this.touchQueue.clear();
    for (const id of ids) {
      try {
        await this.media.touch(id);
      } catch (err) {
        console.warn(
          "MediaVault: could not update a media timestamp",
          err instanceof Error ? err.message : "unknown error",
        );
      }
    }
  }

  async shutdown(): Promise<void> {
    this.releasePipelineWaiters();
    await this.flushTouches();
    this.adapter.dispose();
    await this.adapter.flush();
  }

  async withoutTouch<T>(fn: () => Promise<T>): Promise<T> {
    this.touchSuppressed++;
    try {
      return await fn();
    } finally {
      this.touchSuppressed--;
    }
  }

  async initialize(): Promise<void> {
    await this.adapter.initialize();
  }

  async flush(): Promise<void> {
    await this.adapter.flush();
  }

  async factoryReset(): Promise<void> {
    await this.adapter.factoryReset();
  }

  getDataVersion(): string {
    return [
      this.media.getVersion(),
      this.watchSessions.getVersion(),
      this.episodes.getVersion(),
      this.episodeProgress.getVersion(),
      this.episodeWatches.getVersion(),
      this.movieProgress.getVersion(),
      this.comfortProfiles.getVersion(),
      this.customLists.getVersion(),
    ].join(":");
  }
}
