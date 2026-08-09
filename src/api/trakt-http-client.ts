import { requestUrl } from "obsidian";

export const TRAKT_API_BASE = "https://api.trakt.tv";
export const TRAKT_API_VERSION = "2";

export class TraktApiError extends Error {
  constructor(
    message: string,
    public status: number | null,
  ) {
    super(message);
    this.name = "TraktApiError";
  }
}

export class TraktAuthError extends TraktApiError {
  constructor(
    message = "Trakt account is not connected, or the connection has expired.",
  ) {
    super(message, 401);
    this.name = "TraktAuthError";
  }
}

interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
  authenticated?: boolean;
  maxRetries?: number;
}

const BASE_BACKOFF_MS = 500;
const DEFAULT_MAX_RETRIES = 3;

export interface TraktClientConfig {
  getClientId: () => string;
  getClientSecret: () => string;
  getAccessToken: () => string | null;
}

export class TraktHttpClient {
  constructor(private config: TraktClientConfig) {}

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const {
      method = "GET",
      body,
      authenticated = true,
      maxRetries = DEFAULT_MAX_RETRIES,
    } = options;

    const clientId = this.config.getClientId();
    if (!clientId)
      throw new TraktApiError("Trakt client ID is not configured.", null);

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "trakt-api-version": TRAKT_API_VERSION,
      "trakt-api-key": clientId,
    };

    if (authenticated) {
      const token = this.config.getAccessToken();
      if (!token) throw new TraktAuthError();
      headers["Authorization"] = `Bearer ${token}`;
    }

    let lastError: unknown;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const response = await requestUrl({
          url: `${TRAKT_API_BASE}${path}`,
          method,
          headers,
          body: body !== undefined ? JSON.stringify(body) : undefined,
          throw: false,
        });

        if (response.status === 401) throw new TraktAuthError();

        if (response.status === 429) {
          await sleep(BASE_BACKOFF_MS * Math.pow(2, attempt));
          continue;
        }

        if (response.status >= 500) {
          lastError = new TraktApiError(
            `Trakt server error (${response.status})`,
            response.status,
          );
          await sleep(BASE_BACKOFF_MS * Math.pow(2, attempt));
          continue;
        }

        if (response.status >= 400) {
          throw new TraktApiError(
            `Trakt request failed (${response.status})`,
            response.status,
          );
        }

        return (response.text ? JSON.parse(response.text) : {}) as T;
      } catch (err) {
        if (err instanceof TraktAuthError) throw err;
        if (
          err instanceof TraktApiError &&
          err.status !== null &&
          err.status < 500
        )
          throw err;
        lastError = err;
        if (attempt < maxRetries)
          await sleep(BASE_BACKOFF_MS * Math.pow(2, attempt));
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new TraktApiError("Trakt request failed after retries.", null);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
