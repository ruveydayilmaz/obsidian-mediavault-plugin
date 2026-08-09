import { Modal, setIcon } from "obsidian";
import { t } from "../../i18n";

function removeCloseButton(modal: Modal): void {
  modal.modalEl.querySelector(".modal-header-button")?.remove();
}

function markMediaVaultModalShell(modal: Modal): void {
  modal.modalEl.addClass("mediavault-modal-shell");

  removeCloseButton(modal);

  if (modal.modalEl.dataset.mediavaultCloseObserved === "1") return;
  modal.modalEl.dataset.mediavaultCloseObserved = "1";

  const observer = new MutationObserver(() => removeCloseButton(modal));
  observer.observe(modal.modalEl, { childList: true, subtree: true });

  const originalOnClose = modal.onClose?.bind(modal);
  modal.onClose = (): void => {
    observer.disconnect();
    originalOnClose?.();
  };
}

export function renderMobileBackButton(
  modal: Modal,
  container: HTMLElement,
  onBack?: () => void,
): void {
  markMediaVaultModalShell(modal);
  const btn = container.createDiv({ cls: "mediavault-modal-back" });
  setIcon(btn, "arrow-left");
  btn.setAttribute("aria-label", t("common.back"));
  btn.setAttribute("role", "button");
  btn.addEventListener("click", (evt) => {
    evt.stopPropagation();
    if (onBack) {
      onBack();
    } else {
      modal.close();
    }
  });
}

export function renderInlineBackButton(
  modal: Modal,
  container: HTMLElement,
): HTMLElement {
  markMediaVaultModalShell(modal);
  const btn = container.createDiv({
    cls: "mediavault-modal-back mediavault-modal-back-inline",
  });
  setIcon(btn, "arrow-left");
  btn.setAttribute("aria-label", t("common.back"));
  btn.setAttribute("role", "button");
  btn.addEventListener("click", (evt) => {
    evt.stopPropagation();
    modal.close();
  });
  return btn;
}

export function renderModalHeader(
  modal: Modal,
  container: HTMLElement,
  title: string,
  headingLevel: "h2" | "h3" = "h2",
): HTMLElement {
  markMediaVaultModalShell(modal);
  const row = container.createDiv({ cls: "mediavault-modal-header-row" });
  const btn = row.createDiv({ cls: "mediavault-modal-back" });
  setIcon(btn, "arrow-left");
  btn.setAttribute("aria-label", t("common.back"));
  btn.setAttribute("role", "button");
  btn.addEventListener("click", (evt) => {
    evt.stopPropagation();
    modal.close();
  });
  row.createEl(headingLevel, {
    cls: "mediavault-modal-header-title",
    text: title,
  });
  return row;
}
