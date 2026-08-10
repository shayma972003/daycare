/**
 * Token authentication for the mobile app (task 1.7).
 *
 * The web signs in with NextAuth, which keeps its session in an httpOnly cookie.
 * A native app cannot hold one — there is no browser to set it, no automatic
 * attachment, and no way to clear it on sign-out — so the app needs bearer
 * tokens instead. This is a second front door onto the *same* accounts, not a
 * second account system.
 *
 * Shape:
 *
 * - **Access token** — a short-lived signed JWT, sent as `Authorization: Bearer`.
 *   Stateless, so every request does not cost a database round trip just to know
 *   who is calling. Fifteen minutes: long enough that refreshes are rare, short
 *   enough that a stolen one expires before it is worth much.
 * - **Refresh token** — a long-lived opaque random string, stored **hashed**.
 *   Hashed because a leaked database dump must not be a set of working sessions,
 *   for the same reason password-reset tokens are hashed.
 *
 * Refresh tokens rotate on every use and carry a `familyId`. Presenting a token
 * that has already been rotated means two parties hold it — the legitimate app
 * and whoever copied it — so the entire family is revoked and both are forced to
 * sign in again. Detecting theft is the only thing a long-lived credential can
 * do about it.
 */

import { SignJWT, jwtVerify } from "jose";
import { createHash, randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";
import type { Prisma } from "@/generated/prisma/client";

const SECRET = new TextEncoder().encode(env.NEXTAUTH_SECRET);
const ISSUER = "daycare-mobile";

/** Short by design — see the note above. */
const ACCESS_TOKEN_TTL = "15m";
const REFRESH_TOKEN_DAYS = 60;

export type MobileSubject = "staff" | "guardian";

export interface AccessTokenClaims {
  sub: string;
  kind: MobileSubject;
  schoolId: string;
  /** Present for staff only; guardians are scoped by their own children. */
  permissions?: string[];
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

type AuthDb = typeof prisma | Prisma.TransactionClient;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

async function signAccessToken(claims: AccessTokenClaims): Promise<string> {
  return new SignJWT({
    kind: claims.kind,
    schoolId: claims.schoolId,
    ...(claims.permissions ? { permissions: claims.permissions } : {}),
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.sub)
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime(ACCESS_TOKEN_TTL)
    .sign(SECRET);
}

/**
 * Issues a fresh pair and records the refresh token.
 *
 * `familyId` defaults to a new chain. Pass the existing one when rotating so the
 * lineage stays connected and a replay can revoke all of it.
 */
export async function issueTokenPair(
  claims: AccessTokenClaims,
  context: { userAgent?: string | null; ipAddress?: string | null; familyId?: string } = {}
): Promise<TokenPair> {
  return issueTokenPairWithDb(prisma, claims, context);
}

async function issueTokenPairWithDb(
  db: AuthDb,
  claims: AccessTokenClaims,
  context: { userAgent?: string | null; ipAddress?: string | null; familyId?: string } = {}
): Promise<TokenPair> {
  const accessToken = await signAccessToken(claims);

  // 32 bytes from the CSPRNG. `Math.random()` is not a source of secrets — the
  // same defect fixed across this codebase in task 0.19.
  const refreshToken = randomBytes(32).toString("base64url");

  await db.refreshToken.create({
    data: {
      tokenHash: hashToken(refreshToken),
      familyId: context.familyId ?? randomBytes(16).toString("hex"),
      ...(claims.kind === "staff"
        ? { userId: claims.sub }
        : { guardianAccountId: claims.sub }),
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000),
      userAgent: context.userAgent?.slice(0, 300) ?? null,
      ipAddress: context.ipAddress ?? null,
    },
  });

  return { accessToken, refreshToken, expiresIn: 15 * 60 };
}

export type RefreshOutcome =
  | { ok: true; pair: TokenPair; claims: AccessTokenClaims }
  | { ok: false; reason: "invalid" | "expired" | "revoked" | "reused" };
type RefreshFailureReason = Extract<RefreshOutcome, { ok: false }>["reason"];

/**
 * Exchanges a refresh token for a new pair.
 *
 * The reuse branch is the point of the whole design: a token that was already
 * rotated should never be presented again by an honest client, so seeing it
 * means a copy is in circulation. Everything in the family is revoked rather
 * than just the presented token — the attacker may already hold the newer one.
 */
export async function rotateRefreshToken(
  token: string,
  context: { userAgent?: string | null; ipAddress?: string | null } = {}
): Promise<RefreshOutcome> {
  return prisma.$transaction(async (tx): Promise<RefreshOutcome> => {
    const record = await tx.refreshToken.findUnique({
      where: { tokenHash: hashToken(token) },
    });

    if (!record) {
      logRefreshRejection("invalid");
      return { ok: false, reason: "invalid" };
    }

    if (record.rotatedAt) {
      await revokeTokenFamily(tx, record.familyId);
      logRefreshRejection("reused", record.familyId);
      return { ok: false, reason: "reused" };
    }

    if (record.revokedAt) {
      logRefreshRejection("revoked", record.familyId);
      return { ok: false, reason: "revoked" };
    }
    if (record.expiresAt < new Date()) {
      logRefreshRejection("expired", record.familyId);
      return { ok: false, reason: "expired" };
    }

    // Re-read the account inside the same transaction rather than trusting
    // claims from the old access token. Disablement and subscription changes
    // therefore take effect no later than the next refresh.
    const claims = await claimsForSubjectWithDb(
      tx,
      record.userId ? "staff" : "guardian",
      record.userId ?? record.guardianAccountId ?? ""
    );
    if (!claims) {
      await revokeTokenFamily(tx, record.familyId);
      logRefreshRejection("revoked", record.familyId);
      return { ok: false, reason: "revoked" };
    }

    // Compare-and-set is the serialization point. Two requests may both read
    // the row, but only one can change the still-active token. PostgreSQL makes
    // the second updater wait, re-check the predicate, then report count=0.
    const claimed = await tx.refreshToken.updateMany({
      where: { id: record.id, rotatedAt: null, revokedAt: null },
      data: { rotatedAt: new Date() },
    });

    if (claimed.count !== 1) {
      await revokeTokenFamily(tx, record.familyId);
      logRefreshRejection("reused", record.familyId);
      return { ok: false, reason: "reused" };
    }

    // Creation is deliberately inside this transaction. If it throws, the CAS
    // above rolls back and the original token remains usable.
    const pair = await issueTokenPairWithDb(tx, claims, {
      ...context,
      familyId: record.familyId,
    });
    return { ok: true, pair, claims };
  });
}

async function revokeTokenFamily(db: AuthDb, familyId: string): Promise<void> {
  await db.refreshToken.updateMany({
    where: { familyId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

function logRefreshRejection(reason: RefreshFailureReason, familyId?: string) {
  // A short family prefix correlates an incident without logging a bearer token
  // or its full hash/family identifier.
  const family = familyId ? ` family=${familyId.slice(0, 8)}…` : "";
  console.warn(`[mobile-auth] refresh rejected reason=${reason}${family}`);
}

/**
 * Builds the claims for an account, or null when it may no longer sign in.
 *
 * Centralised so the login route and the refresh route apply exactly the same
 * rules — a check that exists on one path and not the other is a check that does
 * not exist.
 */
export async function claimsForSubject(
  kind: MobileSubject,
  id: string
): Promise<AccessTokenClaims | null> {
  return claimsForSubjectWithDb(prisma, kind, id);
}

async function claimsForSubjectWithDb(
  db: AuthDb,
  kind: MobileSubject,
  id: string
): Promise<AccessTokenClaims | null> {
  if (kind === "staff") {
    const user = await db.user.findUnique({
      where: { id },
      select: {
        id: true,
        schoolId: true,
        disabledAt: true,
        roleRef: { select: { permissions: true } },
        school: { select: { subscription_status: true } },
      },
    });
    if (!user || user.disabledAt) return null;
    if (["suspended", "cancelled", "expired"].includes(user.school?.subscription_status ?? "")) {
      return null;
    }
    return {
      sub: user.id,
      kind: "staff",
      schoolId: user.schoolId,
      permissions: user.roleRef?.permissions ?? [],
    };
  }

  const account = await db.guardianAccount.findUnique({
    where: { id },
    select: {
      id: true,
      schoolId: true,
      disabledAt: true,
      acceptedAt: true,
      school: { select: { subscription_status: true } },
    },
  });
  if (!account || account.disabledAt || !account.acceptedAt) return null;
  if (["suspended", "cancelled", "expired"].includes(account.school?.subscription_status ?? "")) {
    return null;
  }
  return { sub: account.id, kind: "guardian", schoolId: account.schoolId };
}

/** Verifies a bearer token. Signature and expiry only — no database read. */
export async function verifyAccessToken(token: string): Promise<AccessTokenClaims | null> {
  try {
    const { payload } = await jwtVerify(token, SECRET, { issuer: ISSUER });
    if (!payload.sub || typeof payload.schoolId !== "string") return null;
    const kind = payload.kind === "guardian" ? "guardian" : "staff";
    return {
      sub: payload.sub,
      kind,
      schoolId: payload.schoolId,
      permissions: Array.isArray(payload.permissions)
        ? (payload.permissions as string[])
        : undefined,
    };
  } catch {
    return null;
  }
}

/** Reads the bearer token from a request, if present and well-formed. */
export function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice(7).trim();
  return token.length > 0 ? token : null;
}

/** Ends one device's session. Sign-out on a shared phone must actually sign out. */
export async function revokeRefreshToken(token: string): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { tokenHash: hashToken(token), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/** Ends every session for an account — "sign out everywhere", and revocation. */
export async function revokeAllForSubject(kind: MobileSubject, id: string): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: {
      ...(kind === "staff" ? { userId: id } : { guardianAccountId: id }),
      revokedAt: null,
    },
    data: { revokedAt: new Date() },
  });
}
