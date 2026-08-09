import { t } from "../../i18n";

const SHORT_LENGTH = 220;

const SENTENCE_SEARCH_WINDOW = 200;

function sliceAtSentenceBoundary(fullText: string, target: number): string | null {
  const searchEnd = Math.min(fullText.length, target + SENTENCE_SEARCH_WINDOW);
  const terminatorRe = /[.!?]["'”’)]?(?:\s|$)/g;
  terminatorRe.lastIndex = 0;

  let match: RegExpExecArray | null;
  let best: number | null = null;
  while ((match = terminatorRe.exec(fullText)) !== null) {
    const endIdx = match.index + match[0].trimEnd().length;
    if (endIdx >= target) {
      best = endIdx;
      break;
    }
    if (match.index >= searchEnd) break;
  }

  if (best === null || best > searchEnd) return null;
  return fullText.slice(0, best).trimEnd();
}

export function renderExpandableText(
  container: HTMLElement,
  fullText: string,
  expanded: boolean,
  onToggle: () => void,
  opts?: {
    wrapperCls?: string;
    textCls?: string;
    maxLength?: number;
    sentenceAware?: boolean;
  },
): HTMLElement {
  const wrapper = container.createDiv({
    cls: opts?.wrapperCls ?? "mediavault-detail-description",
  });

  const textEl = wrapper.createEl("p", {
    cls: opts?.textCls ?? "mediavault-detail-synopsis",
  });

  const maxLength = opts?.maxLength ?? SHORT_LENGTH;
  const needsToggle = fullText.length > maxLength;

  let text = fullText;
  if (needsToggle && !expanded) {
    const sentenceSliced = opts?.sentenceAware
      ? sliceAtSentenceBoundary(fullText, maxLength)
      : null;
    text = sentenceSliced ?? fullText.slice(0, maxLength).trimEnd() + "...";
  }

  textEl.appendText(text);

  if (!needsToggle) return wrapper;

  const toggle = textEl.createSpan({
    cls: "mediavault-detail-description-toggle",
    text: expanded ? ` ${t("common.showLess")}` : ` ${t("common.showMore")}`,
  });

  toggle.addEventListener("click", (evt) => {
    evt.stopPropagation();
    onToggle();
  });

  return wrapper;
}
