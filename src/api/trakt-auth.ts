import { requestUrl } from "obsidian";
import { TRAKT_API_BASE, TraktApiError } from "./trakt-http-client";
import { t } from "../i18n";

export const TRAKT_AUTH_BASE = "https://auth.trakt.tv";

export const TRAKT_REDIRECT_URI = "urn:ietf:wg:oauth:2.0:oob";

export interface TraktDeviceCode {
  deviceCode: string;
  userCode: string;
  verificationUrl: string;
  expiresIn: number;
  interval: number;
}

export interface TraktTokenResponse {
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
}

export class TraktReconnectRequiredError extends TraktApiError {
  constructor(status: number | null = 400) {
    super(t("settings.authReconnectRequired"), status);
    this.name = "TraktReconnectRequiredError";
  }
}

interface OAuthErrorBody {
  error?: string;
  error_description?: string;
}

function parseErrorBody(text: string): OAuthErrorBody {
  try {
    const parsed = JSON.parse(text) as OAuthErrorBody;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

async function postJson(url: string, body: Record<string, unknown>) {
  try {
    return await requestUrl({
      url,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      throw: false,
    });
  } catch {
    throw new TraktApiError(t("settings.authNetworkError"), null);
  }
}

function withSecret(
  body: Record<string, unknown>,
  clientSecret: string,
): Record<string, unknown> {
  if (clientSecret) body.client_secret = clientSecret;
  return body;
}

export async function requestDeviceCode(
  clientId: string,
): Promise<TraktDeviceCode> {
  const response = await postJson(`${TRAKT_API_BASE}/oauth/device/code`, {
    client_id: clientId,
  });

  if (response.status >= 400) {
    throw new TraktApiError(
      t("settings.authRequestFailed", { status: response.status }),
      response.status,
    );
  }

  const data = JSON.parse(response.text) as {
    device_code: string;
    user_code: string;
    verification_url: string;
    expires_in: number;
    interval: number;
  };

  return {
    deviceCode: data.device_code,
    userCode: data.user_code,
    verificationUrl: data.verification_url,
    expiresIn: data.expires_in,
    interval: data.interval,
  };
}

export type DevicePollResult =
  | { status: "pending" }
  | { status: "approved"; token: TraktTokenResponse }
  | { status: "denied" }
  | { status: "expired" };

export async function pollDeviceToken(
  clientId: string,
  clientSecret: string,
  deviceCode: string,
): Promise<DevicePollResult> {
  const response = await postJson(
    `${TRAKT_API_BASE}/oauth/device/token`,
    withSecret({ code: deviceCode, client_id: clientId }, clientSecret),
  );

  if (response.status === 200) {
    const data = JSON.parse(response.text) as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
    };
    return {
      status: "approved",
      token: {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresInSeconds: data.expires_in,
      },
    };
  }

  // 400 = pending, 404 = invalid code, 409 = already used,
  // 410 = expired, 418 = denied, 429 = polling too fast
  if (response.status === 410) return { status: "expired" };
  if (response.status === 418) return { status: "denied" };
  if (response.status === 429) return { status: "pending" };
  if (response.status === 400) {
    const { error } = parseErrorBody(response.text);
    if (error === "expired_token") return { status: "expired" };
    if (error === "access_denied") return { status: "denied" };
    if (
      !error ||
      error === "authorization_pending" ||
      error === "slow_down"
    ) {
      return { status: "pending" };
    }
  }

  throw new TraktApiError(
    t("settings.authRequestFailed", { status: response.status }),
    response.status,
  );
}

export async function refreshAccessToken(
  clientId: string,
  clientSecret: string,
  refreshToken: string,
): Promise<TraktTokenResponse> {
  const response = await postJson(
    `${TRAKT_AUTH_BASE}/oauth/token`,
    withSecret(
      {
        refresh_token: refreshToken,
        client_id: clientId,
        redirect_uri: TRAKT_REDIRECT_URI,
        grant_type: "refresh_token",
      },
      clientSecret,
    ),
  );

  if (response.status >= 400) {
    const { error } = parseErrorBody(response.text);

    if (
      error === "invalid_grant" ||
      response.status === 401 ||
      response.status === 403
    ) {
      throw new TraktReconnectRequiredError(response.status);
    }
    throw new TraktApiError(
      t("settings.authRequestFailed", { status: response.status }),
      response.status,
    );
  }

  const data = JSON.parse(response.text) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresInSeconds: data.expires_in,
  };
}
