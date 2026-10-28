import {
  App,
  Notice,
  PluginSettingTab,
  type Setting,
  Platform,
  setIcon,
  type SettingDefinitionItem,
} from "obsidian";
import type MediaVaultPlugin from "../main";
import { normalizeSafeFolderPath } from "../utils/vault-path";
import { RatingScale } from "../types/enums";
import {
  type MediaVaultSettings,
  DEFAULT_SETTINGS,
  NoteTemplateOptionalPropertyKey,
  NoteTemplateSectionKey,
} from "./settings";
import { TraktAuthModal } from "../ui/modals/trakt-auth-modal";
import { NotificationHistoryModal } from "../ui/modals/notification-history-modal";
import { MediaVaultImportExportModal } from "../ui/modals/mediavault-import-export-modal";
import { InfoModal } from "../ui/modals/info-modal";
import { disconnectTrakt } from "../services/trakt-token";
import { i18n, t } from "../i18n";
import { SUPPORTED_LOCALES, Locale } from "../i18n/types";
import { TMDB_LANGUAGES } from "../api/tmdb-languages";
import { resolveTmdbLanguage } from "../api/tmdb";
import { makeClearable } from "../ui/components/clearable-input";
import { FactoryResetModal } from "../ui/modals/factory-reset-modal";
import { BackupsModal } from "../ui/modals/backups-modal";
import {
  ANDROID_MENU_OFFSET_MAX,
  ANDROID_MENU_OFFSET_MIN,
  ANDROID_MENU_OFFSET_STEP,
  applyAndroidMenuOffset,
  clampAndroidMenuOffset,
} from "../utils/platform";

const SUBPAGE_HEADING_KEYS = new Set([
  "settings.tmdbSection",
  "settings.traktSection",
  "settings.vaultIntegrationSection",
  "settings.noteTemplateSection",
  "settings.displaySection",
  "settings.notificationsSection",
]);

const SECTION_HEADING_KEYS = [
  "settings.tmdbSection",
  "settings.traktSection",
  "settings.vaultIntegrationSection",
  "settings.noteTemplateSection",
  "settings.displaySection",
  "settings.notificationsSection",
  "factoryReset.sectionTitle",
];

const OPTIONAL_PROPERTY_CATALOG: {
  key: NoteTemplateOptionalPropertyKey;
  nameKey: string;
}[] = [
  { key: "genres", nameKey: "settings.noteTemplatePropGenres" },
  { key: "status", nameKey: "settings.noteTemplatePropStatus" },
  { key: "rating_avg", nameKey: "settings.noteTemplatePropRatingAvg" },
  { key: "watch_count", nameKey: "settings.noteTemplatePropWatchCount" },
  // { key: "synopsis", nameKey: "settings.noteTemplatePropSynopsis" },
  { key: "platform", nameKey: "settings.noteTemplatePropPlatform" },
  { key: "release_date", nameKey: "settings.noteTemplatePropReleaseDate" },
  { key: "runtime", nameKey: "settings.noteTemplatePropRuntime" },
  // { key: "cast", nameKey: "settings.noteTemplatePropCast" },
  { key: "director", nameKey: "settings.noteTemplatePropDirector" },
  { key: "producer", nameKey: "settings.noteTemplatePropProducer" },
  { key: "studios", nameKey: "settings.noteTemplatePropStudios" },
  { key: "country", nameKey: "settings.noteTemplatePropCountry" },
  // { key: "language", nameKey: "settings.noteTemplatePropLanguage" },
  { key: "poster", nameKey: "settings.noteTemplatePropPoster" },
  { key: "backdrop", nameKey: "settings.noteTemplatePropBackdrop" },
  { key: "tmdb_url", nameKey: "settings.noteTemplatePropTmdbUrl" },
];

const SECTION_CATALOG: { key: NoteTemplateSectionKey; nameKey: string }[] = [
  { key: "genreTags", nameKey: "settings.noteTemplateSectionGenreTags" },
  { key: "synopsis", nameKey: "settings.noteTemplatePropSynopsis" },
  { key: "cast", nameKey: "settings.noteTemplatePropCast" },
  { key: "directors", nameKey: "settings.noteTemplateSectionDirectors" },
  { key: "producers", nameKey: "settings.noteTemplateSectionProducers" },
  { key: "crew", nameKey: "settings.noteTemplateSectionCrew" },
  { key: "watchHistory", nameKey: "settings.noteTemplateSectionWatchHistory" },
];

export class MediaVaultSettingTab extends PluginSettingTab {
  plugin: MediaVaultPlugin;

  constructor(app: App, plugin: MediaVaultPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  private applySubpages(items: SettingDefinitionItem[]): SettingDefinitionItem[] {
    const sectionNames = new Set(SECTION_HEADING_KEYS.map((k) => t(k)));
    const subpageNames = new Set(
      [...SUBPAGE_HEADING_KEYS].map((k) => t(k)),
    );
    const out: SettingDefinitionItem[] = [];
    let page: { type: "page"; name: string; items: SettingDefinitionItem[] } | null =
      null;

    for (const item of items) {
      const name = (item as { name?: string }).name;
      if (name && sectionNames.has(name)) {
        page = null;
        if (subpageNames.has(name)) {
          page = { type: "page", name, items: [] };
          out.push(page);
          continue;
        }
        out.push(item);
        continue;
      }
      if (page) page.items.push(item);
      else out.push(item);
    }
    return out;
  }

  private addInfoButton(
    setting: Setting,
    titleKey: string,
    bodyKey: string,
  ): void {
    const infoBtn = setting.controlEl.createEl("button", {
      cls: "clickable-icon mediavault-info-icon-btn",
      attr: { "aria-label": t(titleKey) },
    });
    setIcon(infoBtn, "info");
    infoBtn.addEventListener("click", () => {
      new InfoModal(this.app, t(titleKey), t(bodyKey)).open();
    });
  }

  private markWideInputRows(
    items: SettingDefinitionItem[],
  ): SettingDefinitionItem[] {
    const TEXT_INPUT =
      'input[type="text"], input[type="url"], input[type="search"], input[type="password"], input:not([type]), textarea';
    for (const item of items) {
      const anyItem = item as {
        render?: (setting: Setting) => void;
        items?: SettingDefinitionItem[];
      };
      if (anyItem.items) this.markWideInputRows(anyItem.items);
      const original = anyItem.render;
      if (!original) continue;
      anyItem.render = (setting: Setting): void => {
        original(setting);
        if (setting.controlEl.querySelector(TEXT_INPUT)) {
          setting.settingEl.addClass("mediavault-setting-wide-input");
        }
      };
    }
    return items;
  }

  getSettingDefinitions(): SettingDefinitionItem[] {
    const settings = this.plugin.storage.settings;

    const notifTypeLabels: {
      key: keyof MediaVaultSettings["notificationsEnabled"];
      name: string;
      desc: string;
    }[] = [
      {
        key: "newEpisode",
        name: t("settings.notifNewEpisode"),
        desc: t("settings.notifNewEpisodeDesc"),
      },
      {
        key: "newSeason",
        name: t("settings.notifNewSeason"),
        desc: t("settings.notifNewSeasonDesc"),
      },
      {
        key: "movieReleased",
        name: t("settings.notifMovieReleased"),
        desc: t("settings.notifMovieReleasedDesc"),
      },
      {
        key: "seriesReturned",
        name: t("settings.notifSeriesReturned"),
        desc: t("settings.notifSeriesReturnedDesc"),
      },
      {
        key: "watchlistReminder",
        name: t("settings.notifWatchlistReminder"),
        desc: t("settings.notifWatchlistReminderDesc"),
      },
      {
        key: "continueWatchingReminder",
        name: t("settings.notifContinueWatching"),
        desc: t("settings.notifContinueWatchingDesc"),
      },
    ];

    return this.markWideInputRows(this.applySubpages([
      {
        name: t("settings.tmdbSection"),
        render: (setting) => {
          setting.setHeading();
        },
      },
      {
        name: t("settings.tmdbApiKey"),
        desc: t("settings.tmdbApiKeyDesc"),
        render: (setting) => {
          setting.addText((text) => {
            text
              .setPlaceholder(t("settings.tmdbApiKeyPlaceholder"))
              .setValue(settings.get().tmdbApiKey)
              .onChange(async (value) => {
                await settings.update({ tmdbApiKey: value.trim() });
                this.plugin.tmdb.clearCache();
              });
            makeClearable(text.inputEl);
          });
        },
      },
      {
        name: t("settings.tmdbLanguage"),
        desc: t("settings.tmdbLanguageDesc"),
        render: (setting) => {
          const current =
            settings.get().tmdbLanguage.trim() ||
            resolveTmdbLanguage("", settings.get().language);
          const options: Record<string, string> = {};
          for (const lang of TMDB_LANGUAGES) {
            options[lang.code] = `${lang.label} (${lang.code})`;
          }
          if (!(current in options)) options[current] = current;
          setting.addDropdown((dropdown) => {
            dropdown
              .addOptions(options)
              .setValue(current)
              .onChange(async (value) => {
                await settings.update({ tmdbLanguage: value });
                this.plugin.tmdb.clearCache();
              });
          });
        },
      },
      {
        name: t("settings.cacheDuration"),
        desc: t("settings.cacheDurationDesc"),
        render: (setting) => {
          setting.addText((text) => {
            text
              .setPlaceholder("1440")
              .setValue(String(settings.get().cacheDurationMinutes))
              .onChange(async (value) => {
                const parsed = parseInt(value, 10);
                if (!isNaN(parsed) && parsed >= 0) {
                  await settings.update({ cacheDurationMinutes: parsed });
                }
              });
            makeClearable(text.inputEl);
          });
        },
      },
      {
        name: t("settings.episodeSyncInterval"),
        desc: t("settings.episodeSyncIntervalDesc"),
        render: (setting) => {
          setting.addText((text) => {
            text
              .setPlaceholder("24")
              .setValue(String(settings.get().episodeSyncIntervalHours))
              .onChange(async (value) => {
                const parsed = parseInt(value, 10);
                if (!isNaN(parsed) && parsed >= 0) {
                  await settings.update({ episodeSyncIntervalHours: parsed });
                }
              });
            makeClearable(text.inputEl);
          });
        },
      },
      {
        name: t("settings.showAdultContent"),
        desc: t("settings.showAdultContentDesc"),
        render: (setting) => {
          setting.addToggle((toggle) =>
            toggle
              .setValue(settings.get().showAdultContent)
              .onChange(async (value) => {
                await settings.update({ showAdultContent: value });
              }),
          );
        },
      },
      {
        name: t("settings.traktSection"),
        render: (setting) => {
          setting.setHeading();
        },
      },
      {
        name: t("settings.traktClientId"),
        render: (setting) => {
          setting.addText((text) => {
            text
              .setValue(settings.get().traktClientId)
              .onChange(async (value) => {
                await settings.update({ traktClientId: value.trim() });
              });
            makeClearable(text.inputEl);
          });
        },
      },
      {
        name: t("settings.traktClientSecret"),
        render: (setting) => {
          setting.setDesc(t("settings.traktClientSecretDesc"));
          setting.addText((text) => {
            text
              .setValue(settings.get().traktClientSecret)
              .onChange(async (value) => {
                await settings.update({ traktClientSecret: value.trim() });
              });
            makeClearable(text.inputEl);
          });
        },
      },
      {
        name: t("settings.connectTraktAccount"),
        render: (setting) => {
          setting.setDesc(
            settings.get().traktAccessToken
              ? t("settings.connected")
              : t("settings.notConnected"),
          );
          setting.addButton((btn) => {
            if (settings.get().traktAccessToken) {
              btn
                .setButtonText(t("settings.traktDisconnect"))
                .onClick(async () => {
                  await disconnectTrakt(this.plugin.storage);
                  new Notice(t("settings.traktDisconnected"));
                  this.update();
                });
            } else {
              btn
                .setButtonText(t("settings.traktConnect"))
                .setCta()
                .onClick(() => {
                  new TraktAuthModal(this.app, this.plugin.storage, () =>
                    this.update(),
                  ).open();
                });
            }
          });
        },
      },
      {
        name: t("settings.traktAutoSync"),
        visible: () => Boolean(settings.get().traktAccessToken),
        render: (setting) => {
          setting.addDropdown((dropdown) =>
            dropdown
              .addOptions({
                manual: t("settings.autoSyncManual"),
                on_startup: t("settings.autoSyncOnStartup"),
                interval: t("settings.autoSyncInterval"),
              })
              .setValue(settings.get().traktAutoSync)
              .onChange(async (value) => {
                await settings.update({
                  traktAutoSync: value as MediaVaultSettings["traktAutoSync"],
                });
              }),
          );
        },
      },
      {
        name: t("settings.syncIntervalMinutes"),
        desc: t("settings.syncIntervalMinutesDesc"),
        visible: () => Boolean(settings.get().traktAccessToken),
        render: (setting) => {
          setting.addText((text) => {
            text
              .setValue(String(settings.get().traktSyncIntervalMinutes))
              .onChange(async (value) => {
                const parsed = parseInt(value, 10);
                if (!isNaN(parsed) && parsed > 0) {
                  await settings.update({ traktSyncIntervalMinutes: parsed });
                }
              });
            makeClearable(text.inputEl);
          });
        },
      },
      {
        name: t("settings.historyNotePath"),
        desc: t("settings.historyNotePathDesc"),
        visible: () => Boolean(settings.get().traktAccessToken),
        render: (setting) => {
          setting.addText((text) => {
            text
              .setValue(settings.get().traktHistoryNotePath)
              .onChange(async (value) => {
                await settings.update({
                  traktHistoryNotePath:
                    value.trim() || "MediaVault/Trakt Rating History.md",
                });
              });
            makeClearable(text.inputEl);
          });
        },
      },
      {
        name: t("settings.syncNow"),
        visible: () => Boolean(settings.get().traktAccessToken),
        render: (setting) => {
          const lastSyncedAt = settings.get().traktLastSyncedAt;
          setting.setDesc(
            lastSyncedAt
              ? t("settings.lastSynced", {
                  date: i18n.formatDate(lastSyncedAt, {
                    dateStyle: "medium",
                    timeStyle: "short",
                  }),
                })
              : t("settings.neverSyncedYet"),
          );
          setting.addButton((btn) =>
            btn.setButtonText(t("settings.syncNow")).onClick(async () => {
              await this.plugin.runTraktSync();
              this.update();
            }),
          );
        },
      },

      {
        name: t("settings.commentsLanguagesSection"),
        desc: t("settings.commentsLanguagesDesc"),
        render: (setting) => {
          setting.setHeading();
        },
      },
      {
        name: t("settings.primaryLanguage"),
        render: (setting) => {
          setting.addText((text) => {
            text
              .setPlaceholder(t("common.en"))
              .setValue(settings.get().commentsPrimaryLanguage)
              .onChange(async (value) => {
                await settings.update({
                  commentsPrimaryLanguage: value.trim().toLowerCase() || "en",
                });
              });
            makeClearable(text.inputEl);
          });
        },
      },
      {
        name: t("settings.additionalLanguages"),
        desc: t("settings.additionalLanguagesDesc"),
        render: (setting) => {
          setting.addText((text) => {
            text
              .setPlaceholder(t("common.ja"))
              .setValue(settings.get().commentsAdditionalLanguages.join(", "))
              .onChange(async (value) => {
                const langs = value
                  .split(",")
                  .map((l) => l.trim().toLowerCase())
                  .filter((l) => l.length > 0);
                await settings.update({ commentsAdditionalLanguages: langs });
              });
            makeClearable(text.inputEl);
          });
        },
      },

      {
        name: t("settings.vaultIntegrationSection"),
        render: (setting) => {
          setting.setHeading();
        },
      },
      {
        name: t("settings.mediaFolderPath"),
        desc: t("settings.mediaFolderPathDesc"),
        render: (setting) => {
          setting.addText((text) => {
            text
              .setPlaceholder("Mediavault")
              .setValue(settings.get().mediaFolderPath)
              .onChange(async (value) => {
                const trimmed = value.trim();
                if (trimmed === "") {
                  text.inputEl.removeClass("mod-error");
                  await settings.update({ mediaFolderPath: "Mediavault" });
                  return;
                }
                const safe = normalizeSafeFolderPath(trimmed);
                text.inputEl.toggleClass("mod-error", safe === null);
                text.inputEl.setAttribute(
                  "aria-invalid",
                  safe === null ? "true" : "false",
                );
                if (safe === null) return;
                await settings.update({ mediaFolderPath: safe });
              });
            makeClearable(text.inputEl);
          });
        },
      },
      {
        name: t("settings.autoCreateNotes"),
        desc: t("settings.autoCreateNotesDesc"),
        render: (setting) => {
          const infoBtn = setting.controlEl.createEl("button", {
            cls: "clickable-icon mediavault-info-icon-btn",
            attr: { "aria-label": t("settings.dataPreservationInfoTitle") },
          });
          setIcon(infoBtn, "info");
          infoBtn.addEventListener("click", () => {
            new InfoModal(
              this.app,
              t("settings.dataPreservationInfoTitle"),
              t("settings.dataPreservationInfoBody"),
            ).open();
          });

          setting.addToggle((toggle) =>
            toggle
              .setValue(settings.get().autoCreateNotes)
              .onChange(async (value) => {
                await settings.update({ autoCreateNotes: value });
              }),
          );
        },
      },
      {
        name: t("settings.generateAllNotes"),
        desc: t("settings.generateAllNotesDesc"),
        render: (setting) => {
          setting.addButton((btn) =>
            btn.setButtonText(t("settings.generateAllNotes")).onClick(async () => {
              await this.plugin.regenerateAllNotes();
            }),
          );
        },
      },

      {
        name: t("backup.settingName"),
        desc: t("backup.settingDesc"),
        render: (setting) => {
          setting.addButton((btn) =>
            btn.setButtonText(t("backup.viewButton")).onClick(() => {
              new BackupsModal(this.app, this.plugin).open();
            }),
          );
        },
      },
      {
        name: t("backup.keepCount"),
        desc: t("backup.keepCountDesc"),
        render: (setting) => {
          setting.addText((text) => {
            text.inputEl.type = "number";
            text.inputEl.min = "5";
            text.inputEl.max = "500";
            text
              .setValue(String(settings.get().backupKeepCount))
              .onChange(async (value) => {
                const n = parseInt(value, 10);
                if (!Number.isFinite(n)) return;
                await settings.update({
                  backupKeepCount: Math.max(5, Math.min(500, n)),
                });
              });
          });
        },
      },
      {
        name: t("exportImport.settingName"),
        desc: t("exportImport.settingDesc"),
        render: (setting) => {
          setting.addButton((btn) =>
            btn.setButtonText(t("command.exportLibrary")).onClick(async () => {
              await this.plugin.runExportLibrary();
            }),
          );
          setting.addButton((btn) =>
            btn
              .setButtonText(t("command.importMediaVaultExport"))
              .onClick(() => {
                new MediaVaultImportExportModal(
                  this.app,
                  this.plugin.storage,
                  () => {
                    this.plugin.refreshLibraryViews();
                    this.plugin.refreshListViews();
                  },
                ).open();
              }),
          );
        },
      },
      {
        name: t("settings.autoSyncNotes"),
        desc: t("settings.autoSyncNotesDesc"),
        render: (setting) => {
          this.addInfoButton(
            setting,
            "settings.syncExperimentalInfoTitle",
            "settings.syncExperimentalInfoBody",
          );
          setting.addToggle((toggle) =>
            toggle
              .setValue(settings.get().autoSyncNotes)
              .onChange(async (value) => {
                await settings.update({ autoSyncNotes: value });
              }),
          );
        },
      },
      {
        name: t("noteSync.settingName"),
        desc: t("noteSync.settingDesc"),
        render: (setting) => {
          const state = settings.get().noteSyncState;
          setting.setDesc(
            state.lastSuccessfulSyncAt
              ? t("noteSync.lastSynced", { date: state.lastSuccessfulSyncAt })
              : t("noteSync.neverSynced"),
          );
          this.addInfoButton(
            setting,
            "settings.syncExperimentalInfoTitle",
            "settings.syncExperimentalInfoBody",
          );
          setting.addButton((btn) =>
            btn.setButtonText(t("noteSync.syncNow")).onClick(async () => {
              await this.plugin.runManualNoteSync();
              this.update();
            }),
          );
        },
      },

      {
        name: t("settings.noteTemplateSection"),
        render: (setting) => {
          setting.setHeading();
        },
      },
      {
        name: t("settings.noteCustomMarkdown"),
        desc: t("settings.noteCustomMarkdownDesc"),
        render: (setting) => {
          let timer: number | null = null;
          setting.addTextArea((area) => {
            area
              .setPlaceholder(t("settings.noteCustomMarkdownPlaceholder"))
              .setValue(settings.get().noteCustomMarkdown ?? "")
              .onChange((value) => {
                void settings.update({ noteCustomMarkdown: value });

                if (timer !== null) window.clearTimeout(timer);
                timer = window.setTimeout(() => {
                  timer = null;
                  void this.plugin.refreshGeneratedNotes();
                }, 1500);
              });
            area.inputEl.rows = 6;
            area.inputEl.addClass("mediavault-custom-markdown-input");
          });
        },
      },
      {
        name: t("settings.noteTemplateRequiredProperties"),
        desc: `${t("settings.noteTemplateRequiredPropertiesDesc")} (type, title, tmdb_id, year)`,
        render: () => {
          // nothing to toggle here
        },
      },
      ...OPTIONAL_PROPERTY_CATALOG.map(
        ({ key, nameKey }): SettingDefinitionItem => ({
          name: t(nameKey),
          desc: t("settings.noteTemplatePropertyDesc"),
          render: (setting) => {
            setting.addToggle((toggle) =>
              toggle
                .setValue(settings.get().noteTemplate.optionalProperties[key])
                .onChange(async (value) => {
                  await settings.update({
                    noteTemplate: {
                      ...settings.get().noteTemplate,
                      optionalProperties: {
                        ...settings.get().noteTemplate.optionalProperties,
                        [key]: value,
                      },
                    },
                  });
                }),
            );
          },
        }),
      ),
      {
        name: t("settings.noteTemplateSections"),
        render: (setting) => {
          setting.setHeading();
        },
      },
      ...SECTION_CATALOG.map(
        ({ key, nameKey }): SettingDefinitionItem => ({
          name: t(nameKey),
          desc: t("settings.noteTemplateSectionDesc"),
          render: (setting) => {
            setting.addToggle((toggle) =>
              toggle
                .setValue(settings.get().noteTemplate.sections[key])
                .onChange(async (value) => {
                  await settings.update({
                    noteTemplate: {
                      ...settings.get().noteTemplate,
                      sections: {
                        ...settings.get().noteTemplate.sections,
                        [key]: value,
                      },
                    },
                  });
                }),
            );
          },
        }),
      ),
      {
        name: t("settings.noteTemplateReset"),
        desc: t("settings.noteTemplateResetDesc"),
        render: (setting) => {
          setting.addButton((btn) =>
            btn.setButtonText(t("settings.noteTemplateReset")).onClick(async () => {
              await settings.update({
                noteTemplate: DEFAULT_SETTINGS.noteTemplate,
              });
              new Notice(t("settings.noteTemplateResetComplete"));
              this.update();
            }),
          );
        },
      },

      {
        name: t("settings.displaySection"),
        render: (setting) => {
          setting.setHeading();
        },
      },
      {
        name: t("settings.language"),
        desc: t("settings.languageDesc"),
        render: (setting) => {
          const options: Record<string, string> = {};
          for (const loc of SUPPORTED_LOCALES) options[loc.code] = loc.label;
          setting.addDropdown((dropdown) => {
            dropdown
              .addOptions(options)
              .setValue(settings.get().language)
              .onChange(async (value) => {
                await this.plugin.setLanguage(value as Locale);
                this.update();
              });
          });
        },
      },

      {
        name: t("settings.showLibraryCarousels"),
        desc: t("settings.showLibraryCarouselsDesc"),
        render: (setting) => {
          setting.addToggle((toggle) =>
            toggle
              .setValue(settings.get().showLibraryCarousels)
              .onChange(async (value) => {
                await settings.update({ showLibraryCarousels: value });

                this.plugin.refreshLibraryViews();
              }),
          );
        },
      },

      {
        name: t("settings.defaultView"),
        visible: () => !Platform.isMobileApp,
        render: (setting) => {
          setting.addDropdown((dropdown) =>
            dropdown
              .addOptions({
                grid: t("settings.defaultViewGrid"),
                list: t("settings.defaultViewList"),
                table: t("settings.defaultViewTable"),
              })
              .setValue(settings.get().defaultView)
              .onChange(async (value) => {
                await settings.update({
                  defaultView: value as MediaVaultSettings["defaultView"],
                });
              }),
          );
        },
      },
      {
        name: t("settings.ratingScale"),
        render: (setting) => {
          setting.addDropdown((dropdown) =>
            dropdown
              .addOptions({
                [RatingScale.FiveStar]: t("settings.ratingScaleFiveStar"),
                [RatingScale.TenPoint]: t("settings.ratingScaleTenPoint"),
                [RatingScale.HundredPoint]: t(
                  "settings.ratingScaleHundredPoint",
                ),
              })
              .setValue(settings.get().ratingScale)
              .onChange(async (value) => {
                await settings.update({ ratingScale: value as RatingScale });
              }),
          );
        },
      },

      {
        name: t("settings.androidMenuOffset"),
        desc: t("settings.androidMenuOffsetDesc"),
        visible: () => Platform.isMobile,
        render: (setting) => {
          const controls = setting.controlEl.createDiv({
            cls: "mediavault-android-offset-control",
          });
          const minus = controls.createEl("button", {
            text: "−",
            attr: { "aria-label": t("settings.androidMenuOffsetUp") },
          });
          const valueEl = controls.createSpan({
            cls: "mediavault-android-offset-value",
          });
          const plus = controls.createEl("button", {
            text: "+",
            attr: { "aria-label": t("settings.androidMenuOffsetDown") },
          });
          const current = (): number =>
            clampAndroidMenuOffset(settings.get().androidMenuOffsetPx);
          const refresh = (): void => {
            const v = current();
            valueEl.setText(`${v > 0 ? "+" : ""}${v} px`);
            minus.disabled = v <= ANDROID_MENU_OFFSET_MIN;
            plus.disabled = v >= ANDROID_MENU_OFFSET_MAX;
          };
          const change = (delta: number): void => {
            const next = clampAndroidMenuOffset(current() + delta);
            if (next === current()) return;

            applyAndroidMenuOffset(next);
            void settings.update({ androidMenuOffsetPx: next });
            refresh();
          };

          minus.addEventListener("click", () => change(-ANDROID_MENU_OFFSET_STEP));
          plus.addEventListener("click", () => change(ANDROID_MENU_OFFSET_STEP));
          refresh();
        },
      },

      {
        name: t("settings.notificationsSection"),
        render: (setting) => {
          setting.setHeading();
        },
      },
      ...notifTypeLabels.map(
        ({ key, name, desc }): SettingDefinitionItem => ({
          name,
          desc,
          render: (setting) => {
            setting.addToggle((toggle) =>
              toggle
                .setValue(settings.get().notificationsEnabled[key])
                .onChange(async (value) => {
                  await settings.update({
                    notificationsEnabled: {
                      ...settings.get().notificationsEnabled,
                      [key]: value,
                    },
                  });
                }),
            );
          },
        }),
      ),
      {
        name: t("settings.notificationTime"),
        desc: t("settings.notificationTimeDesc"),
        render: (setting) => {
          setting.addText((text) => {
            text
              .setPlaceholder("09:00")
              .setValue(settings.get().notificationTime)
              .onChange(async (value) => {
                if (/^\d{1,2}:\d{2}$/.test(value.trim())) {
                  await settings.update({ notificationTime: value.trim() });
                }
              });
            makeClearable(text.inputEl);
          });
        },
      },
      {
        name: t("settings.notificationTimezone"),
        desc: t("settings.notificationTimezoneDesc"),
        render: (setting) => {
          setting.addText((text) => {
            text
              .setPlaceholder(t("common.unknown"))
              .setValue(settings.get().notificationTimezone)
              .onChange(async (value) => {
                await settings.update({ notificationTimezone: value.trim() });
              });
            makeClearable(text.inputEl);
          });
        },
      },
      {
        name: t("settings.notificationSilent"),
        desc: t("settings.notificationSilentDesc"),
        render: (setting) => {
          setting.addToggle((toggle) =>
            toggle
              .setValue(settings.get().notificationSilent)
              .onChange(async (value) => {
                await settings.update({ notificationSilent: value });
              }),
          );
        },
      },
      {
        name: t("settings.checkNow"),
        render: (setting) => {
          const lastCheckedDate = settings.get().notificationLastCheckedDate;
          setting.setDesc(
            lastCheckedDate
              ? t("settings.lastChecked", {
                  date: lastCheckedDate,
                })
              : t("settings.neverCheckedYet"),
          );
          setting
            .addButton((btn) =>
              btn.setButtonText(t("settings.checkNow")).onClick(async () => {
                btn.setDisabled(true);
                btn.setButtonText(t("settings.checkNowRunning"));
                try {
                  const status = await this.plugin.runNotificationCheckNow();
                  if (status === "completed") {
                    new Notice(t("settings.checkNowComplete"));
                  } else if (status === "failed") {
                    new Notice(t("settings.checkNowFailed"));
                  }
                } finally {
                  this.update();
                }
              }),
            )
            .addButton((btn) =>
              btn.setButtonText(t("settings.viewHistory")).onClick(() => {
                new NotificationHistoryModal(this.app, this.plugin).open();
              }),
            );
        },
      },

      {
        name: t("factoryReset.sectionTitle"),
        render: (setting) => {
          setting.setHeading();
        },
      },
      {
        name: t("factoryReset.settingName"),
        desc: t("factoryReset.settingDesc"),
        render: (setting) => {
          setting.addButton((btn) =>
            btn
              .setButtonText(t("factoryReset.settingName"))
              .setDestructive()
              .onClick(() => {
                new FactoryResetModal(this.app, {
                  onConfirm: async () => {
                    await this.plugin.performFactoryReset();
                  },
                }).open();
              }),
          );
        },
      },
    ]));
  }
}