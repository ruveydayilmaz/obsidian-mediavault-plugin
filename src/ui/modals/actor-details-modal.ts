import { App, Modal, Notice } from "obsidian";
import { renderModalHeader } from "./modal-chrome";
import type { StorageService } from "../../services/storage";
import type { TMDBService } from "../../api/tmdb";
import { TMDBFilmographyItem, TMDBPersonDetails } from "../../types/tmdb";
import { MediaType } from "../../types/enums";
import { tmdbImageUrl } from "../../api/tmdb-normalize";
import { CREW_ROLE_JOBS } from "../../api/tmdb-normalize";
import { buildMediaItemFromTMDB } from "../../services/media-import";
import { MediaDetailModal } from "./media-detail-modal";
import { t } from "../../i18n";
import { renderExpandableText } from "../components/expandable-text";

type FilmographyCategory = TMDBFilmographyItem["category"];

export interface ActorDetailsCrewFilter {
  roles: string[];
}

const LARGE_FILMOGRAPHY_THRESHOLD = 30;

const DEPARTMENT_PRIORITY = [
  "Directing",
  "Writing",
  "Production",
  "Acting",
  "Camera",
  "Editing",
  "Sound",
  "Art",
  "Costume & Make-Up",
  "Visual Effects",
  "Lighting",
  "Crew",
];

function departmentLabel(department: string): string {
  const key = `detail.department${department.replace(/[^A-Za-z]/g, "")}`;
  const translated = t(key);

  return translated === key ? department : translated;
}

function getCategoryTabs(): { id: FilmographyCategory; label: string }[] {
  return [
    { id: "tv_series", label: t("detail.tvSeries") },
    { id: "tv_program", label: t("detail.tvPrograms") },
    { id: "movie", label: t("detail.movies") },
  ];
}

function crewRoleLabel(role: string): string {
  switch (role) {
    case "Director":
      return t("detail.roleDirector");
    case "Writer":
      return t("detail.roleWriter");
    case "Producer":
      return t("detail.roleProducer");
    default:
      return role;
  }
}

export class ActorDetailsModal extends Modal {
  private storage: StorageService;
  private tmdb: TMDBService;
  private personId: number;
  private crewFilter: ActorDetailsCrewFilter | null;

  private person: TMDBPersonDetails | null = null;
  private biographyExpanded = false;
  private activeCategory: FilmographyCategory | null = null;
  private activeDepartmentByCategory: Partial<
    Record<FilmographyCategory, string>
  > = {};
  private visibleCountByKey: Map<string, number> = new Map();

  private categoryTabBarEl!: HTMLElement;
  private filmographyHeadingDiv!: HTMLElement;
  private gridEl!: HTMLElement;

  constructor(
    app: App,
    storage: StorageService,
    tmdb: TMDBService,
    personId: number,
    crewFilter?: ActorDetailsCrewFilter,
  ) {
    super(app);
    this.storage = storage;
    this.tmdb = tmdb;
    this.personId = personId;
    this.crewFilter = crewFilter ?? null;
  }

  async onOpen(): Promise<void> {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("mediavault-detail-modal");
    contentEl.addClass("mediavault-actor-modal");
    const headerRow = renderModalHeader(this, contentEl, "Crew Member");

    const loading = contentEl.createDiv({
      cls: "mediavault-modal-hint",
      text: t("detail.loadingActorDetails"),
    });
    try {
      this.person = await this.tmdb.getPersonDetails(this.personId);
    } catch (err) {
      loading.setText(
        t("detail.couldNotLoadItem", {
          title: "actor",
          error: (err as Error).message,
        }),
      );
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
        ".mediavault-actor-header, .mediavault-actor-filmography-heading-div, .mediavault-detail-tabs, .mediavault-actor-filmography-grid, .mediavault-actor-filmography-groups, .mediavault-modal-hint",
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

    if (this.person.alsoKnownAs.length > 0) {
      const akaRow = info.createDiv({
        cls: "mediavault-actor-original-name",
      });
      akaRow.createSpan({
        cls: "mediavault-actor-original-name-label",
        text: t("detail.alsoKnownAs"),
      });
      akaRow.createSpan({
        cls: "mediavault-actor-original-name-value",
        text: this.person.alsoKnownAs.join(", "),
      });
    }

    if (this.person.knownForDepartment) {
      const knownForRow = info.createDiv({
        cls: "mediavault-actor-original-name",
      });
      knownForRow.createSpan({
        cls: "mediavault-actor-original-name-label",
        text: t("detail.knownFor"),
      });
      knownForRow.createSpan({
        cls: "mediavault-actor-original-name-value",
        text: departmentLabel(this.person.knownForDepartment),
      });
    }

    if (this.person.imdbId) {
      const imdbLink = info.createEl("a", {
        cls: "mediavault-actor-imdb-link",
        text: t("detail.viewOnImdb"),
        href: `https://www.imdb.com/name/${this.person.imdbId}/`,
      });
      imdbLink.setAttr("target", "_blank");
      imdbLink.setAttr("rel", "noopener");
    }

    if (this.person.biography) {
      renderExpandableText(
        header,
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

    if (this.activeCategory === null) {
      this.activeCategory =
        getCategoryTabs().find(
          (tab) => this.creditsForCategory(tab.id).length > 0,
        )?.id ?? "movie";
    }

    this.filmographyHeadingDiv = contentEl.createDiv({
      cls: "mediavault-actor-filmography-heading-div",
    });

    this.filmographyHeadingDiv.createEl("h3", {
      cls: "mediavault-actor-filmography-heading",
      text: t("detail.filmography"),
    });

    this.renderDepartmentTabBar(this.filmographyHeadingDiv);

    if (this.filteredCredits().length === 0) {
      contentEl.createDiv({
        cls: "mediavault-modal-hint",
        text: t("detail.noFilmography"),
      });
      return;
    }

    this.categoryTabBarEl = contentEl.createDiv({
      cls: "mediavault-detail-tabs",
    });

    this.gridEl = contentEl.createDiv({
      cls: "mediavault-actor-filmography-grid",
    });

    this.renderCategoryTabBar();
    this.renderGrid();
  }

  private filteredCredits(): TMDBFilmographyItem[] {
    const all = this.person?.credits ?? [];
    if (!this.crewFilter) return all;
    const jobs = new Set(
      this.crewFilter.roles.flatMap((role) => CREW_ROLE_JOBS[role] ?? []),
    );
    return all.filter(
      (item) =>
        item.department !== "Acting" && item.jobs.some((job) => jobs.has(job)),
    );
  }

  private creditsForCategory(
    category: FilmographyCategory,
  ): TMDBFilmographyItem[] {
    return this.filteredCredits().filter((item) => item.category === category);
  }

  private departmentsForCategory(category: FilmographyCategory): string[] {
    const present = new Set(
      this.creditsForCategory(category).map((item) => item.department),
    );
    const known = DEPARTMENT_PRIORITY.filter((d) => present.has(d));
    const rest = [...present]
      .filter((d) => !DEPARTMENT_PRIORITY.includes(d))
      .sort((a, b) => a.localeCompare(b));
    return [...known, ...rest];
  }

  private creditsForDepartment(
    category: FilmographyCategory,
    department: string,
  ): TMDBFilmographyItem[] {
    return this.creditsForCategory(category).filter(
      (item) => item.department === department,
    );
  }

  private renderCategoryTabBar(): void {
    this.categoryTabBarEl.empty();

    getCategoryTabs().forEach((tab) => {
      const count = this.creditsForCategory(tab.id).length;

      const btn = this.categoryTabBarEl.createEl("button", {
        cls:
          "mediavault-detail-tab" +
          (this.activeCategory === tab.id ? " is-active" : ""),
        text: count > 0 ? `${tab.label} (${count})` : tab.label,
      });

      btn.disabled = count === 0;

      btn.addEventListener("click", () => {
        if (this.activeCategory === tab.id) return;

        this.activeCategory = tab.id;

        this.renderCategoryTabBar();
        this.renderDepartmentTabBar(this.filmographyHeadingDiv);
        this.renderGrid();
      });
    });
  }

  private activeDepartment(): string | null {
    if (!this.activeCategory) return null;
    const departments = this.departmentsForCategory(this.activeCategory);
    if (departments.length === 0) return null;

    const remembered = this.activeDepartmentByCategory[this.activeCategory];
    if (remembered && departments.includes(remembered)) return remembered;

    const preferred = this.person?.knownForDepartment;
    const initial =
      preferred && departments.includes(preferred) ? preferred : departments[0];
    this.activeDepartmentByCategory[this.activeCategory] = initial;
    return initial;
  }

  private renderDepartmentTabBar(headingDiv: HTMLElement): void {
    headingDiv.querySelector(".mediavault-actor-department-select")?.remove();

    if (!this.activeCategory) return;

    const departments = this.departmentsForCategory(this.activeCategory);
    const totalCount = this.creditsForCategory(this.activeCategory).length;
    if (departments.length <= 1 && totalCount < LARGE_FILMOGRAPHY_THRESHOLD) {
      return;
    }

    const current = this.activeDepartment();
    const activeCategory = this.activeCategory;

    const select = headingDiv.createEl("select", {
      cls: "mediavault-actor-department-select",
    });

    departments.forEach((department) => {
      const count = this.creditsForDepartment(
        activeCategory,
        department,
      ).length;

      select.createEl("option", {
        value: department,
        text: `${departmentLabel(department)} (${count})`,
      });
    });

    if (current) select.value = current;

    select.addEventListener("change", () => {
      if (!this.activeCategory) return;

      this.activeDepartmentByCategory[this.activeCategory] = select.value;
      this.renderGrid();
    });
  }

  private renderGrid(): void {
    this.gridEl.empty();
    if (!this.activeCategory) return;
    const department = this.activeDepartment();
    if (!department) return;
    this.renderFilmographyPage(
      this.creditsForDepartment(this.activeCategory, department),
      `${this.activeCategory}:${department}`,
    );
  }

  private renderFilmographyPage(
    items: TMDBFilmographyItem[],
    key: string,
  ): void {
    const visibleCount = this.visibleCountByKey.get(key) ?? 30;
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
        this.visibleCountByKey.set(key, visibleCount + 30);
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
    } else if (item.jobs.length > 0) {
      info.createDiv({
        cls: "mediavault-detail-meta",
        text: item.jobs.map((job) => this.jobDisplayLabel(job)).join(" · "),
      });
    }

    card.addEventListener("click", () => void this.openFilmographyItem(item));
  }

  private jobDisplayLabel(job: string): string {
    for (const [role, jobs] of Object.entries(CREW_ROLE_JOBS)) {
      if (jobs.includes(job) && job === role) return crewRoleLabel(role);
    }
    return job;
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
