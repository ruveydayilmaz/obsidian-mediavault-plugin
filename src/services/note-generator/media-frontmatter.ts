import { MediaItem } from "../../models/media";
import { ComfortProfile } from "../../models/comfort";
import { FrontmatterData, serializeFrontmatter } from "./frontmatter";
import { MediaType } from "../../types/enums";

export function buildMediaFrontmatter(
  media: MediaItem,
  comfort: ComfortProfile | null,
): string {
  const data: FrontmatterData = {
    type: media.type === MediaType.Movie ? "movie" : "tv",
    title: media.title,
    year: media.year,
    tmdb_id: media.tmdbId,
    genres: media.genres,
    status: media.status,
    rating_avg: media.averageRating,
    watch_count: media.watchCount,
  };

  if (comfort) {
    data.comfort_score = comfort.comfortScore;
    data.energy_level = comfort.energyLevel;
    data.attention_required = comfort.attentionLevel;
  }

  return serializeFrontmatter(data);
}
