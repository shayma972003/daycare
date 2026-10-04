import {
  API_BASE,
  clearTokens,
  getAccessToken,
  getRefreshTokenForSignOut,
  request,
  saveTokens,
  type AccountKind,
} from "@/api/client";

export type ChildSummary = {
  id: string;
  name: string;
  avatarUrl: string | null;
  period: "MORNING" | "EVENING" | null;
  class: { id: string; name: string } | null;
};

export type StaffAccount = {
  kind: "staff";
  id: string;
  name: string;
  email: string;
  teacherId: string | null;
  schoolName: string;
  roleName: string | null;
  permissions: string[];
};

export type GuardianAccount = {
  kind: "guardian";
  id: string;
  name: string;
  email: string;
  phone: string | null;
  schoolName: string;
  children: ChildSummary[];
};

export type Account = StaffAccount | GuardianAccount;

type LoginResponse = {
  accessToken: string;
  refreshToken: string;
};

export async function signIn(kind: AccountKind, email: string, password: string): Promise<Account> {
  const tokens = await request<LoginResponse>("/api/mobile/v1/auth/login", {
    method: "POST",
    anonymous: true,
    body: { kind, email: email.trim().toLowerCase(), password },
  });
  await saveTokens(tokens.accessToken, tokens.refreshToken);

  try {
    return await request<Account>("/api/mobile/v1/me");
  } catch (error) {
    await clearTokens();
    throw error;
  }
}

export async function currentAccount(): Promise<Account | null> {
  if (!(await getAccessToken())) return null;
  try {
    return await request<Account>("/api/mobile/v1/me");
  } catch {
    return null;
  }
}

export async function signOut(): Promise<void> {
  const refreshToken = await getRefreshTokenForSignOut();
  if (refreshToken && API_BASE) {
    try {
      await fetch(`${API_BASE}/api/mobile/v1/auth/refresh`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken }),
      });
    } catch {
      // Local sign-out must still succeed while offline.
    }
  }
  await clearTokens();
}
