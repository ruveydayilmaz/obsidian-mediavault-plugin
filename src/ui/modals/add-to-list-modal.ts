import { App, Modal, Notice } from "obsidian";
import { renderModalHeader } from "./modal-chrome";
import { confirmDialog } from "./confirm-modal";
import type { StorageService } from "../../services/storage";
import { MediaItem } from "../../models/media";
import { t } from "../../i18n";
import { makeClearable } from "../components/clearable-input";
import { renderListCard, updateListCardBanner } from "../components/list-card";

export class AddToListModal extends Modal {
  private storage: StorageService;
  private media: MediaItem;
  private onChanged?: () => void;

  constructor(
    app: App,
    storage: StorageService,
    media: MediaItem,
    onChanged?: () => void,
  ) {
    super(app);
    this.storage = storage;
    this.media = media;
    this.onChanged = onChanged;
  }

  onOpen(): void {
    void this.render();
  }

  private async createAndAddList(input: HTMLInputElement): Promise<void> {
    const title = input.value.trim();

    if (!title) {
      new Notice(t("notice.enterListName"));
      return;
    }

    const list = await this.storage.customLists.create({ title });
    await this.storage.customLists.addMedia(list.id, this.media.id);
    this.onChanged?.();
    await this.render();
  }

  private async render(): Promise<void> {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("mediavault-add-to-list-modal");
    renderModalHeader(this, contentEl, t("addToList.addToListTitle"), "h3");

    const [lists, allMedia] = await Promise.all([
      this.storage.customLists.getAll(),
      this.storage.media.getAll(),
    ]);
    const listEl = contentEl.createDiv({
      cls: "mediavault-add-to-list-options mediavault-lists-grid",
    });

    if (lists.length === 0) {
      listEl.createEl("p", {
        cls: "mediavault-empty-state",
        text: t("addToList.noListsYet"),
      });
    }

    for (const list of lists) {
      const alreadyIn = list.mediaIds.includes(this.media.id);
      renderListCard(
        listEl,
        list,
        allMedia,
        (cardEl) => {
          void (async () => {
            const isSelected = cardEl.hasClass("is-selected");

            if (isSelected) {
              const confirmed = await confirmDialog(
                this.app,
                t("addToList.removeConfirm", {
                  title: this.media.title,
                  list: list.title,
                }),
              );
              if (!confirmed) return;
              void this.storage.customLists
                .removeMedia(list.id, this.media.id)
                .then((updated) => {
                  this.onChanged?.();
                  cardEl.removeClass("is-selected");
                  if (updated) {
                    updateListCardBanner(cardEl, updated, allMedia);
                  }
                });
              return;
            }

            void this.storage.customLists
              .addMedia(list.id, this.media.id)
              .then((updated) => {
                this.onChanged?.();
                cardEl.addClass("is-selected");
                cardEl.addClass("is-added-flash");
                window.setTimeout(() => {
                  cardEl.removeClass("is-added-flash");
                }, 900);
                if (updated) {
                  updateListCardBanner(cardEl, updated, allMedia);
                }
              });
          })();
        },
        { selected: alreadyIn },
      );
    }

    const createRow = contentEl.createDiv({
      cls: "mediavault-add-to-list-create-row",
    });
    const newListInput = createRow.createEl("input", {
      type: "text",
      attr: { placeholder: t("addToList.newListPlaceholder") },
    });
    makeClearable(newListInput);
    const createBtn = createRow.createEl("button", {
      text: t("addToList.createAndAdd"),
      cls: "mod-cta",
    });
    createBtn.addEventListener("click", () => {
      void this.createAndAddList(newListInput);
    });
  }
}
