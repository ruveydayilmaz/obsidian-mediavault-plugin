import { ItemView, WorkspaceLeaf } from "obsidian";
import type MediaVaultPlugin from "../../main";
import { VIEW_TYPE_LISTS } from "../../constants";
import { CustomList } from "../../models/list";
import { MediaItem } from "../../models/media";
import { renderListCard } from "../components/list-card";
import { CreateListModal } from "../modals/create-list-modal";
import { ListDetailModal } from "../modals/list-detail-modal";
import { t } from "../../i18n";

export class ListsView extends ItemView {
  private plugin: MediaVaultPlugin;
  private gridEl!: HTMLElement;
  private refreshToken = 0;

  constructor(leaf: WorkspaceLeaf, plugin: MediaVaultPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE_LISTS;
  }

  getDisplayText(): string {
    return t("lists.customLists");
  }

  getIcon(): string {
    return "list";
  }

  async onOpen(): Promise<void> {
    const root = this.containerEl.children[1] as HTMLElement;
    root.empty();
    root.addClass("mediavault-lists-root");

    const toolbar = root.createDiv({ cls: "mediavault-lists-toolbar" });
    toolbar.createEl("h2", { text: t("lists.customLists") });
    const newBtn = toolbar.createEl("button", {
      text: t("lists.newList"),
      cls: "mod-cta",
    });
    newBtn.addEventListener("click", () => {
      new CreateListModal(
        this.app,
        this.plugin.storage,
        () => void this.refresh(),
      ).open();
    });

    this.gridEl = root.createDiv({ cls: "mediavault-lists-grid" });

    await this.refresh();
  }

  async onClose(): Promise<void> {
    // Nothing to clean up
  }

  async refresh(): Promise<void> {
    const token = ++this.refreshToken;

    const [lists, allMedia] = await Promise.all([
      this.plugin.storage.customLists.getAll(),
      this.plugin.storage.media.getAll(),
    ]);

    if (token !== this.refreshToken) return;

    this.gridEl.empty();

    if (lists.length === 0) {
      this.gridEl.createEl("p", {
        cls: "mediavault-empty-state",
        text: t("lists.emptyState"),
      });
      return;
    }

    lists.forEach((list) => this.renderListCard(list, allMedia));
  }

  private renderListCard(list: CustomList, allMedia: MediaItem[]): void {
    renderListCard(this.gridEl, list, allMedia, () => {
      new ListDetailModal(this.app, this.plugin, list).open();
    });
  }
}
