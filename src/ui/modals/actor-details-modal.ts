import { App, Modal, Notice } from "obsidian";
import { renderModalHeader } from "./modal-chrome";
import type { StorageService } from "../../services/storage";
import type { TMDBService } from "../../api/tmdb";
import { TMDBFilmographyItem, TMDBPersonDetails } from "../../types/tmdb";
import { MediaType } from "../../types/enums";
import { tmdbImageUrl } from "../../api/tmdb-normalize";
import { buildMediaItemFromTMDB } from "../../services/media-import";
import { MediaDetailModal } from "./media-detail-modal";
import { t } from "../../i18n";
import { renderExpandableText } from "../components/expandable-text";

type FilmographyCategory = TMDBFilmographyItem["category"];

function getCategoryTabs(): { id: FilmographyCategory; label: string }[] {
  return [
    { id: "tv_series", label: t("detail.tvSeries") },
    { id: "tv_program", label: t("detail.tvPrograms") },
    { id: "movie", label: t("detail.movies") },
  ];
}

export class ActorDetailsModal extends Modal {
  private storage: StorageService;
  private tmdb: TMDBService;
  private personId: number;

  private person: TMDBPersonDetails | null = null;
  private biographyExpanded = false;
  private activeTab: FilmographyCategory | null = null;
  private visibleCountByTab: Record<FilmographyCategory, number> = {
    tv_series: 30,
    tv_program: 30,
    movie: 30,
  };

  private tabBarEl!: HTMLElement;
  private gridEl!: HTMLElement;

  constructor(
    app: App,
    storage: StorageService,
    tmdb: TMDBService,
    personId: number,
  ) {
    super(app);
    this.storage = storage;
    this.tmdb = tmdb;
    this.personId = personId;
  }

  async onOpen(): Promise<void> {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("mediavault-detail-modal");
    contentEl.addClass("mediavault-actor-modal");
    const headerRow = renderModalHeader(this, contentEl, "Actor");

    const loading = contentEl.createDiv({
      cls: "mediavault-modal-hint",
      text: t("detail.loadingActorDetails"),
    });
    try {
      this.person = await this.tmdb.getPersonDetails(this.personId);
    } catch (err) {
      loading.setText(t("detail.couldNotLoadItem", { title: "actor", error: (err as Error).message }));
      return;
    }
    loading.remove();
    headerRow
      .querySelector<HTMLElement>(".mediavault-modal-header-title")
      ?.setText(this.person.name);

    this.render(contentEl);
  }

  private render(contentEl: HTMLElement): void {
    if (!this.person) return;
    contentEl
      .querySelectorAll(
        ".mediavault-actor-header, .mediavault-actor-filmography-heading, .mediavault-detail-tabs, .mediavault-actor-filmography-grid, .mediavault-modal-hint",
      )
      .forEach((el) => el.remove());

    const header = contentEl.createDiv({ cls: "mediavault-actor-header" });
    const photoUrl = tmdbImageUrl(this.person.profilePath, "w342");
    if (photoUrl) {
      header.createEl("img", {
        cls: "mediavault-actor-photo",
        attr: { src: photoUrl, alt: this.person.name },
      });
    }
    const info = header.createDiv({ cls: "mediavault-actor-info" });
    info.createEl("h2", {
      cls: "mediavault-actor-name",
      text: this.person.name,
    });

    const dateParts: string[] = [];
    if (this.person.birthday) {
      dateParts.push(
        this.person.deathday
          ? `Born ${this.person.birthday} · Died ${this.person.deathday}`
          : `Born ${this.person.birthday}`,
      );
    } else if (this.person.deathday) {
      dateParts.push(`Died ${this.person.deathday}`);
    }
    if (this.person.placeOfBirth) {
      dateParts.push(this.person.placeOfBirth);
    }
    if (dateParts.length > 0) {
      info.createDiv({
        cls: "mediavault-actor-dates",
        text: dateParts.join(" · "),
      });
    }

    if (this.person.originalName) {
      const originalNameRow = info.createDiv({
        cls: "mediavault-actor-original-name",
      });
      originalNameRow.createSpan({
        cls: "mediavault-actor-original-name-label",
        text: t("detail.originalName"),
      });
      originalNameRow.createSpan({
        cls: "mediavault-actor-original-name-value",
        text: this.person.originalName,
      });
    }

    if (this.person.biography) {
      renderExpandableText(
        info,
        this.person.biography,
        this.biographyExpanded,
        () => {
          this.biographyExpanded = !this.biographyExpanded;
          this.render(contentEl);
        },
        {
          wrapperCls: "mediavault-actor-biography",
          textCls: "mediavault-actor-biography-text",
          maxLength: 300,
          sentenceAware: true,
        },
      );
    }

    contentEl.createEl("h3", {
      cls: "mediavault-actor-filmography-heading",
      text: t("detail.filmography"),
    });

    if (this.person.filmography.length === 0) {
      contentEl.createDiv({
        cls: "mediavault-modal-hint",
        text: t("detail.noFilmography"),
      });
      return;
    }

    this.tabBarEl = contentEl.createDiv({ cls: "mediavault-detail-tabs" });
    this.gridEl = contentEl.createDiv({
      cls: "mediavault-actor-filmography-grid",
    });

    if (this.activeTab === null) {
      this.activeTab =
        getCategoryTabs().find((tab) => this.itemsForTab(tab.id).length > 0)
          ?.id ?? "movie";
    }

    this.renderTabBar();
    this.renderGrid();
  }

  private itemsForTab(category: FilmographyCategory): TMDBFilmographyItem[] {
    return (
      this.person?.filmography.filter((item) => item.category === category) ??
      []
    );
  }

  private renderTabBar(): void {
    this.tabBarEl.empty();
    getCategoryTabs().forEach((tab) => {
      const count = this.itemsForTab(tab.id).length;
      const btn = this.tabBarEl.createEl("button", {
        cls:
          "mediavault-detail-tab" +
          (this.activeTab === tab.id ? " is-active" : ""),
        text: count > 0 ? `${tab.label} (${count})` : tab.label,
      });
      btn.disabled = count === 0;
      btn.addEventListener("click", () => {
        if (this.activeTab === tab.id) return;
        this.activeTab = tab.id;
        this.renderTabBar();
        this.renderGrid();
      });
    });
  }

  private renderGrid(): void {
    this.gridEl.empty();
    if (!this.activeTab) return;
    this.renderFilmographyPage(this.itemsForTab(this.activeTab));
  }

  private renderFilmographyPage(items: TMDBFilmographyItem[]): void {
    const activeTab = this.activeTab as FilmographyCategory;
    const visibleCount = this.visibleCountByTab[activeTab];
    const page = items.slice(0, visibleCount);
    page.forEach((item) => this.renderFilmographyCard(this.gridEl, item));

    if (items.length > visibleCount) {
      const moreBtn = this.gridEl.createEl("button", {
        cls: "mediavault-actor-load-more",
        text: t("detail.loadMoreRemaining", {
          count: items.length - visibleCount,
        }),
      });
      moreBtn.addEventListener("click", () => {
        this.visibleCountByTab[activeTab] += 30;
        this.renderGrid();
      });
    }
  }

  private renderFilmographyCard(
    grid: HTMLElement,
    item: TMDBFilmographyItem,
  ): void {
    const card = grid.createDiv({ cls: "mediavault-actor-film-card" });
    const posterUrl = tmdbImageUrl(item.posterPath, "w200");
    const poster = card.createDiv({ cls: "mediavault-card-poster" });
    if (posterUrl) {
      poster.createEl("img", {
        attr: { src: posterUrl, alt: item.title, loading: "lazy" },
      });
    } else {
      poster.setText("🎬");
    }
    const info = card.createDiv({ cls: "mediavault-actor-film-info" });
    info.createDiv({
      cls: "mediavault-actor-film-title",
      text: item.year ? `${item.title} (${item.year})` : item.title,
    });
    if (item.character) {
      info.createDiv({
        cls: "mediavault-detail-meta",
        text: t("detail.asCharacter", { character: item.character }),
      });
    }

    card.addEventListener("click", () => void this.openFilmographyItem(item));
  }

  private async openFilmographyItem(item: TMDBFilmographyItem): Promise<void> {
    const mediaKind = item.mediaKind === "movie" ? "movie" : "tv";
    const mediaType =
      mediaKind === "movie" ? MediaType.Movie : MediaType.TVShow;

    const existing = await this.storage.media.findByTmdbId(
      item.tmdbId,
      mediaType,
    );
    if (existing) {
      new MediaDetailModal(this.app, this.storage, this.tmdb, existing).open();
      return;
    }

    try {
      const details =
        mediaKind === "movie"
          ? await this.tmdb.getMovie(item.tmdbId)
          : await this.tmdb.getTV(item.tmdbId);
      const previewMedia = buildMediaItemFromTMDB(details);
      new MediaDetailModal(
        this.app,
        this.storage,
        this.tmdb,
        previewMedia,
        undefined,
        undefined,
        "cast",
        undefined,
        undefined,
        true,
        details.tmdbRating,
      ).open();
    } catch (err) {
      new Notice(
        t("detail.couldNotLoadItem", {
          title: item.title,
          error: (err as Error).message,
        }),
      );
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
