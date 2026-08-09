import { App, Modal, Setting } from "obsidian";

export class ConfirmModal extends Modal {
  private resolved = false;

  constructor(
    app: App,
    private message: string,
    private onResolve: (confirmed: boolean) => void,
    private confirmText?: string,
    private cancelText?: string,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass("mediavault-confirm-modal");
    contentEl.createEl("p", { text: this.message });

    new Setting(contentEl)
      .addButton((btn) =>
        btn
          .setButtonText(this.cancelText ?? "Cancel")
          .onClick(() => {
            this.resolved = true;
            this.onResolve(false);
            this.close();
          }),
      )
      .addButton((btn) =>
        btn
          .setButtonText(this.confirmText ?? "Confirm")
          .setCta()
          .onClick(() => {
            this.resolved = true;
            this.onResolve(true);
            this.close();
          }),
      );
  }

  onClose(): void {
    this.contentEl.empty();
    if (!this.resolved) {
      this.resolved = true;
      this.onResolve(false);
    }
  }
}

export function confirmDialog(
  app: App,
  message: string,
  confirmText?: string,
  cancelText?: string,
): Promise<boolean> {
  return new Promise((resolve) => {
    new ConfirmModal(app, message, resolve, confirmText, cancelText).open();
  });
}

export class PromptModal extends Modal {
  private resolved = false;
  private value = "";

  constructor(
    app: App,
    private message: string,
    private onResolve: (value: string | null) => void,
    private defaultValue?: string,
    private placeholder?: string,
  ) {
    super(app);
    this.value = defaultValue ?? "";
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass("mediavault-prompt-modal");
    contentEl.createEl("p", { text: this.message });

    let inputEl: HTMLInputElement;
    new Setting(contentEl).addText((text) => {
      inputEl = text.inputEl;
      text.setValue(this.value);
      if (this.placeholder) text.setPlaceholder(this.placeholder);
      text.onChange((v) => (this.value = v));
      text.inputEl.addEventListener("keydown", (evt) => {
        if (evt.key === "Enter") {
          evt.preventDefault();
          this.submit();
        }
      });
    });

    new Setting(contentEl)
      .addButton((btn) =>
        btn.setButtonText("Cancel").onClick(() => {
          this.resolved = true;
          this.onResolve(null);
          this.close();
        }),
      )
      .addButton((btn) =>
        btn
          .setButtonText("OK")
          .setCta()
          .onClick(() => this.submit()),
      );

    window.setTimeout(() => inputEl?.focus(), 0);
  }

  private submit(): void {
    this.resolved = true;
    this.onResolve(this.value);
    this.close();
  }

  onClose(): void {
    this.contentEl.empty();
    if (!this.resolved) {
      this.resolved = true;
      this.onResolve(null);
    }
  }
}

export function promptDialog(
  app: App,
  message: string,
  defaultValue?: string,
  placeholder?: string,
): Promise<string | null> {
  return new Promise((resolve) => {
    new PromptModal(app, message, resolve, defaultValue, placeholder).open();
  });
}
