import { requestUrl } from "obsidian";

export const TMDB_API_BASE = "https://api.themoviedb.org/3";
export const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p";

export class TMDBApiError extends Error {
  constructor(
    message: string,
    public status: number | null,
    public tmdbStatusMessage?: string,
  ) {
    super(message);
    this.name = "TMDBApiError";
  }
}

export class TMDBAuthError extends TMDBApiError {
  constructor(message = "TMDB API key is missing or invalid.") {
    super(message, 401);
    this.name = "TMDBAuthError";
  }
}

interface RequestOptions {
  params?: Record<string, string | number | undefined>;
  maxRetries?: number;
}

const DEFAULT_MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 500;

export class TMDBHttpClient {
  constructor(private getApiKey: () => string) {}

  async get<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      throw new TMDBAuthError();
    }

    const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    const url = this.buildUrl(path, apiKey, options.params);

    let lastError: unknown;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const response = await requestUrl({
          url,
          method: "GET",
          throw: false,
        });

        if (response.status === 401) {
          throw new TMDBAuthError();
        }

        if (response.status === 429) {
          const retryAfterHeader = response.headers?.["retry-after"];
          const retryAfterMs = retryAfterHeader
            ? parseInt(retryAfterHeader, 10) * 1000
            : BASE_BACKOFF_MS * Math.pow(2, attempt);
          await sleep(retryAfterMs);
          continue;
        }

        if (response.status >= 500) {
          lastError = new TMDBApiError(
            `TMDB server error (${response.status})`,
            response.status,
          );
          await sleep(BASE_BACKOFF_MS * Math.pow(2, attempt));
          continue;
        }

        if (response.status >= 400) {
          const body = safeJsonParse(response.text);
          throw new TMDBApiError(
            `TMDB request failed (${response.status})`,
            response.status,
            body?.status_message,
          );
        }

        return response.json as T;
      } catch (err) {
        if (err instanceof TMDBAuthError) throw err;
        if (
          err instanceof TMDBApiError &&
          err.status !== null &&
          err.status < 500
        ) {
          throw err;
        }
        lastError = err;
        if (attempt < maxRetries) {
          await sleep(BASE_BACKOFF_MS * Math.pow(2, attempt));
        }
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new TMDBApiError("TMDB request failed after retries.", null);
  }

  private buildUrl(
    path: string,
    apiKey: string,
    params?: RequestOptions["params"],
  ): string {
    const url = new URL(`${TMDB_API_BASE}${path}`);
    url.searchParams.set("api_key", apiKey);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined) url.searchParams.set(key, String(value));
      }
    }
    return url.toString();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function safeJsonParse(text: string): { status_message?: string } | null {
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === "object") {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}
