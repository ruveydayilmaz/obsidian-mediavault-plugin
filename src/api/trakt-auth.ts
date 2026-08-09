import { requestUrl } from "obsidian";
import { TRAKT_API_BASE, TraktApiError } from "./trakt-http-client";

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

export async function requestDeviceCode(
  clientId: string,
): Promise<TraktDeviceCode> {
  const response = await requestUrl({
    url: `${TRAKT_API_BASE}/oauth/device/code`,
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: clientId }),
    throw: false,
  });

  if (response.status >= 400) {
    throw new TraktApiError(
      `Failed to start Trakt device authorization (${response.status}).`,
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
  const response = await requestUrl({
    url: `${TRAKT_API_BASE}/oauth/device/token`,
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      code: deviceCode,
      client_id: clientId,
      client_secret: clientSecret,
    }),
    throw: false,
  });

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

  // 400 = pending, 404 = invalid code,
  // 409 = already approved elsewhere, 410 = expired, 418 = denied.
  if (response.status === 400) return { status: "pending" };
  if (response.status === 410) return { status: "expired" };
  if (response.status === 418) return { status: "denied" };

  throw new TraktApiError(
    `Unexpected response while polling Trakt device auth (${response.status}).`,
    response.status,
  );
}

export async function refreshAccessToken(
  clientId: string,
  clientSecret: string,
  refreshToken: string,
): Promise<TraktTokenResponse> {
  const response = await requestUrl({
    url: `${TRAKT_API_BASE}/oauth/token`,
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
    }),
    throw: false,
  });

  if (response.status >= 400) {
    throw new TraktApiError(
      `Failed to refresh Trakt token (${response.status}). Reconnect your account.`,
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
