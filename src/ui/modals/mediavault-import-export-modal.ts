import { App, Modal, Notice } from "obsidian";
import { renderModalHeader } from "./modal-chrome";
import type { StorageService } from "../../services/storage";
import {
  importMediaVaultExport,
  isMediaVaultExport,
  describeExportContents,
  ImportSummary,
  ImportCategoryOptions,
  DEFAULT_IMPORT_CATEGORIES,
} from "../../services/mediavault-export";
import { t } from "../../i18n";

export class MediaVaultImportExportModal extends Modal {
  private busy = false;
  private rawText: string | null = null;
  private categories: ImportCategoryOptions = { ...DEFAULT_IMPORT_CATEGORIES };

  constructor(
    app: App,
    private storage: StorageService,
    private onImported: () => void,
  ) {
    super(app);
  }

  onOpen(): void {
    this.render();
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("mediavault-export-import-modal");
    renderModalHeader(this, contentEl, t("exportImport.title"), "h3");

    contentEl.createEl("p", {
      cls: "mediavault-modal-hint",
      text: t("exportImport.importHint"),
    });

    const fileInput = contentEl.createEl("input", {
      type: "file",
      attr: { accept: ".json,application/json" },
    });
    fileInput.addEventListener("change", () => {
      void this.handleFileChange(fileInput);
    });
  }

  private async handleFileChange(input: HTMLInputElement): Promise<void> {
    const file = input.files?.[0];
    if (!file || this.busy) return;
    input.disabled = true;

    try {
      const raw = await file.text();
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        new Notice(t("exportImport.importFailed", { error: "Not valid JSON" }));
        this.close();
        return;
      }
      if (!isMediaVaultExport(parsed)) {
        new Notice(t("exportImport.notMediaVaultExport"));
        this.close();
        return;
      }
      this.rawText = raw;
      this.renderCategoryPicker(describeExportContents(parsed));
    } catch (err) {
      new Notice(
        t("exportImport.importFailed", {
          error: err instanceof Error ? err.message : String(err),
        }),
      );
      this.close();
    }
  }

  private renderCategoryPicker(contents: ReturnType<typeof describeExportContents>): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("mediavault-export-import-modal");
    renderModalHeader(this, contentEl, t("exportImport.title"), "h3");

    contentEl.createEl("p", {
      cls: "mediavault-modal-hint",
      text: t("exportImport.categoriesHint"),
    });

    const wrap = contentEl.createDiv({ cls: "mediavault-export-category-toggles" });
    const addRow = (
      label: string,
      available: boolean,
      value: boolean,
      setter: (v: boolean) => void,
    ) => {
      if (!available) return;
      const row = wrap.createDiv({ cls: "mediavault-export-category-row" });
      const checkbox = row.createEl("input", { type: "checkbox" });
      checkbox.checked = value;
      checkbox.addEventListener("change", () => setter(checkbox.checked));
      row.createSpan({ text: label });
    };

    addRow(
      t("exportImport.categoryMovies", { count: contents.movieCount }),
      contents.hasMovies,
      this.categories.includeMovies,
      (v) => (this.categories.includeMovies = v),
    );
    addRow(
      t("exportImport.categoryTVShows", { count: contents.tvCount }),
      contents.hasTVShows,
      this.categories.includeTVShows,
      (v) => (this.categories.includeTVShows = v),
    );
    addRow(
      t("exportImport.categoryWatchHistory"),
      contents.hasWatchHistory,
      this.categories.includeWatchHistory,
      (v) => (this.categories.includeWatchHistory = v),
    );
    addRow(
      t("exportImport.categoryLists"),
      contents.hasLists,
      this.categories.includeLists,
      (v) => (this.categories.includeLists = v),
    );
    addRow(
      t("exportImport.categorySettings"),
      contents.hasSettings,
      this.categories.includeSettings,
      (v) => (this.categories.includeSettings = v),
    );

    const footer = contentEl.createDiv({ cls: "mediavault-modal-buttons" });
    const importBtn = footer.createEl("button", {
      cls: "mod-cta",
      text: t("command.importMediaVaultExport"),
    });
    importBtn.addEventListener("click", () => void this.runImport());
    const cancelBtn = footer.createEl("button", { text: t("common.cancel") });
    cancelBtn.addEventListener("click", () => this.close());
  }

  private async runImport(): Promise<void> {
    if (!this.rawText || this.busy) return;
    this.busy = true;

    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("mediavault-export-import-modal");
    renderModalHeader(this, contentEl, t("exportImport.title"), "h3");
    const progressEl = contentEl.createEl("p", {
      cls: "mediavault-modal-hint",
      text: t("exportImport.importingProgress", { done: 0, total: 0 }),
    });

    try {
      const summary = await importMediaVaultExport(
        this.app,
        this.storage,
        this.rawText,
        (done, total) => {
          progressEl.setText(
            t("exportImport.importingProgress", { done, total }),
          );
        },
        this.categories,
      );
      this.renderResult(summary);
      this.onImported();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message === "UNSUPPORTED_EXPORT_VERSION") {
        new Notice(t("exportImport.unsupportedVersion"));
      } else {
        new Notice(t("exportImport.importFailed", { error: message }));
      }
      this.close();
    } finally {
      this.busy = false;
    }
  }

  private renderResult(summary: ImportSummary): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("mediavault-export-import-modal");
    renderModalHeader(this, contentEl, t("exportImport.resultTitle"), "h3");

    const list = contentEl.createEl("ul", {
      cls: "mediavault-export-import-result-list",
    });
    const row = (text: string) => list.createEl("li", { text });
    row(t("exportImport.resultMediaCreated", { count: summary.mediaCreated }));
    row(t("exportImport.resultMediaUpdated", { count: summary.mediaUpdated }));
    row(t("exportImport.resultEpisodesAdded", { count: summary.episodesAdded }));
    row(t("exportImport.resultEpisodesUpdated", { count: summary.episodesUpdated }));
    row(t("exportImport.resultProgressMerged", {
      count: summary.progressAdded + summary.progressUpdated,
    }));
    row(t("exportImport.resultWatchesMerged", {
      count: summary.watchSessionsMerged + summary.episodeWatchesMerged,
    }));
    row(t("exportImport.resultNotesReconnected", { count: summary.notesReconnected }));
    row(t("exportImport.resultListsCreated", { count: summary.listsCreated }));
    row(t("exportImport.resultListsUpdated", { count: summary.listsUpdated }));
    row(t("exportImport.resultMembershipsAdded", { count: summary.listMembershipsAdded }));
    row(t("exportImport.resultPresetsAdded", { count: summary.presetsAdded }));
    if (summary.settingsApplied > 0) {
      row(t("exportImport.resultSettingsApplied", { count: summary.settingsApplied }));
    }
    row(t("exportImport.resultSkipped", { count: summary.skipped }));

    if (summary.errors.length > 0) {
      contentEl.createEl("h4", { text: t("exportImport.errors") });
      const errList = contentEl.createEl("ul");
      summary.errors.slice(0, 20).forEach((e) => {
        errList.createEl("li", { text: `${e.title}: ${e.message}` });
      });
    }

    const closeBtn = contentEl.createEl("button", {
      cls: "mod-cta",
      text: t("common.close"),
    });
    closeBtn.addEventListener("click", () => this.close());
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
