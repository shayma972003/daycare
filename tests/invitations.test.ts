import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { mintInvite, hashInviteToken, accountState } from "@/lib/invitations";

/**
 * The invitation mechanism, and the things it replaced.
 *
 * Two of these guard *absences* — a password that must no longer be emailed, a
 * sign-in path that must no longer exist — and an absence is exactly what a
 * later edit reintroduces without anything failing. So they read the source.
 */
function source(...segments: string[]): string {
  return readFileSync(join(process.cwd(), ...segments), "utf8");
}

describe("invitation tokens", () => {
  it("mints an unguessable token and stores only its hash", () => {
    const invite = mintInvite();
    // 24 random bytes in base64url. Short enough to survive an email client
    // wrapping the line, long enough that the lookup can be a plain equality.
    expect(invite.token.length).toBeGreaterThanOrEqual(32);
    expect(invite.tokenHash).toHaveLength(64);
    expect(invite.tokenHash).not.toContain(invite.token);
    expect(hashInviteToken(invite.token)).toBe(invite.tokenHash);
  });

  it("gives every invitation a different token", () => {
    const seen = new Set(Array.from({ length: 50 }, () => mintInvite().token));
    expect(seen.size).toBe(50);
  });

  it("expires, and not by accident", () => {
    const invite = mintInvite();
    const days = (invite.expiresAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000);
    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThan(7.1);
  });
});

describe("account state", () => {
  const future = new Date(Date.now() + 60_000);
  const past = new Date(Date.now() - 60_000);

  it("tells a waiting invitation from an expired one", () => {
    // The whole reason this is not a boolean: one means wait, the other means
    // send it again, and a school cannot act on "not active".
    expect(accountState({ acceptedAt: null, inviteExpiresAt: future, disabledAt: null })).toBe(
      "invited"
    );
    expect(accountState({ acceptedAt: null, inviteExpiresAt: past, disabledAt: null })).toBe(
      "expired"
    );
  });

  it("reports no account at all", () => {
    expect(accountState(null)).toBe("none");
  });

  it("counts an account with no invitation ever sent as expired, not active", () => {
    expect(accountState({ acceptedAt: null, inviteExpiresAt: null, disabledAt: null })).toBe(
      "expired"
    );
  });

  it("puts disabled ahead of everything else", () => {
    // A suspended account that also happens to hold a live invitation must read
    // as suspended — otherwise the row offers a "resend" for someone who has
    // deliberately been switched off.
    expect(accountState({ acceptedAt: new Date(), inviteExpiresAt: future, disabledAt: new Date() })).toBe(
      "disabled"
    );
    expect(accountState({ acceptedAt: null, inviteExpiresAt: future, disabledAt: new Date() })).toBe(
      "disabled"
    );
  });

  it("reports an activated account as active", () => {
    expect(accountState({ acceptedAt: past, inviteExpiresAt: null, disabledAt: null })).toBe(
      "active"
    );
  });
});

describe("what invitations replaced", () => {
  it("never emails a password", () => {
    // The old staff route generated one and put it in the message body, where it
    // stayed for as long as the mailbox did.
    const staff = source("src/app/api/staff-accounts/route.ts");
    expect(staff).not.toMatch(/كلمة المرور المؤقتة/);
    expect(staff).toContain("/activate/");
  });

  it("emails a link that something actually reads", () => {
    // The guardian invitation used to point at `/portal?invite=…`, which no
    // route ever consumed: the token was minted, sent, and ignored.
    const guardian = source("src/app/api/guardian-accounts/route.ts");
    // Matched on the interpolated URL rather than the bare phrase: the comment
    // explaining why that link is gone would otherwise fail this test.
    expect(guardian).not.toMatch(/\$\{appUrl\}\/portal\?invite=/);
    expect(guardian).toMatch(/\$\{appUrl\}\/activate\//);
  });

  it("has no phone-based sign-in left", () => {
    // Sign-in is by email for both kinds now. These two routes identified a
    // guardian by phone and then mailed the code anyway.
    expect(() => source("src/app/api/mobile/v1/auth/request-otp/route.ts")).toThrow();
    expect(() => source("src/app/api/mobile/v1/auth/verify-otp/route.ts")).toThrow();
  });

  it("does not require a phone before a guardian can be invited", () => {
    expect(source("src/app/api/guardian-accounts/route.ts")).not.toContain(
      "لا يوجد رقم جوال لولي الأمر"
    );
  });
});

describe("activation route", () => {
  const route = () => source("src/app/api/activate/[token]/route.ts");

  it("answers the same way for missing, expired and used tokens", () => {
    // Anything more specific turns a public endpoint into an oracle.
    const matches = route().match(/الدعوة غير صالحة أو منتهية/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  it("enforces the shared password policy rather than its own", () => {
    expect(route()).toContain("passwordSchema");
  });

  it("is rate limited", () => {
    // Nothing to brute force — but bcrypt at cost 12 is a CPU cost a caller
    // should not be able to spend in a loop.
    expect(route()).toContain("rateLimit");
  });

  it("is reachable while signed out", () => {
    // Redeeming an invitation is by definition done without a session; the edge
    // gate is deny-by-default, so an unlisted path is a 404 nobody can explain.
    const proxy = source("src/proxy.ts");
    expect(proxy).toContain('"/api/activate"');
    expect(proxy).toContain("activate|");
  });

  it("has a permission rule for the resend endpoint", () => {
    // Sub-paths do not inherit: without its own key this falls through to the
    // owner-only default and no manager can resend anything.
    expect(source("src/lib/route-permissions.ts")).toContain(
      '"/api/staff-accounts/:id/invite"'
    );
  });
});

describe("unified mobile sign-in", () => {
  const login = () => source("src/app/api/mobile/v1/auth/login/route.ts");

  it("serves guardians as well as staff", () => {
    expect(login()).toContain("guardianAccount");
    expect(login()).toContain('kind === "guardian"');
  });

  it("refuses a guardian who has not activated", () => {
    // `passwordHash` is null until the invitation is redeemed, and a null must
    // never satisfy a comparison.
    expect(login()).toContain("acceptedAt");
    expect(login()).toContain("DUMMY_HASH");
  });

  it("keeps the two lockout counters apart", () => {
    // One address can belong to a teacher and to a parent at the same nursery;
    // a parent failing five times must not lock the teacher out.
    expect(login()).toContain("login:guardian:");
  });
});

describe("roster scoping", () => {
  const roster = () => source("src/app/api/mobile/v1/attendance/today/route.ts");

  it("narrows a linked teacher to her own classes", () => {
    expect(roster()).toContain("teacherId");
    expect(roster()).toContain("ownClassIds");
  });

  it("refuses a class she does not hold instead of widening", () => {
    // A narrowing parameter that can broaden the result is the whole bug.
    expect(roster()).toContain("لا تملكين صلاحية لهذا الفصل");
  });
});
