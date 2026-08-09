import { App, Modal, Notice } from "obsidian";
import { renderModalHeader } from "./modal-chrome";
import type { StorageService } from "../../services/storage";
import type { TMDBService } from "../../api/tmdb";
import {
  runImport,
  ImportManagerResult,
} from "../../services/importer/tvtime/manager";
import {
  runZipImport,
  ZipImportResult,
} from "../../services/importer/tvtime/zip-importer";
import {
  previewBundle,
  ImportPreviewSummary,
} from "../../services/importer/tvtime/preview";
import {
  commitBundle,
  ImportReport,
  UnmatchedItem,
} from "../../services/importer/tvtime/commit";
import { NormalizedImportBundle } from "../../services/importer/tvtime/types";
import { ImportTimer } from "../../services/importer/import-timer";
import { t } from "../../i18n";

export class ImportModal extends Modal {
  private storage: StorageService;
  private tmdb: TMDBService;
  private onImported?: () => void;

  private fileName = "";
  private result: ImportManagerResult | null = null;
  private preview: ImportPreviewSummary | null = null;
  private report: ImportReport | null = null;
  private importing = false;
  private progressBarEl: HTMLElement | null = null;
  private progressTextEl: HTMLElement | null = null;

  private zip: ZipImportResult | null = null;
  private zipPreview: ImportPreviewSummary | null = null;
  private detecting = false;
  private zipTiming: { stage: string; ms: number; calls: number }[] = [];

  constructor(
    app: App,
    storage: StorageService,
    tmdb: TMDBService,
    onImported?: () => void,
  ) {
    super(app);
    this.storage = storage;
    this.tmdb = tmdb;
    this.onImported = onImported;
  }

  onOpen(): void {
    this.render();
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("mediavault-import-modal");
    renderModalHeader(this, contentEl, t("import.title"));

    if (this.importing) {
      this.renderProgress(contentEl);
      return;
    }

    if (this.report) {
      this.renderReport(contentEl, this.report);
      return;
    }

    if (this.detecting) {
      this.renderProgress(
        contentEl,
        t("import.readingFile", { name: this.fileName }),
      );
      return;
    }

    contentEl.createEl("p", {
      text: t("import.selectFileHint"),
      cls: "mediavault-import-hint",
    });

    const fileInput = contentEl.createEl("input", {
      type: "file",
      attr: {
        accept: ".json,.csv,.zip,text/csv,application/json,application/zip",
      },
    });
    fileInput.addEventListener("change", () => {
      void this.handleFileChange(fileInput);
    });

    if (this.zip && this.zipPreview) {
      this.renderZipDetection(contentEl, this.zip);
      this.renderPreview(
        contentEl,
        this.zip.bundle,
        this.zipPreview,
        this.zip.supportedCount > 0,
      );
      return;
    }

    if (this.result && this.preview) {
      this.renderDetection(contentEl, this.result);
      this.renderPreview(
        contentEl,
        this.result.bundle,
        this.preview,
        !this.result.unsupported,
      );
    }
  }

  private async handleFileChange(fileInput: HTMLInputElement): Promise<void> {
    const file = fileInput.files?.[0];
    if (!file) return;

    this.fileName = file.name;

    if (/\.zip$/i.test(file.name)) {
      await this.runZipDetectionAndPreview(await file.arrayBuffer());
    } else {
      await this.runDetectionAndPreview(await file.text());
    }
  }

  private renderProgress(
    container: HTMLElement,
    label = t("import.importingLarge"),
  ): void {
    container.createEl("p", { text: label, cls: "mediavault-import-hint" });

    const track = container.createDiv({
      cls: "mediavault-import-progress-track",
    });
    this.progressBarEl = track.createDiv({
      cls: "mediavault-import-progress-bar",
    });
    this.progressBarEl.setCssStyles({ width: "0%" });

    this.progressTextEl = container.createDiv({
      cls: "mediavault-import-progress-text",
      text: t("import.starting"),
    });
  }

  private updateProgress(done: number, total: number, stage: string): void {
    if (!this.progressBarEl || !this.progressTextEl) return;
    const percent = total > 0 ? Math.round((done / total) * 100) : 0;
    this.progressBarEl.setCssStyles({ width: `${percent}%` });
    this.progressTextEl.setText(`${stage}: ${done} / ${total}`);
  }

  private async runDetectionAndPreview(fileContent: string): Promise<void> {
    try {
      this.result = runImport(fileContent);
      this.preview = await previewBundle(this.storage, this.result.bundle);
      this.zip = null;
      this.zipPreview = null;
      this.report = null;
      this.render();
    } catch (err) {
      new Notice(
        t("import.couldNotParse", {
          name: this.fileName,
          error: (err as Error).message,
        }),
      );
    }
  }

  private async runZipDetectionAndPreview(zipData: ArrayBuffer): Promise<void> {
    this.detecting = true;
    this.render();
    try {
      this.zip = await runZipImport(zipData, (done, total, stage) => {
        this.updateProgress(done, total, stage);
      });
      this.zipTiming = this.zip.timing;
      this.zipPreview = await previewBundle(this.storage, this.zip.bundle);
      this.result = null;
      this.preview = null;
      this.report = null;
    } catch (err) {
      new Notice(
        t("import.couldNotRead", {
          name: this.fileName,
          error: (err as Error).message,
        }),
      );
    } finally {
      this.detecting = false;
      this.render();
    }
  }

  private renderDetection(
    container: HTMLElement,
    result: ImportManagerResult,
  ): void {
    const box = container.createDiv({ cls: "mediavault-import-detection" });
    box.createDiv({ text: t("import.detected") });
    box.createDiv({
      cls: "mediavault-import-detection-line",
      text: `${result.detection.format.toUpperCase()} → ${result.detection.label}`,
    });

    if (result.unsupported) {
      box.createDiv({
        cls: "mediavault-import-warning",
        text:
          result.detection.category === "json_list"
            ? t("import.unsupportedList")
            : t("import.unsupportedGeneric"),
      });
    }
  }

  private renderZipDetection(
    container: HTMLElement,
    zip: ZipImportResult,
  ): void {
    const box = container.createDiv({ cls: "mediavault-import-detection" });
    box.createDiv({ text: t("import.gdprExport") });

    const list = box.createDiv({ cls: "mediavault-import-zip-files" });
    zip.files.forEach((f) => {
      list.createDiv({
        cls: f.unsupported
          ? "mediavault-import-zip-file is-unsupported"
          : "mediavault-import-zip-file",
        text: f.unsupported
          ? `✕ ${f.filename} — ${f.detection.label}`
          : `✓ ${f.filename} — ${f.detection.label} (${f.rowCount})`,
      });
      if (!f.unsupported && f.diagnosticLines && f.diagnosticLines.length > 0) {
        const diag = list.createDiv({
          cls: "mediavault-import-zip-file-diagnostics",
        });
        f.diagnosticLines.forEach((line) => {
          diag.createDiv({
            cls: "mediavault-import-zip-file-diagnostic-line",
            text: line,
          });
        });
      }
    });

    box.createDiv({
      cls: "mediavault-import-detection-line",
      text: t("import.filesRecognized", {
        recognized: zip.supportedCount,
        unsupported: zip.unsupportedCount,
      }),
    });
  }

  private renderPreview(
    container: HTMLElement,
    bundle: NormalizedImportBundle,
    preview: ImportPreviewSummary,
    canImport: boolean,
  ): void {
    const summary = container.createDiv({ cls: "mediavault-import-summary" });
    summary.createEl("h3", { text: t("import.preview") });

    const lines = [
      preview.watchCount > 0
        ? t("import.watchEvents", { count: preview.watchCount })
        : null,
      preview.reviewCount > 0
        ? t("import.comments", { count: preview.reviewCount })
        : null,
      preview.likeCount > 0
        ? t("import.likes", { count: preview.likeCount })
        : null,
      preview.ratingCount > 0
        ? t("import.ratings", { count: preview.ratingCount })
        : null,
      preview.favoriteCount > 0
        ? t("import.favorites", { count: preview.favoriteCount })
        : null,
      preview.listCount > 0
        ? t("import.customLists", { count: preview.listCount })
        : null,
      t("import.existingTitles", { count: preview.existingTitles }),
      t("import.newTitles", { count: preview.newTitles }),
      preview.warningCount > 0
        ? t("import.willBeSkipped", { count: preview.warningCount })
        : null,
    ].filter((l): l is string => l !== null);

    if (lines.length === 0) {
      summary.createDiv({
        cls: "mediavault-import-empty",
        text: t("import.nothingImportable"),
      });
      return;
    }

    lines.forEach((l) => summary.createDiv({ text: `\u2022 ${l}` }));

    summary.createDiv({
      cls: "mediavault-import-hint",
      text: t("import.neverOverwrittenHint"),
    });

    if (!canImport) return;

    const actions = container.createDiv({ cls: "mediavault-import-actions" });
    const commitBtn = actions.createEl("button", {
      text: this.importing ? t("import.importing") : t("import.confirmImport"),
      cls: "mod-cta",
    });
    commitBtn.disabled = this.importing;
    commitBtn.addEventListener("click", () => void this.runCommit(bundle));
  }

  private renderReport(container: HTMLElement, report: ImportReport): void {
    container.createEl("h3", { text: t("import.importComplete") });

    if (report.timing.length > 0) {
      const timingBox = container.createDiv({
        cls: "mediavault-import-timing",
      });
      timingBox.createEl("h4", { text: t("import.timeBreakdown") });
      report.timing.forEach(({ stage, ms }) => {
        timingBox.createDiv({
          cls:
            stage === "Total"
              ? "mediavault-import-report-row is-total"
              : "mediavault-import-report-row",
          text: `${stage}: ${ImportTimer.formatMs(ms)}`,
        });
      });
    }

    const box = container.createDiv({ cls: "mediavault-import-report" });

    const rows: [string, number][] = [
      [t("import.moviesImported"), report.moviesImported],
      [t("import.showsImported"), report.showsImported],
      [t("import.episodesUpdated"), report.episodesUpdated],
      [t("import.commentsImported"), report.commentsImported],
      [t("import.likesImported"), report.likesImported],
      [t("import.favoritesImported"), report.favoritesImported],
      [t("import.ratingsImported"), report.ratingsImported],
      [t("import.listsImported"), report.listsImported],
      [t("import.builtInListsImported"), report.builtInListsImported],
      [t("import.customListsImported"), report.customListsImported],
      [t("import.droppedImported"), report.droppedImported],
      [t("import.duplicatesMerged"), report.duplicatesMerged],
      [t("import.skipped"), report.skipped],
    ];
    rows.forEach(([label, value]) => {
      box.createDiv({
        cls: "mediavault-import-report-row",
        text: `${label}: ${value}`,
      });
    });

    const diagBox = container.createDiv({
      cls: "mediavault-import-diagnostics",
    });
    diagBox.createEl("h4", { text: t("import.diagnostics") });
    const totalHours = report.totalImportedRuntimeSeconds / 3600;
    const diagRows: [string, string][] = [
      [t("import.totalRecordsParsed"), String(report.totalRecordsParsed)],
      [t("import.mediaMatched"), String(report.matchedMediaCount)],
      [t("import.mediaUnmatched"), String(report.unmatchedMediaCount)],
      [t("import.exactMatches"), String(report.exactMatchCount)],
      [t("import.metadataMatches"), String(report.metadataMatchCount)],
      [
        t("import.episodeHistoryMatches"),
        String(report.episodeHistoryMatchCount),
      ],
      [
        t("import.popularityTieBreakMatches"),
        String(report.popularityTieBreakCount),
      ],
      [t("import.episodesMatched"), String(report.matchedEpisodes)],
      [t("import.episodesUnmatched"), String(report.unmatchedEpisodes)],
      [
        t("import.totalImportedWatchTime"),
        t("import.hoursUnit", { n: totalHours.toFixed(1) }),
      ],
      [t("import.listsDiscovered"), String(report.listsDiscovered)],
      [t("import.totalListItems"), String(report.totalListItems)],
      [t("import.listItemsMatched"), String(report.matchedListItems)],
      [t("import.listItemsMissing"), String(report.missingListItems)],
      [t("import.droppedRecordsFound"), String(report.droppedRecordsFound)],
      [t("import.droppedMoviesImported"), String(report.droppedMoviesImported)],
      [t("import.droppedSeriesImported"), String(report.droppedSeriesImported)],
    ];
    diagRows.forEach(([label, value]) => {
      diagBox.createDiv({
        cls: "mediavault-import-report-row",
        text: `${label}: ${value}`,
      });
    });

    const skipReasons = Object.entries(report.skippedByReason).sort(
      (a, b) => b[1] - a[1],
    );
    if (skipReasons.length > 0) {
      diagBox.createDiv({
        cls: "mediavault-import-unmatched-group-label",
        text: t("import.whyRecordsSkipped"),
      });
      skipReasons.forEach(([reason, count]) => {
        diagBox.createDiv({
          cls: "mediavault-import-report-row",
          text: `${reason}: ${count}`,
        });
      });
    }

    if (report.unmatched.length > 0) {
      const unmatchedBox = container.createDiv({
        cls: "mediavault-import-unmatched",
      });
      unmatchedBox.createEl("h4", {
        text: t("import.unmatchedCount", { count: report.unmatched.length }),
      });

      const movies = report.unmatched.filter((u) => u.kind === "movie");
      const series = report.unmatched.filter((u) => u.kind === "series");

      const renderGroup = (label: string, items: UnmatchedItem[]) => {
        if (items.length === 0) return;
        unmatchedBox.createDiv({
          cls: "mediavault-import-unmatched-group-label",
          text: label,
        });
        items.slice(0, 25).forEach((u) => {
          unmatchedBox.createDiv({
            cls: "mediavault-import-unmatched-item",
            text: `${u.title}${u.year ? ` (${u.year})` : ""} \u2014 ${u.reason}`,
          });
        });
        if (items.length > 25) {
          unmatchedBox.createDiv({
            cls: "mediavault-import-hint",
            text: t("import.andNMore", { n: items.length - 25 }),
          });
        }
      };

      renderGroup(t("import.movies"), movies);
      renderGroup(t("import.series"), series);
    }

    if (report.unmatchedListSKeys.length > 0) {
      const sKeyBox = container.createDiv({
        cls: "mediavault-import-unmatched",
      });
      sKeyBox.createEl("h4", {
        text: t("import.unmatchedSKeysCount", {
          count: report.unmatchedListSKeys.length,
        }),
      });
      report.unmatchedListSKeys.forEach((sKey) => {
        sKeyBox.createDiv({
          cls: "mediavault-import-unmatched-item",
          text: sKey,
        });
      });
    }

    if (report.errors.length > 0) {
      const errBox = container.createDiv({ cls: "mediavault-import-errors" });
      errBox.createEl("h4", { text: t("import.otherErrors") });
      report.errors
        .slice(0, 20)
        .forEach((e) => errBox.createDiv({ text: `\u2022 ${e.reason}` }));
      if (report.errors.length > 20) {
        errBox.createDiv({
          text: t("import.andNMoreConsole", { n: report.errors.length - 20 }),
        });
      }
      console.warn("MediaVault import errors:", report.errors);
    }

    const doneBtn = container.createEl("button", {
      text: t("import.done"),
      cls: "mod-cta",
    });
    doneBtn.addEventListener("click", () => this.close());
  }

  private async runCommit(bundle: NormalizedImportBundle): Promise<void> {
    this.importing = true;
    this.render();

    try {
      this.report = await commitBundle(
        this.storage,
        this.tmdb,
        bundle,
        (done, total, stage) => {
          this.updateProgress(done, total, stage);
        },
      );
      if (this.zipTiming.length > 0) {
        const merged = new Map<string, { ms: number; calls: number }>();
        for (const { stage, ms, calls } of [
          ...this.zipTiming,
          ...this.report.timing,
        ]) {
          if (stage === "Total") continue;
          const existing = merged.get(stage);
          merged.set(stage, {
            ms: (existing?.ms ?? 0) + ms,
            calls: (existing?.calls ?? 0) + calls,
          });
        }
        const totalMs =
          (this.zipTiming.find((t) => t.stage === "Total")?.ms ?? 0) +
          (this.report.timing.find((t) => t.stage === "Total")?.ms ?? 0);
        this.report.timing = [
          ...[...merged.entries()]
            .map(([stage, v]) => ({ stage, ms: v.ms, calls: v.calls }))
            .sort((a, b) => b.ms - a.ms),
          { stage: "Total", ms: totalMs, calls: 0 },
        ];
      }
      new Notice(
        t("import.importCompleteNotice", {
          count: this.report.moviesImported + this.report.showsImported,
          merged: this.report.duplicatesMerged,
        }),
      );

      const today = new Date().toISOString().slice(0, 10);
      const priorImportDate =
        this.storage.settings.get().notificationDataImportDate;
      if (!priorImportDate || priorImportDate < today) {
        await this.storage.settings.update({
          notificationDataImportDate: today,
        });
      }
      this.onImported?.();
    } catch (err) {
      new Notice(t("import.importFailed", { error: (err as Error).message }));
    } finally {
      this.importing = false;
      this.render();
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
