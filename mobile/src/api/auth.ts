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
 * One door, two registers.
 *
 * Both kinds of account sign in with the email they were invited on and a
 * password they chose when they redeemed that invitation. Guardians used to use
 * a phone number and a code — but the phone only ever named the account, since
 * the code went to the email regardless for want of an SMS gateway.
 *
 * `kind` travels with the request because email alone cannot decide it: a
 * teacher may also be a parent at the same nursery, and then the address exists
 * in both registers. It picks which one to search. It grants nothing — the
 * server stamps the real `kind` into the token from the row it actually found,
 * so a wrong pick fails to sign in rather than signing in as the wrong person.
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

export async function signIn(
  kind: Role,
  email: string,
  password: string
): Promise<Account> {
  const data = await request<TokenResponse>("/api/mobile/v1/auth/login", {
    method: "POST",
    body: { email: email.trim().toLowerCase(), password, kind },
    anonymous: true,
  });
  await saveTokens(data.accessToken, data.refreshToken);
  // Returned from the response, not from `kind`: what the caller asked for is a
  // request, and what came back is what the server decided.
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
