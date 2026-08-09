import { setIcon } from "obsidian";
import { t } from "../../i18n";

export function makeClearable(
  input: HTMLInputElement | HTMLTextAreaElement,
): HTMLElement {
  const parent = input.parentElement;
  const wrapper = createDiv();
  wrapper.className = input.className;
  wrapper.addClass("mediavault-clearable-wrap");
  if (input.tagName === "TEXTAREA") {
    wrapper.addClass("mediavault-clearable-wrap-textarea");
  }

  input.className = "mediavault-clearable-field";

  parent?.insertBefore(wrapper, input);
  wrapper.appendChild(input);

  const clearBtn = wrapper.createDiv({ cls: "mediavault-clearable-clear" });
  setIcon(clearBtn, "x");
  clearBtn.setAttribute("aria-label", t("common.clearInput"));
  clearBtn.setAttribute("role", "button");
  clearBtn.tabIndex = -1;

  const sync = (): void => {
    wrapper.toggleClass("has-value", input.value.length > 0);
  };
  input.addEventListener("input", sync);
  sync();

  clearBtn.addEventListener("mousedown", (evt) => evt.preventDefault());
  clearBtn.addEventListener("click", (evt) => {
    evt.stopPropagation();
    if (!input.value) return;
    input.value = "";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    sync();
    input.focus();
  });

  return wrapper;
}
