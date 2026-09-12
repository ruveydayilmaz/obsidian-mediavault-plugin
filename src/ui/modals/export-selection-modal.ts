import { App, Modal } from "obsidian";
import { renderModalHeader } from "./modal-chrome";
import type { MediaItem } from "../../models/media";
import type { ExportCategoryOptions } from "../../services/mediavault-export";
import { t } from "../../i18n";

export interface ExportSelectionResult {
  items: MediaItem[];
  categories: ExportCategoryOptions;
}

export class ExportSelectionModal extends Modal {
  private selected = new Set<string>();
  private filter = "";
  private includeWatchHistory = true;
  private includeLists = true;
  private includeSettings = false;

  constructor(
    app: App,
    private mediaItems: MediaItem[],
    private onExport: (result: ExportSelectionResult) => void,
  ) {
    super(app);
  }

  onOpen(): void {
    this.render();
  }

  private currentCategories(): ExportCategoryOptions {
    return {
      includeWatchHistory: this.includeWatchHistory,
      includeLists: this.includeLists,
      includeSettings: this.includeSettings,
    };
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("mediavault-export-selection-modal");
    renderModalHeader(this, contentEl, t("exportImport.selectTitle"), "h3");

    this.renderCategoryToggles(contentEl);

    const wholeLibraryBtn = contentEl.createEl("button", {
      cls: "mod-cta",
      text: t("exportImport.exportEntireLibrary", {
        count: this.mediaItems.length,
      }),
    });
    wholeLibraryBtn.addEventListener("click", () => {
      this.onExport({ items: this.mediaItems, categories: this.currentCategories() });
      this.close();
    });

    contentEl.createEl("p", {
      cls: "mediavault-modal-hint",
      text: t("exportImport.orSelectBelow"),
    });

    const searchInput = contentEl.createEl("input", {
      type: "text",
      attr: { placeholder: t("common.search") },
      cls: "mediavault-export-selection-search",
    });
    searchInput.addEventListener("input", () => {
      this.filter = searchInput.value.trim().toLowerCase();
      this.renderList(listEl);
    });

    const listEl = contentEl.createDiv({
      cls: "mediavault-export-selection-list",
    });
    this.renderList(listEl);

    const footer = contentEl.createDiv({
      cls: "mediavault-modal-buttons",
    });
    const exportBtn = footer.createEl("button", {
      cls: "mod-cta",
      text: t("exportImport.exportSelected"),
    });
    exportBtn.addEventListener("click", () => {
      const items = this.mediaItems.filter((m) => this.selected.has(m.id));
      if (items.length === 0) return;
      this.onExport({ items, categories: this.currentCategories() });
      this.close();
    });
    const cancelBtn = footer.createEl("button", { text: t("common.cancel") });
    cancelBtn.addEventListener("click", () => this.close());
  }

  private renderCategoryToggles(contentEl: HTMLElement): void {
    contentEl.createEl("p", {
      cls: "mediavault-modal-hint",
      text: t("exportImport.categoriesHint"),
    });
    const wrap = contentEl.createDiv({
      cls: "mediavault-export-category-toggles",
    });

    const rows: [string, boolean, (v: boolean) => void][] = [
      [
        t("exportImport.categoryWatchHistory"),
        this.includeWatchHistory,
        (v) => (this.includeWatchHistory = v),
      ],
      [
        t("exportImport.categoryLists"),
        this.includeLists,
        (v) => (this.includeLists = v),
      ],
      [
        t("exportImport.categorySettings"),
        this.includeSettings,
        (v) => (this.includeSettings = v),
      ],
    ];

    rows.forEach(([label, value, setter]) => {
      const row = wrap.createDiv({ cls: "mediavault-export-category-row" });
      const checkbox = row.createEl("input", { type: "checkbox" });
      checkbox.checked = value;
      checkbox.addEventListener("change", () => setter(checkbox.checked));
      row.createSpan({ text: label });
    });
  }

  private renderList(listEl: HTMLElement): void {
    listEl.empty();
    const filtered = this.filter
      ? this.mediaItems.filter((m) =>
          m.title.toLowerCase().includes(this.filter),
        )
      : this.mediaItems;

    filtered.slice(0, 300).forEach((media) => {
      const row = listEl.createDiv({
        cls: "mediavault-export-selection-row",
      });
      const checkbox = row.createEl("input", { type: "checkbox" });
      checkbox.checked = this.selected.has(media.id);
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) this.selected.add(media.id);
        else this.selected.delete(media.id);
      });
      row.createSpan({
        text: media.year ? `${media.title} (${media.year})` : media.title,
      });
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
