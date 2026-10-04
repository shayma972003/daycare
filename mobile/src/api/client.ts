import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

const ACCESS_KEY = "daycare.access";
const REFRESH_KEY = "daycare.refresh";

function configuredBaseUrl() {
  const configured = process.env.EXPO_PUBLIC_API_BASE_URL?.trim();
  const fallback = Platform.OS === "web" ? "http://127.0.0.1:3000" : "";
  return (configured || fallback).replace(/\/$/, "");
}

export const API_BASE = configuredBaseUrl();

export type AccountKind = "staff" | "guardian";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly retryAfterSeconds?: number
  ) {
    super(message);
  }
}

function ensureApiBase() {
  if (!API_BASE) {
    throw new ApiError(
      "أضيفي عنوان الخادم في EXPO_PUBLIC_API_BASE_URL قبل تشغيل التطبيق على الهاتف",
      0,
      "API_BASE_MISSING"
    );
  }
}

function deviceTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

async function readToken(key: string): Promise<string | null> {
  if (Platform.OS === "web") {
    return typeof sessionStorage === "undefined" ? null : sessionStorage.getItem(key);
  }
  return SecureStore.getItemAsync(key);
}

async function writeToken(key: string, value: string): Promise<void> {
  if (Platform.OS === "web") {
    if (typeof sessionStorage !== "undefined") sessionStorage.setItem(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

async function removeToken(key: string): Promise<void> {
  if (Platform.OS === "web") {
    if (typeof sessionStorage !== "undefined") sessionStorage.removeItem(key);
    return;
  }
  await SecureStore.deleteItemAsync(key);
}

export async function saveTokens(accessToken: string, refreshToken: string): Promise<void> {
  await Promise.all([
    writeToken(ACCESS_KEY, accessToken),
    writeToken(REFRESH_KEY, refreshToken),
  ]);
}

export async function clearTokens(): Promise<void> {
  await Promise.all([removeToken(ACCESS_KEY), removeToken(REFRESH_KEY)]);
}

export function getAccessToken() {
  return readToken(ACCESS_KEY);
}

export function getRefreshTokenForSignOut() {
  return readToken(REFRESH_KEY);
}

let refreshing: Promise<boolean> | null = null;

async function refreshTokens(): Promise<boolean> {
  if (refreshing) return refreshing;

  refreshing = (async () => {
    const refreshToken = await readToken(REFRESH_KEY);
    if (!refreshToken) return false;

    try {
      ensureApiBase();
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
      return false;
    } finally {
      refreshing = null;
    }
  })();

  return refreshing;
}

type RequestOptions = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  anonymous?: boolean;
};

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  ensureApiBase();
  const { method = "GET", body, anonymous = false } = options;

  async function send() {
    const accessToken = anonymous ? null : await readToken(ACCESS_KEY);
    return fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-Time-Zone": deviceTimeZone(),
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }

  let response: Response;
  try {
    response = await send();
  } catch {
    throw new ApiError("تعذّر الاتصال بالخادم. تحققي من الشبكة وعنوان التطبيق.", 0);
  }

  if (response.status === 401 && !anonymous) {
    if (await refreshTokens()) {
      try {
        response = await send();
      } catch {
        throw new ApiError("تعذّر الاتصال بالخادم. تحققي من الشبكة وعنوان التطبيق.", 0);
      }
    } else {
      await clearTokens();
    }
  }

  if (!response.ok) {
    let message = "حدث خطأ، حاولي مرة أخرى";
    let code: string | undefined;
    let retryAfterSeconds: number | undefined;
    try {
      const data = (await response.json()) as {
        error?: unknown;
        code?: unknown;
        retryAfterSeconds?: unknown;
      };
      if (typeof data.error === "string") message = data.error;
      if (typeof data.code === "string") code = data.code;
      if (typeof data.retryAfterSeconds === "number" && data.retryAfterSeconds > 0) {
        retryAfterSeconds = data.retryAfterSeconds;
      }
    } catch {
      // Keep the safe default for gateway or non-JSON responses.
    }
    if (response.status === 401) message = "انتهت الجلسة، سجّلي الدخول مجددًا";
    throw new ApiError(message, response.status, code, retryAfterSeconds);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}
