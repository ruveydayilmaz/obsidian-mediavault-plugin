import type { StorageService } from "./storage";
import { refreshAccessToken } from "../api/trakt-auth";

const REFRESH_BUFFER_MS = 5 * 60 * 1000; // 5 min

export async function ensureValidTraktToken(
  storage: StorageService,
): Promise<string | null> {
  const settings = storage.settings.get();

  if (!settings.traktAccessToken || !settings.traktRefreshToken) {
    return null;
  }

  const expiresAt = settings.traktTokenExpiresAt ?? 0;
  if (Date.now() < expiresAt - REFRESH_BUFFER_MS) {
    return settings.traktAccessToken;
  }

  const refreshed = await refreshAccessToken(
    settings.traktClientId,
    settings.traktClientSecret,
    settings.traktRefreshToken,
  );

  await storage.settings.update({
    traktAccessToken: refreshed.accessToken,
    traktRefreshToken: refreshed.refreshToken,
    traktTokenExpiresAt: Date.now() + refreshed.expiresInSeconds * 1000,
  });

  return refreshed.accessToken;
}

export async function disconnectTrakt(storage: StorageService): Promise<void> {
  await storage.settings.update({
    traktAccessToken: null,
    traktRefreshToken: null,
    traktTokenExpiresAt: null,
  });
}
