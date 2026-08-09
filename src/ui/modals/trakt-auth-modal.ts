import { App, Modal, Notice, setIcon } from "obsidian";
import { renderModalHeader } from "./modal-chrome";
import type { StorageService } from "../../services/storage";
import { requestDeviceCode, pollDeviceToken } from "../../api/trakt-auth";
import { t } from "../../i18n";

export class TraktAuthModal extends Modal {
  private storage: StorageService;
  private onConnected?: () => void;
  private pollTimer: number | null = null;
  private cancelled = false;

  constructor(app: App, storage: StorageService, onConnected?: () => void) {
    super(app);
    this.storage = storage;
    this.onConnected = onConnected;
  }

  async onOpen(): Promise<void> {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("mediavault-trakt-auth-modal");
    renderModalHeader(this, contentEl, t("settings.connectTrakt"));

    const settings = this.storage.settings.get();
    if (!settings.traktClientId || !settings.traktClientSecret) {
      contentEl.createDiv({
        text: t("settings.needClientCredentials"),
        cls: "mediavault-trakt-auth-error",
      });
      return;
    }

    const statusEl = contentEl.createDiv({
      cls: "mediavault-trakt-auth-status",
      text: t("settings.requestingDeviceCode"),
    });

    try {
      const device = await requestDeviceCode(settings.traktClientId);

      statusEl.empty();
      statusEl.createEl("p", { text: t("settings.goTo") });
      const link = statusEl.createEl("a", {
        text: device.verificationUrl,
        href: device.verificationUrl,
      });
      link.setAttr("target", "_blank");
      statusEl.createEl("p", { text: t("settings.enterThisCode") });
      const codeRow = statusEl.createDiv({ cls: "mediavault-trakt-code-row" });
      codeRow.createDiv({
        text: device.userCode,
        cls: "mediavault-trakt-code",
      });
      const copyBtn = codeRow.createEl("button", {
        cls: "clickable-icon mediavault-trakt-code-copy",
      });
      setIcon(copyBtn, "copy");
      copyBtn.setAttr("aria-label", t("settings.copyCode"));
      copyBtn.addEventListener("click", () => {
        void this.copyDeviceCode(device.userCode);
      });
      statusEl.createEl("p", {
        text: t("settings.waitingForApproval"),
        cls: "mediavault-trakt-auth-waiting",
      });

      this.startPolling(
        settings.traktClientId,
        settings.traktClientSecret,
        device,
        statusEl,
      );
    } catch (err) {
      statusEl.setText(
        t("settings.failedToStartAuth", { error: (err as Error).message }),
      );
    }
  }

  private async copyDeviceCode(userCode: string): Promise<void> {
    if (!navigator.clipboard?.writeText) {
      new Notice(t("settings.errorPrefix", { error: t("settings.copyCode") }));
      return;
    }

    try {
      await navigator.clipboard.writeText(userCode);
      new Notice(t("settings.codeCopied"));
    } catch {
      new Notice(t("settings.errorPrefix", { error: t("settings.copyCode") }));
    }
  }

  private startPolling(
    clientId: string,
    clientSecret: string,
    device: Awaited<ReturnType<typeof requestDeviceCode>>,
    statusEl: HTMLElement,
  ): void {
    const deadline = Date.now() + device.expiresIn * 1000;

    const poll = async () => {
      if (this.cancelled) return;
      if (Date.now() > deadline) {
        statusEl.createEl("p", {
          text: t("settings.codeExpired"),
          cls: "mediavault-trakt-auth-error",
        });
        return;
      }

      try {
        const result = await pollDeviceToken(
          clientId,
          clientSecret,
          device.deviceCode,
        );

        if (result.status === "pending") {
          this.pollTimer = window.setTimeout(() => {
            void poll();
          }, device.interval * 1000);
          return;
        }

        if (result.status === "approved") {
          await this.storage.settings.update({
            traktAccessToken: result.token.accessToken,
            traktRefreshToken: result.token.refreshToken,
            traktTokenExpiresAt:
              Date.now() + result.token.expiresInSeconds * 1000,
          });
          new Notice(t("settings.traktConnectedNotice"));
          this.onConnected?.();
          this.close();
          return;
        }

        if (result.status === "denied") {
          statusEl.createEl("p", {
            text: t("settings.authDenied"),
            cls: "mediavault-trakt-auth-error",
          });
          return;
        }

        if (result.status === "expired") {
          statusEl.createEl("p", {
            text: t("settings.codeExpired"),
            cls: "mediavault-trakt-auth-error",
          });
          return;
        }
      } catch (err) {
        statusEl.createEl("p", {
          text: t("settings.errorPrefix", { error: (err as Error).message }),
          cls: "mediavault-trakt-auth-error",
        });
      }
    };

    void poll();
  }

  onClose(): void {
    this.cancelled = true;
    if (this.pollTimer) window.clearTimeout(this.pollTimer);
    this.contentEl.empty();
  }
}
