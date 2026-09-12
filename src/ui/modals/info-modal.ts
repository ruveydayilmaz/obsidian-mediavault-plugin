import { App, Modal } from "obsidian";
import { renderModalHeader } from "./modal-chrome";

export class InfoModal extends Modal {
  constructor(
    app: App,
    private title: string,
    private message: string,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("mediavault-info-modal");
    renderModalHeader(this, contentEl, this.title, "h3");
    contentEl.createEl("p", { text: this.message });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
