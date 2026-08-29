import { App } from "obsidian";
import type { StorageService } from "../../services/storage";
import type { TMDBService } from "../../api/tmdb";
import { tmdbImageUrl } from "../../api/tmdb-normalize";
import { TMDBPersonSearchResult } from "../../types/tmdb";
import { ActorDetailsModal } from "../modals/actor-details-modal";

export interface PersonCardDeps {
  app: App;
  storage: StorageService;
  tmdb: TMDBService;
}

export function renderPersonCard(
  container: HTMLElement,
  deps: PersonCardDeps,
  person: TMDBPersonSearchResult,
): void {
  const card = container.createDiv({ cls: "mediavault-card mediavault-person-card" });
  const photoUrl = tmdbImageUrl(person.profilePath, "w200");
  const photoEl = card.createDiv({ cls: "mediavault-card-poster mediavault-person-card-photo" });
  if (photoUrl) {
    photoEl.createEl("img", {
      attr: { src: photoUrl, alt: person.name, loading: "lazy" },
    });
  } else {
    photoEl.setText("👤");
  }

  const info = card.createDiv({ cls: "mediavault-person-card-info" });
  info.createDiv({ cls: "mediavault-person-card-name", text: person.name });
  if (person.knownForDepartment) {
    info.createDiv({
      cls: "mediavault-detail-meta",
      text: person.knownForDepartment,
    });
  }

  card.addEventListener("click", () => {
    new ActorDetailsModal(
      deps.app,
      deps.storage,
      deps.tmdb,
      person.tmdbPersonId,
    ).open();
  });
}
