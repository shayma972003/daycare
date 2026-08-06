import {
  request,
  saveTokens,
  clearTokens,
  getAccessToken,
  getRefreshTokenForSignOut,
  API_BASE,
  type Role,
} from "./client";

/**
 * The two doors into one app.
 *
 * Staff sign in with email and password; guardians with a phone number and a
 * code. That difference is not a style choice — a member of staff already has
 * an account with a password, while a parent has never had one and should not
 * be asked to invent one to see whether their child ate lunch.
 *
 * The server decides which door a person came through and stamps `kind` into
 * the token. The app reads it to choose a home screen; it never asks the user
 * to declare a role, because a declared role is a claim and this one is proved.
 */

export interface Account {
  id: string;
  kind: Role;
  name?: string;
  schoolId: string;
  schoolName?: string;
  permissions?: string[];
}

interface TokenResponse {
  accessToken: string;
  refreshToken: string;
  account: Account;
}

export async function signInStaff(email: string, password: string): Promise<Account> {
  const data = await request<TokenResponse>("/api/mobile/v1/auth/login", {
    method: "POST",
    body: { email: email.trim(), password },
    anonymous: true,
  });
  await saveTokens(data.accessToken, data.refreshToken);
  return data.account;
}

/** Step one for a guardian: the code goes to the address the nursery holds. */
export async function requestGuardianCode(phone: string): Promise<void> {
  await request("/api/mobile/v1/auth/request-otp", {
    method: "POST",
    body: { phone: phone.trim() },
    anonymous: true,
  });
}

export async function verifyGuardianCode(phone: string, code: string): Promise<Account> {
  const data = await request<TokenResponse>("/api/mobile/v1/auth/verify-otp", {
    method: "POST",
    body: { phone: phone.trim(), code: code.trim() },
    anonymous: true,
  });
  await saveTokens(data.accessToken, data.refreshToken);
  return data.account;
}

/**
 * Who the stored token belongs to, or null if there is no usable session.
 *
 * Asked on launch. `/me` is the right question rather than decoding the token
 * locally: a token can be cryptographically valid while the account behind it
 * has been disabled, and the server is the only place that knows.
 */
export async function currentAccount(): Promise<Account | null> {
  if (!(await getAccessToken())) return null;
  try {
    return await request<Account>("/api/mobile/v1/me");
  } catch {
    return null;
  }
}

/**
 * Sign out on the server too, not just on this device.
 *
 * Clearing local storage alone leaves the refresh token live for its full term.
 * On a shared phone — which is most of them in a nursery — that is a session
 * the next person could resume.
 */
export async function signOut(): Promise<void> {
  const refreshToken = await getRefreshTokenForSignOut();
  if (refreshToken) {
    try {
      await fetch(`${API_BASE}/api/mobile/v1/auth/refresh`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken }),
      });
    } catch {
      // Offline: the local tokens still go, so this device is signed out. The
      // server-side one expires on its own.
    }
  }
  await clearTokens();
}
