import * as SecureStore from "expo-secure-store";

/**
 * The one way this app talks to the server.
 *
 * Everything goes through `request()` so the three things that are easy to get
 * wrong in one place instead of thirty: the bearer header, the refresh dance on
 * a 401, and turning a failure into a sentence somebody can read.
 *
 * Tokens live in `expo-secure-store` — the Keychain on iOS, EncryptedSharedPrefs
 * on Android — not AsyncStorage, which is a plaintext file any other process on
 * a rooted device can read. A refresh token is a long-lived credential to a
 * child's records; it does not belong on disk in the clear.
 */

const ACCESS_KEY = "daycare.access";
const REFRESH_KEY = "daycare.refresh";

/**
 * Where the API lives.
 *
 * `localhost` means the phone itself, not the laptop, so a device on the same
 * Wi-Fi cannot reach a dev server that way. Point this at the deployed origin
 * unless you have set up a tunnel.
 */
export const API_BASE = "https://daycare-green.vercel.app";

export type Role = "staff" | "guardian";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

export async function saveTokens(access: string, refresh: string): Promise<void> {
  await SecureStore.setItemAsync(ACCESS_KEY, access);
  await SecureStore.setItemAsync(REFRESH_KEY, refresh);
}

export async function clearTokens(): Promise<void> {
  await SecureStore.deleteItemAsync(ACCESS_KEY);
  await SecureStore.deleteItemAsync(REFRESH_KEY);
}

/**
 * The refresh token, for sign-out only.
 *
 * Deliberately named for its one caller rather than exported as a general
 * getter: nothing else has any business reading a long-lived credential, and a
 * neutral name invites it to be used where the access token belongs.
 */
export async function getRefreshTokenForSignOut(): Promise<string | null> {
  return SecureStore.getItemAsync(REFRESH_KEY);
}

export async function getAccessToken(): Promise<string | null> {
  return SecureStore.getItemAsync(ACCESS_KEY);
}

/**
 * A single in-flight refresh, shared by everything that hits a 401 at once.
 *
 * The roster screen fires several requests on open. Without this, an expired
 * token means each one refreshes independently — and because the server rotates
 * the refresh token on use, the second call presents one that has already been
 * spent and the user is signed out for no reason.
 */
let refreshing: Promise<boolean> | null = null;

async function refreshTokens(): Promise<boolean> {
  if (refreshing) return refreshing;

  refreshing = (async () => {
    const refreshToken = await SecureStore.getItemAsync(REFRESH_KEY);
    if (!refreshToken) return false;
    try {
      const response = await fetch(`${API_BASE}/api/mobile/v1/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken }),
      });
      if (!response.ok) return false;
      const data = (await response.json()) as {
        accessToken?: string;
        refreshToken?: string;
      };
      if (!data.accessToken || !data.refreshToken) return false;
      await saveTokens(data.accessToken, data.refreshToken);
      return true;
    } catch {
      // Offline. Not a reason to throw the session away — the token may still
      // be good once there is a network again.
      return false;
    } finally {
      refreshing = null;
    }
  })();

  return refreshing;
}

interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
  /** Set on the sign-in calls, which have no token yet and must not retry. */
  anonymous?: boolean;
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, anonymous = false } = options;

  async function send(): Promise<Response> {
    const token = anonymous ? null : await getAccessToken();
    return fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  }

  let response: Response;
  try {
    response = await send();
  } catch {
    throw new ApiError("تعذّر الاتصال — تحقّقي من الإنترنت", 0);
  }

  // One retry, and only after a refresh that actually succeeded.
  if (response.status === 401 && !anonymous) {
    const renewed = await refreshTokens();
    if (renewed) {
      try {
        response = await send();
      } catch {
        throw new ApiError("تعذّر الاتصال — تحقّقي من الإنترنت", 0);
      }
    }
  }

  if (!response.ok) {
    let message = "حدث خطأ، حاولي مجدداً";
    try {
      const data = (await response.json()) as { error?: unknown };
      if (typeof data.error === "string") message = data.error;
    } catch {
      // A non-JSON body — a gateway page, usually. The default reads better
      // than whatever HTML came back.
    }
    if (response.status === 401) message = "انتهت الجلسة، سجّلي الدخول مجدداً";
    if (response.status === 403) message = "لا تملكين صلاحية لهذا الإجراء";
    throw new ApiError(message, response.status);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}
