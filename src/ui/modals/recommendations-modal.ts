import { App, Modal } from "obsidian";
import { renderModalHeader } from "./modal-chrome";
import type { StorageService } from "../../services/storage";
import type { TMDBService } from "../../api/tmdb";
import type MediaVaultPlugin from "../../main";
import {
  buildRecommendations,
  RecommendationSet,
} from "../../services/recommendation/engine";
import { Recommendation } from "../../services/recommendation/types";
import {
  renderDiscoverCard,
  DiscoverCardData,
} from "../components/discover-card";
import { t } from "../../i18n";

function getCategoryTitles(): Record<keyof RecommendationSet, string> {
  return {
    similarToFavorites: t("explore.becauseYouLoved"),
    hiddenGems: t("explore.hiddenGems"),
    comfortRewatch: t("explore.comfortRewatches"),
    highEnergy: t("explore.highEnergyPicks"),
    lowAttention: t("explore.lowAttentionPicks"),
  };
}

export class RecommendationsModal extends Modal {
  private storage: StorageService;
  private tmdb: TMDBService;
  private plugin?: MediaVaultPlugin;

  constructor(
    app: App,
    storage: StorageService,
    tmdb: TMDBService,
    plugin?: MediaVaultPlugin,
  ) {
    super(app);
    this.storage = storage;
    this.tmdb = tmdb;
    this.plugin = plugin;
  }

  async onOpen(): Promise<void> {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("mediavault-recommendations-modal");
    renderModalHeader(this, contentEl, t("explore.recommendedForYouTitle"));

    const loading = contentEl.createDiv({
      cls: "mediavault-rec-loading",
      text: t("explore.buildingRecs"),
    });

    let recs: RecommendationSet;
    try {
      recs = await buildRecommendations(this.storage, this.tmdb);
    } catch (err) {
      loading.setText(
        t("explore.failedToBuildRecs", { error: (err as Error).message }),
      );
      return;
    }
    loading.remove();

    const lists: Recommendation[][] = [
      recs.similarToFavorites,
      recs.hiddenGems,
      recs.comfortRewatch,
      recs.highEnergy,
      recs.lowAttention,
    ];
    const hasAny = lists.some((list) => list.length > 0);
    if (!hasAny) {
      contentEl.createDiv({
        cls: "mediavault-rec-empty",
        text: t("explore.notEnoughData"),
      });
      return;
    }

    (Object.keys(recs) as (keyof RecommendationSet)[]).forEach((key) => {
      const list = recs[key];
      if (list.length === 0) return;
      contentEl.createEl("h3", { text: getCategoryTitles()[key] });
      const row = contentEl.createDiv({ cls: "mediavault-explore-row" });
      list.forEach((rec) => {
        if (!rec.mediaId && (!rec.tmdbId || !rec.mediaKind)) return;
        const card: DiscoverCardData = {
          tmdbId: rec.tmdbId ?? 0,
          mediaKind: rec.mediaKind ?? "movie",
          title: rec.title,
          year: rec.year,
          posterPath: rec.posterPath,
          reason: rec.reasons[0],
          mediaId: rec.mediaId,
        };
        renderDiscoverCard(
          row,
          {
            app: this.app,
            storage: this.storage,
            tmdb: this.tmdb,
            plugin: this.plugin,
          },
          card,
        );
      });
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
