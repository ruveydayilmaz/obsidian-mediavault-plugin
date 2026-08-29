import {
  App,
  Notice,
  PluginSettingTab,
  Platform,
  type SettingDefinitionItem,
} from "obsidian";
import type MediaVaultPlugin from "../main";
import { RatingScale } from "../types/enums";
import type { MediaVaultSettings } from "./settings";
import { TraktAuthModal } from "../ui/modals/trakt-auth-modal";
import { NotificationHistoryModal } from "../ui/modals/notification-history-modal";
import { disconnectTrakt } from "../services/trakt-token";
import { i18n, t } from "../i18n";
import { SUPPORTED_LOCALES, Locale } from "../i18n/types";
import { TMDB_LANGUAGES } from "../api/tmdb-languages";
import { resolveTmdbLanguage } from "../api/tmdb";
import { makeClearable } from "../ui/components/clearable-input";
import { FactoryResetModal } from "../ui/modals/factory-reset-modal";

export class MediaVaultSettingTab extends PluginSettingTab {
  plugin: MediaVaultPlugin;

  constructor(app: App, plugin: MediaVaultPlugin) {
    super(app, plugin);
    this.plugin = plugin;
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

    return [
      {
        name: t("settings.title"),
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
                await settings.update({
                  mediaFolderPath: value.trim() || "Mediavault",
                });
              });
            makeClearable(text.inputEl);
          });
        },
      },
      {
        name: t("settings.autoCreateNotes"),
        desc: t("settings.autoCreateNotesDesc"),
        render: (setting) => {
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
        name: t("settings.displaySection"),
        render: (setting) => {
          setting.setHeading();
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
                await this.plugin.runNotificationCheckNow();
                new Notice(t("settings.checkNowComplete"));
                this.update();
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
    ];
  }
}