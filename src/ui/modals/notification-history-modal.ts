import { App, Modal } from "obsidian";
import { renderModalHeader } from "./modal-chrome";
import type MediaVaultPlugin from "../../main";
import { MediaVaultNotification } from "../../models/notification";
import { i18n, t } from "../../i18n";

export class NotificationHistoryModal extends Modal {
  private plugin: MediaVaultPlugin;
  private listEl!: HTMLElement;

  constructor(app: App, plugin: MediaVaultPlugin) {
    super(app);
    this.plugin = plugin;
  }

  async onOpen(): Promise<void> {
    this.plugin.registerLocaleAwareModal(this);
    await this.renderAll();
  }

  rerenderForLocaleChange(): void {
    void this.renderAll();
  }

  private async renderAll(): Promise<void> {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("mediavault-notification-history-modal");
    renderModalHeader(this, contentEl, t("notifications.title"), "h3");

    const markAllBtn = contentEl.createEl("button", {
      text: t("notifications.markAllRead"),
    });
    markAllBtn.addEventListener("click", () => {
      void (async () => {
        await this.plugin.storage.notifications.markAllRead();
        await this.renderList();
      })();
    });

    this.listEl = contentEl.createDiv({ cls: "mediavault-notification-list" });
    await this.renderList();
  }

  private async renderList(): Promise<void> {
    const notifications = await this.plugin.storage.notifications.recent(50);

    this.listEl.empty();

    if (notifications.length === 0) {
      this.listEl.createEl("p", {
        cls: "mediavault-empty-state",
        text: t("notifications.empty"),
      });
      return;
    }

    notifications.forEach((n) => this.renderRow(this.listEl, n));
  }

  private renderRow(list: HTMLElement, n: MediaVaultNotification): void {
    const row = list.createDiv({
      cls: "mediavault-notification-row" + (n.read ? "" : " is-unread"),
    });
    row.createDiv({ cls: "mediavault-notification-message", text: n.message });
    row.createDiv({
      cls: "mediavault-notification-date",
      text: i18n.formatDate(n.createdAt, {
        dateStyle: "medium",
        timeStyle: "short",
      }),
    });

    row.addEventListener("click", () => {
      void (async () => {
        const media = await this.plugin.storage.media.findById(n.mediaId);

        if (media) {
          this.plugin.openMediaDetail(media);
        }
      })();
    });
  }

  onClose(): void {
    this.plugin.unregisterLocaleAwareModal(this);
    this.contentEl.empty();
  }
}
