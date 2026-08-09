import { randomBytes, createHash, timingSafeEqual } from "crypto";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { BCRYPT_COST } from "@/lib/password-policy";

/**
 * One invitation mechanism for both kinds of account.
 *
 * Before this there were two and a half: guardians got a token that no route
 * ever read, and staff were emailed a generated password in the clear — which
 * then lived in an inbox for as long as the mailbox did, with no expiry and no
 * way to tell whether it had ever been used.
 *
 * An invitation fixes both. The password is never transmitted; a short-lived
 * link is, and the person who will type the password is the one who chooses it.
 *
 * `User` and `GuardianAccount` carry the same three columns with the same
 * meanings, so everything here is written once and branches only where the two
 * tables genuinely differ.
 */

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type InviteKind = "staff" | "guardian";

export interface MintedInvite {
  /** Goes in the email, and nowhere else. Never logged, never stored. */
  token: string;
  tokenHash: string;
  expiresAt: Date;
}

/**
 * A new invitation.
 *
 * 24 random bytes, so the token is the secret and the lookup can be a plain
 * indexed equality — unlike the 6-digit reset OTP, which is only safe because
 * it is scoped to an account the caller must already name.
 */
export function mintInvite(): MintedInvite {
  const token = randomBytes(24).toString("base64url");
  return {
    token,
    tokenHash: hashInviteToken(token),
    expiresAt: new Date(Date.now() + INVITE_TTL_MS),
  };
}

export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Constant-time compare of two hex digests.
 *
 * The database lookup is already an equality on a hashed column, so this guards
 * only the second check below. Cheap, and it keeps the comparison honest if the
 * lookup is ever changed to fetch by id.
 */
function sameHash(a: string, b: string): boolean {
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export interface InviteSubject {
  kind: InviteKind;
  id: string;
  name: string;
  email: string;
  schoolName: string;
  /** True once redeemed. A used invitation is refused, not silently reused. */
  alreadyAccepted: boolean;
}

/**
 * Who an invitation is for, or null.
 *
 * Deliberately returns the same null for "no such token", "expired" and
 * "revoked": the page that calls this is public, and a caller trying tokens
 * should not learn which of those they hit.
 */
export async function findInvite(token: string): Promise<InviteSubject | null> {
  if (!token || token.length < 16) return null;
  const tokenHash = hashInviteToken(token);
  const now = new Date();

  const staff = await prisma.user.findFirst({
    where: { inviteTokenHash: tokenHash },
    select: {
      id: true,
      name: true,
      email: true,
      inviteTokenHash: true,
      inviteExpiresAt: true,
      acceptedAt: true,
      disabledAt: true,
      school: { select: { name: true } },
    },
  });

  if (staff?.inviteTokenHash && sameHash(staff.inviteTokenHash, tokenHash)) {
    if (staff.disabledAt) return null;
    if (!staff.inviteExpiresAt || staff.inviteExpiresAt <= now) return null;
    return {
      kind: "staff",
      id: staff.id,
      name: staff.name,
      email: staff.email,
      schoolName: staff.school?.name ?? "",
      alreadyAccepted: Boolean(staff.acceptedAt),
    };
  }

  const guardian = await prisma.guardianAccount.findFirst({
    where: { inviteTokenHash: tokenHash },
    select: {
      id: true,
      email: true,
      inviteTokenHash: true,
      inviteExpiresAt: true,
      acceptedAt: true,
      disabledAt: true,
      guardian: { select: { name: true } },
      school: { select: { name: true } },
    },
  });

  if (guardian?.inviteTokenHash && sameHash(guardian.inviteTokenHash, tokenHash)) {
    if (guardian.disabledAt) return null;
    if (!guardian.inviteExpiresAt || guardian.inviteExpiresAt <= now) return null;
    return {
      kind: "guardian",
      id: guardian.id,
      name: guardian.guardian?.name ?? "",
      email: guardian.email,
      schoolName: guardian.school?.name ?? "",
      alreadyAccepted: Boolean(guardian.acceptedAt),
    };
  }

  return null;
}

/**
 * Set the password and burn the token.
 *
 * The token is cleared in the same write that stores the hash, so a link cannot
 * be replayed — including by whoever else can read that mailbox. `acceptedAt`
 * is what the auth layer checks; an account that never redeemed its invitation
 * has no password to compare against in the first place.
 */
export async function redeemInvite(
  token: string,
  password: string
): Promise<InviteSubject | null> {
  const subject = await findInvite(token);
  if (!subject) return null;

  const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
  const now = new Date();

  if (subject.kind === "staff") {
    await prisma.user.update({
      where: { id: subject.id },
      data: {
        password: passwordHash,
        acceptedAt: subject.alreadyAccepted ? undefined : now,
        inviteTokenHash: null,
        inviteExpiresAt: null,
      },
    });
  } else {
    await prisma.guardianAccount.update({
      where: { id: subject.id },
      data: {
        passwordHash,
        acceptedAt: subject.alreadyAccepted ? undefined : now,
        inviteTokenHash: null,
        inviteExpiresAt: null,
      },
    });
  }

  return subject;
}

/**
 * What the dashboard shows next to a name.
 *
 * A school needs to tell "never invited" from "invited, hasn't opened it" from
 * "using the app" — those call for three different actions, and one boolean
 * cannot carry them.
 */
export type AccountState = "none" | "invited" | "expired" | "active" | "disabled";

export function accountState(account: {
  acceptedAt: Date | null;
  inviteExpiresAt?: Date | null;
  disabledAt: Date | null;
} | null): AccountState {
  if (!account) return "none";
  if (account.disabledAt) return "disabled";
  if (account.acceptedAt) return "active";
  if (account.inviteExpiresAt && account.inviteExpiresAt > new Date()) return "invited";
  return "expired";
}
