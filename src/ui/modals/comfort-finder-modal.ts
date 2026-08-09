import { App, Modal, Notice, Setting } from "obsidian";
import { renderModalHeader } from "./modal-chrome";
import { promptDialog } from "./confirm-modal";
import type { StorageService } from "../../services/storage";
import { getComfortableMedia } from "../../services/comfort/join";
import {
  filterByComfortCriteria,
  presetToCriteria,
  ComfortCriteria,
  ComfortableMedia,
} from "../../services/comfort/filter";
import { rankComfortMatches } from "../../services/comfort/rank";
import { ComfortPreset, ComfortFlags } from "../../models/comfort";
import { renderPoster } from "../components/media-render";
import { MediaDetailModal } from "./media-detail-modal";
import type { TMDBService } from "../../api/tmdb";
import { t } from "../../i18n";

export function getFlagLabels(): Record<keyof ComfortFlags, string> {
  return {
    safeWhenAnxious: t("comfort.flagSafeAnxious"),
    safeWhenDepressed: t("comfort.flagSafeDepressed"),
    goodForBackgroundNoise: t("comfort.flagBackgroundNoise"),
    goodWhileCleaning: t("comfort.flagGoodCleaning"),
    goodBeforeSleep: t("comfort.flagGoodBeforeSleep"),
    cozy: t("comfort.flagCozy"),
    funny: t("comfort.flagFunny"),
    noMajorCharacterDeath: t("comfort.flagNoCharacterDeath"),
    lowConflict: t("comfort.flagLowConflict"),
    familiarFavorite: t("comfort.flagFamiliarFavorite"),
  };
}

type Mode = "quick" | "advanced";

export class ComfortFinderModal extends Modal {
  private storage: StorageService;
  private tmdb: TMDBService;

  private mode: Mode = "quick";
  private allComfortable: ComfortableMedia[] = [];
  private presets: ComfortPreset[] = [];

  private criteria: ComfortCriteria = {};
  private resultsEl!: HTMLElement;

  constructor(app: App, storage: StorageService, tmdb: TMDBService) {
    super(app);
    this.storage = storage;
    this.tmdb = tmdb;
  }

  async onOpen(): Promise<void> {
    this.allComfortable = await getComfortableMedia(this.storage);
    this.presets = await this.storage.comfortPresets.getAll();
    this.render();
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("mediavault-comfort-finder");
    renderModalHeader(this, contentEl, t("comfort.title"));

    if (this.allComfortable.length === 0) {
      contentEl.createDiv({
        cls: "mediavault-comfort-finder-empty",
        text: t("comfort.emptyNoProfiles"),
      });
      return;
    }

    const modeToggle = contentEl.createDiv({
      cls: "mediavault-comfort-mode-toggle",
    });
    (["quick", "advanced"] as Mode[]).forEach((m) => {
      const btn = modeToggle.createEl("button", {
        text: m === "quick" ? t("comfort.quickFilter") : t("comfort.advancedFilter"),
        cls: m === this.mode ? "is-active" : "",
      });
      btn.addEventListener("click", () => {
        this.mode = m;
        this.render();
      });
    });

    const filterSection = contentEl.createDiv({
      cls: "mediavault-comfort-filter-section",
    });
    if (this.mode === "quick") {
      this.renderQuickFilters(filterSection);
    } else {
      this.renderAdvancedFilters(filterSection);
    }

    contentEl.createEl("h3", { text: t("comfort.results") });
    this.resultsEl = contentEl.createDiv({ cls: "mediavault-comfort-results" });
    this.runQuery();
  }

  private renderQuickFilters(container: HTMLElement): void {
    const presetGrid = container.createDiv({
      cls: "mediavault-comfort-presets",
    });
    this.presets.forEach((preset) => {
      const card = presetGrid.createDiv({
        cls: "mediavault-comfort-preset-card",
      });
      card.createDiv({
        cls: "mediavault-comfort-preset-name",
        text: preset.name,
      });
      if (preset.description) {
        card.createDiv({
          cls: "mediavault-comfort-preset-desc",
          text: preset.description,
        });
      }
      card.addEventListener("click", () => {
        this.criteria = presetToCriteria(preset);
        presetGrid
          .querySelectorAll(".mediavault-comfort-preset-card")
          .forEach((el) => el.removeClass("is-active"));
        card.addClass("is-active");
        this.runQuery();
      });
    });
  }

  private renderAdvancedFilters(container: HTMLElement): void {
    this.rangeSlider(
      container,
      t("comfort.energyLevel"),
      "energyMin",
      "energyMax",
    );
    this.rangeSlider(
      container,
      t("comfort.attentionRequired"),
      "attentionMin",
      "attentionMax",
    );
    this.maxSlider(
      container,
      t("comfort.maxEmotionalHeaviness"),
      "emotionalHeavinessMax",
    );
    this.minSlider(container, t("comfort.minComfortScore"), "comfortScoreMin");
    this.minSlider(
      container,
      t("comfort.minRewatchability"),
      "rewatchabilityMin",
    );

    container.createEl("h4", { text: t("comfort.requiredTags") });
    const flagWrap = container.createDiv({
      cls: "mediavault-comfort-multitoggle",
    });
    const FLAG_LABELS = getFlagLabels();
    (Object.keys(FLAG_LABELS) as (keyof ComfortFlags)[]).forEach((flag) => {
      const required = this.criteria.requiredFlags ?? [];
      const pill = flagWrap.createEl("button", {
        cls: `mediavault-comfort-pill ${required.includes(flag) ? "is-active" : ""}`,
        text: FLAG_LABELS[flag],
      });
      pill.addEventListener("click", () => {
        const current = new Set(this.criteria.requiredFlags ?? []);
        if (current.has(flag)) {
          current.delete(flag);
          pill.removeClass("is-active");
        } else {
          current.add(flag);
          pill.addClass("is-active");
        }
        this.criteria = { ...this.criteria, requiredFlags: [...current] };
        this.runQuery();
      });
    });

    const saveBtn = container.createEl("button", {
      text: t("comfort.saveAsPreset"),
      cls: "mediavault-comfort-save-preset",
    });
    saveBtn.addEventListener("click", () => void this.promptSavePreset());
  }

  private rangeSlider(
    container: HTMLElement,
    label: string,
    minField: "energyMin" | "attentionMin",
    maxField: "energyMax" | "attentionMax",
  ): void {
    new Setting(container)
      .setName(label)
      .addSlider((slider) =>
        slider
          .setLimits(1, 10, 1)
          .setValue(this.criteria[minField] ?? 1)
          .onChange((v) => {
            this.criteria = { ...this.criteria, [minField]: v };
            this.runQuery();
          }),
      )
      .addSlider((slider) =>
        slider
          .setLimits(1, 10, 1)
          .setValue(this.criteria[maxField] ?? 10)
          .onChange((v) => {
            this.criteria = { ...this.criteria, [maxField]: v };
            this.runQuery();
          }),
      );
  }

  private maxSlider(
    container: HTMLElement,
    label: string,
    field: "emotionalHeavinessMax" | "plotComplexityMax",
  ): void {
    new Setting(container).setName(label).addSlider((slider) =>
      slider
        .setLimits(1, 10, 1)
        .setValue(this.criteria[field] ?? 10)
        .onChange((v) => {
          this.criteria = { ...this.criteria, [field]: v };
          this.runQuery();
        }),
    );
  }

  private minSlider(
    container: HTMLElement,
    label: string,
    field: "comfortScoreMin" | "rewatchabilityMin",
  ): void {
    new Setting(container).setName(label).addSlider((slider) =>
      slider
        .setLimits(1, 10, 1)
        .setValue(this.criteria[field] ?? 1)
        .onChange((v) => {
          this.criteria = { ...this.criteria, [field]: v };
          this.runQuery();
        }),
    );
  }

  private runQuery(): void {
    const filtered = filterByComfortCriteria(
      this.allComfortable,
      this.criteria,
    );
    const ranked = rankComfortMatches(filtered, this.criteria);
    const byId = new Map(filtered.map((f) => [f.media.id, f]));

    this.resultsEl.empty();

    if (ranked.length === 0) {
      this.resultsEl.createDiv({
        cls: "mediavault-comfort-no-results",
        text: t("comfort.noResults"),
      });
      return;
    }

    ranked.slice(0, 30).forEach((match) => {
      const item = byId.get(match.mediaId);
      if (!item) return;

      const card = this.resultsEl.createDiv({
        cls: "mediavault-comfort-result",
      });
      const poster = card.createDiv({
        cls: "mediavault-comfort-result-poster",
      });
      renderPoster(poster, item.media, "w200");

      const info = card.createDiv({ cls: "mediavault-comfort-result-info" });
      info.createDiv({
        cls: "mediavault-comfort-result-title",
        text: item.media.title,
      });
      if (match.matchedFlags.length > 0) {
        info.createDiv({
          cls: "mediavault-comfort-result-flags",
          text: match.matchedFlags.map((f) => getFlagLabels()[f]).join(" \u00b7 "),
        });
      }

      card.addEventListener("click", () => {
        new MediaDetailModal(
          this.app,
          this.storage,
          this.tmdb,
          item.media,
        ).open();
      });
    });
  }

  private async promptSavePreset(): Promise<void> {
    const name = await promptDialog(this.app, t("comfort.namePresetPrompt"));
    if (!name || !name.trim()) return;

    try {
      await this.storage.comfortPresets.create({
        name: name.trim(),
        description: null,
        ...this.criteria,
        requiredFlags: this.criteria.requiredFlags ?? [],
        excludedTriggers: this.criteria.excludedTriggers ?? [],
        seasonalTags: this.criteria.seasonalTags ?? [],
      });
      new Notice(t("comfort.savedPreset", { name: name.trim() }));
      this.presets = await this.storage.comfortPresets.getAll();
    } catch (err) {
      new Notice(
        t("comfort.failedSavePreset", { error: (err as Error).message }),
      );
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
