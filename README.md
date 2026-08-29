# MediaVault

An [Obsidian](https://obsidian.md) plugin for tracking movies and TV shows: reviews and rewatches
(with full rating history that's never overwritten), episode-by-episode
progress, custom lists and favorites, a discovery/Explore page, TV Time
GDPR / Trakt import and sync, cast and filmography browsing, notifications
for new releases, mood-based "comfort media" recommendations, and a full
analytics dashboard. Built for desktop, Android, and iOS, with all data
stored directly inside your vault.

<img width="1640" height="664" alt="ss" src="https://github.com/user-attachments/assets/c63304a6-bf16-4b2d-a8ca-a9e84aca7e57" />

## Features

- **Library**: TMDB-backed search/add, grid/list/table views, filters, sort, pagination
- **Favorites & Lists**: favorites carousel, built-in favorite-movies/favorite-series
  smart lists, custom lists with manual/automatic sorting and drag-to-reorder
- **Explore**: TMDB discovery page (trending/popular/recommended), shared
  card rendering with Recommendations
- **Partially Watch**: You can mark a movie as partially watched, similar to a TV show, and record the point where you stopped watching
- **Reviews**: unlimited watch sessions per title, rating-evolution chart, full timeline
- **TV tracking**: season/episode hierarchy, batch mark-watched, favorite episodes,
  season/episode rewatch tracking, dropped-show workflow with resume support
- **Cast & Filmography**: cast tab, actor details with biography, filmography
  browsing with preview-before-import
- **Import**: TV Time GDPR ZIP export (watch history, ratings, reviews,
  favorites, custom lists, dropped/archived status), CSV, and JSON, with
  dry-run preview, per-file diagnostics, and safe re-import
- **Trakt sync**: OAuth, bi-directional history/rating sync, public and
  personal comments, generated history note
- **Notifications**: new episode/season/movie alerts with a baseline date
  (install/import time) so existing history never generates a backlog of
  "new" notifications
- **Notes**: auto-generated per-title markdown notes with frontmatter, safely
  regenerated without ever touching what you write in them
- **Analytics**: genre/actor/studio breakdowns, watch trends, calendar heatmap
- **Comfort Finder**: mood-based filtering (energy, attention, heaviness, tags) with presets
- **Recommendations**: TMDB discovery scored against your taste, plus comfort-based picks from your own library
- **i18n**: English and Turkish, with all UI strings routed through a shared locale system
- **Theme Support**: MediaVault automatically detects themes installed in Obsidian, giving you hundreds of themes to choose from. Some themes may not be fully compatible with the plugin.

## MediaVault Setup Roadmap

Follow these steps to get MediaVault up and running in Obsidian.

### 1. Install MediaVault

Install **MediaVault** from the Obsidian Community Plugins:

* Open **Settings → Community plugins**
* Search for **`MediaVault`**
* Install and enable the plugin

You can also install it directly from the [Community Plugins page](https://community.obsidian.md/plugins/mediavault).

### 2. Create a TMDB API Key

MediaVault uses [TMDB](https://www.themoviedb.org/) to fetch movie and TV show information.

1. Create a TMDB account if you don't have one.
2. Create an API key from your TMDB account.
3. Copy your **TMDB API key**.

### 3. Add Your TMDB API Key to MediaVault

In Obsidian:

**Settings → MediaVault → TMDB API Key**

Paste the API key you copied from TMDB into the input field.

### 4. (Optional) Set Up Trakt

If you want to:

* View your **Trakt comments**
* Post comments to **Trakt**

you'll also need to create a Trakt API application.

1. Go to [Trakt](https://trakt.tv/).
2. Create an API application.
3. Copy your **Client ID (Access Key)** and **Client Secret (Secret Key)**.
4. Open **Settings → MediaVault** in Obsidian.
5. Paste both keys into their corresponding fields.

> **Note:** Trakt setup is optional. You only need it if you want to use MediaVault's Trakt-related features.

### 5. Import Your GDPR Export

Once MediaVault is configured, you can import your data.

Open the **Obsidian command palette**:

* **Desktop:** Press `Ctrl/Cmd + P`
* **Mobile:** Scroll down to access the commands list

Search for **`Import`**.

You should see the MediaVault import command. Select it and choose your **`gdpr.zip`** file to start the import.

### 6. You're Ready!

That's it! Your MediaVault setup is complete.

After importing your data, you can explore everything MediaVault has to offer through the **Obsidian command palette**.

Open the commands list (`Ctrl/Cmd + P` on desktop, or the commands list on mobile) and search for **MediaVault** to discover the available commands and features.


## Project structure

```
src/
  main.ts             Plugin entry point
  constants.ts        Shared constants (view types, ribbon icon, etc.)
  types/              Shared TypeScript types + enums
  models/             Data model interfaces
  i18n/                Locale service + en/tr translation files
  utils/
    platform.ts          Android/iOS detection, dynamic safe-area inset handling
  services/
    storage/            Repositories (split-file storage adapter), migrations, settings
    analytics/          Pure analytics computation + memoization
    comfort/             Filter/rank/join logic for comfort media
    recommendation/      Affinity scoring + recommendation
    importer/
      tvtime/              TV Time GDPR ZIP importer (parsing, list/dropped-status
                           resolution, commit, diagnostics), CSV/JSON importers
    note-generator/       Markdown note generation with safe regeneration
    review-logic.ts       Rewatch numbering, rating evolution
    watch-session-service.ts  Add/edit/delete watch sessions
    episode-import.ts     TMDB episode metadata import
    drop-series-service.ts, movie-progress-service.ts  Dropped/resume workflow
    notification-service.ts  New-release detection with notification baseline
    status-service.ts     Live-derived media status with manual-override handling
    trakt-sync.ts, trakt-token.ts, trakt-note-generator.ts
    media-import.ts       TMDB → MediaItem conversion
    media-delete-service.ts  Cascading delete across watches/lists/favorites
    library-query.ts      Filter/sort/search/paginate
  api/                TMDB and Trakt HTTP clients + normalization
  ui/
    views/              Library dashboard, Analytics dashboard (workspace tabs)
    modals/             Add media, watch session, episode tracker, comfort finder,
                         recommendations, import, Trakt auth, list detail,
                         actor details, media detail, notification history, etc.
    components/         Shared rendering: charts, heatmap, virtual list,
                         poster cards, discover cards
  settings/           Plugin settings + settings tab
```

> **Note:** The translations are currently generated using machine translation, so some phrases may be inaccurate or sound unnatural. If you notice any translation issues, feel free to contribute a correction to the project. All contributions are welcome!
