import { App, Modal } from "obsidian";
import { renderModalHeader } from "./modal-chrome";
import type { StorageService } from "../../services/storage";
import { MediaStatus } from "../../types/enums";
import { statusLabel } from "../components/media-render";
import { t } from "../../i18n";

const SELECTABLE_STATUSES: MediaStatus[] = [
  MediaStatus.PlanToWatch,
  MediaStatus.Watching,
  MediaStatus.OnHold,
  // MediaStatus.WatchLater,
  MediaStatus.Completed,
  MediaStatus.WaitingForNewSeason,
  MediaStatus.UpToDate,
  MediaStatus.Dropped,
];

export class ChangeStatusModal extends Modal {
  constructor(
    app: App,
    private storage: StorageService,
    private mediaId: string,
    private currentStatus: MediaStatus,
    private onChanged: () => void,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("mediavault-change-status-modal");
    renderModalHeader(this, contentEl, t("detail.changeStatusTitle"), "h3");

    const list = contentEl.createDiv({
      cls: "mediavault-change-status-list",
    });

    SELECTABLE_STATUSES.forEach((status) => {
      const row = list.createDiv({
        cls: `mediavault-change-status-row ${
          status === this.currentStatus ? "is-selected" : ""
        }`,
      });
      row.setAttr("tabindex", "0");
      row.setAttr("role", "button");
      row.createSpan({ text: statusLabel(status) });
      if (status === this.currentStatus) {
        row.createSpan({
          cls: "mediavault-change-status-current-badge",
          text: t("common.currentBadge"),
        });
      }
      const select = (): void => {
        if (status !== this.currentStatus) {
          void this.storage.media
            .update(this.mediaId, { status })
            .then(() => {
              this.onChanged();
            });
        }
        this.close();
      };
      row.addEventListener("click", select);
      row.addEventListener("keydown", (evt: KeyboardEvent) => {
        if (evt.key === "Enter" || evt.key === " ") {
          evt.preventDefault();
          select();
        }
      });
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
