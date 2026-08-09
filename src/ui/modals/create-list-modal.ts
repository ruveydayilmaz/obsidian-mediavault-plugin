import { App, Modal, Notice } from "obsidian";
import { renderModalHeader } from "./modal-chrome";
import type { StorageService } from "../../services/storage";
import { CustomList } from "../../models/list";
import { t } from "../../i18n";
import { makeClearable } from "../components/clearable-input";

export class CreateListModal extends Modal {
  private storage: StorageService;
  private onCreated: (list: CustomList) => void;

  constructor(
    app: App,
    storage: StorageService,
    onCreated: (list: CustomList) => void,
  ) {
    super(app);
    this.storage = storage;
    this.onCreated = onCreated;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass("mediavault-create-list-modal");
    renderModalHeader(this, contentEl, t("createList.newList"), "h3");

    const titleInput = contentEl.createEl("input", {
      type: "text",
      attr: { placeholder: t("createList.titlePlaceholder") },
    });
    makeClearable(titleInput);
    const descInput = contentEl.createEl("textarea", {
      attr: { placeholder: t("createList.descPlaceholder") },
    });
    makeClearable(descInput);

    const createBtn = contentEl.createEl("button", {
      text: t("common.create"),
      cls: "mod-cta",
    });
    createBtn.addEventListener("click", () => {
      void (async () => {
        const title = titleInput.value.trim();

        if (!title) {
          new Notice(t("notice.enterListName"));
          return;
        }

        const list = await this.storage.customLists.create({
          title,
          description: descInput.value.trim() || null,
        });

        this.onCreated(list);
        this.close();
      })();
    });

    titleInput.addEventListener("keydown", (evt) => {
      if (evt.key === "Enter") createBtn.click();
    });
  }
}
