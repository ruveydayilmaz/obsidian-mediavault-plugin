import { t } from "i18n/i18n-service";
import { Menu } from "obsidian";

export function addDestructiveMenuItem(
  menu: Menu,
  evt: MouseEvent,
  options: {
    label: string;
    confirmLabel?: string;
    icon?: string;
    confirmIcon?: string;
    confirming: boolean;
    rebuild: (menu: Menu, confirming: boolean) => void;
    onConfirm: () => void;
  },
): void {
  menu.addItem((item) => {
    item.setTitle(
      options.confirming
        ? (options.confirmLabel ?? t("common.confirmWithLabel", { label: options.label }))
        : options.label,
    );
    item.setIcon(
      options.confirming
        ? (options.confirmIcon ?? "alert-triangle")
        : (options.icon ?? "trash"),
    );

    const dom = (item as unknown as { dom?: HTMLElement }).dom;
    dom?.addClass("mediavault-menu-item-destructive");
    if (options.confirming) dom?.addClass("is-confirming");

    item.onClick(() => {
      if (options.confirming) {
        options.onConfirm();
      } else {
        const reopened = new Menu();
        options.rebuild(reopened, true);
        reopened.showAtMouseEvent(evt);
      }
    });
  });
}
