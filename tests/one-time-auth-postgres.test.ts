import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { hashOneTimeCode } from "@/lib/one-time-code";

const schema = process.env.ONE_TIME_AUTH_SCHEMA;
const enabled = Boolean(schema);
const suite = enabled ? describe.sequential : describe.skip;

suite("one-time authentication CAS on PostgreSQL", () => {
  let prisma: PrismaClient;
  let verifyTwoFa: typeof import("@/app/api/auth/verify-2fa/route")["POST"];
  let resetPassword: typeof import("@/app/api/auth/reset-password/route")["POST"];
  const suffix = randomBytes(5).toString("hex");
  const schoolId = `codex6c_school_${suffix}`;
  const userId = `codex6c_user_${suffix}`;

  beforeAll(async () => {
    if (!schema || !/^codex_6c_[a-z0-9_]+$/.test(schema) || schema === "public") {
      throw new Error("Unsafe or missing ONE_TIME_AUTH_SCHEMA");
    }
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL is required for isolated tests");
    if (!new URL(connectionString).hostname.toLowerCase().includes("neon")) {
      throw new Error("One-time auth PostgreSQL test only accepts Neon");
    }

    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }, { schema }) });
    vi.doMock("@/lib/prisma", () => ({ prisma }));
    vi.doMock("@/lib/rate-limit", async (original) => ({
      ...(await original<typeof import("@/lib/rate-limit")>()),
      rateLimit: vi.fn().mockResolvedValue({ status: "allowed", remaining: 10, retryAfter: 0 }),
      clientIp: () => "203.0.113.20",
    }));
    vi.doMock("@/lib/file-token", () => ({ stampFileUrl: (value: string | null) => value }));

    ({ POST: verifyTwoFa } = await import("@/app/api/auth/verify-2fa/route"));
    ({ POST: resetPassword } = await import("@/app/api/auth/reset-password/route"));

    await prisma.school.create({ data: { id: schoolId, name: "Codex 6C" } });
    await prisma.user.create({
      data: {
        id: userId,
        schoolId,
        name: "Codex user",
        email: `codex6c_${suffix}@example.test`,
        password: "$2b$12$C6UzMDM.H6dfI/f/IKcEe.iVMhrpZ9zXBcVBrEXvXJZgFqbrJmZ7q",
        acceptedAt: new Date(),
      },
    });
  });

  afterAll(async () => {
    vi.doUnmock("@/lib/prisma");
    vi.doUnmock("@/lib/rate-limit");
    vi.doUnmock("@/lib/file-token");
    await prisma?.$disconnect();
  });

  function json(path: string, body: Record<string, unknown>) {
    return new Request(`http://localhost${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("lets exactly one concurrent 2FA verification claim the code", async () => {
    const code = "123456";
    const session = await prisma.twoFASession.create({
      data: {
        schoolId,
        userId,
        purpose: "LOGIN",
        otpCodeHash: hashOneTimeCode(code, "2fa-login"),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    const responses = await Promise.all(
      Array.from({ length: 8 }, () =>
        verifyTwoFa(json("/api/auth/verify-2fa", { twoFaSessionId: session.id, otp_code: code }))
      )
    );
    expect(responses.filter((response) => response.status === 200)).toHaveLength(1);
    expect(responses.filter((response) => response.status !== 200)).toHaveLength(7);
    await expect(prisma.twoFASession.findUnique({ where: { id: session.id } })).resolves.toMatchObject({
      verified: true,
    });
  });

  it("lets exactly one concurrent login callback consume a bypass token", async () => {
    const raw = `bypass-${randomBytes(24).toString("hex")}`;
    const digest = (await import("node:crypto")).createHash("sha256").update(raw).digest("hex");
    await prisma.twoFASession.create({
      data: {
        schoolId,
        userId,
        purpose: "LOGIN",
        otpCodeHash: hashOneTimeCode("999999", "2fa-login"),
        expiresAt: new Date(Date.now() + 60_000),
        verified: true,
        bypassTokenHash: digest,
        bypassExpires: new Date(Date.now() + 60_000),
      },
    });
    const { authOptions } = await import("@/lib/auth");
    const authorize = (
      authOptions.providers[0] as unknown as {
        options: {
          authorize: (
            credentials: Record<string, string>,
            request: { body: unknown; query: unknown; headers: unknown; method: string }
          ) => Promise<unknown>;
        };
      }
    ).options.authorize;
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        authorize(
          { twofa_bypass_token: raw },
          { body: {}, query: {}, headers: {}, method: "POST" }
        )
      )
    );
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it("consumes a password reset once and increments the web session generation", async () => {
    const code = "345678";
    const token = await prisma.passwordResetToken.create({
      data: {
        userId,
        tokenHash: hashOneTimeCode(code, "password-reset"),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    const body = {
      identifier: `codex6c_${suffix}@example.test`,
      otp: code,
      newPassword: "Codex-strong-password-1!",
    };
    const responses = await Promise.all(
      Array.from({ length: 6 }, () => resetPassword(json("/api/auth/reset-password", body)))
    );
    expect(responses.filter((response) => response.status === 200)).toHaveLength(1);
    expect(await prisma.passwordResetToken.count({ where: { id: token.id } })).toBe(0);
    await expect(prisma.user.findUnique({ where: { id: userId } })).resolves.toMatchObject({
      authVersion: 1,
    });
  });

  it("rolls token consumption back when the password update fails", async () => {
    const code = "456789";
    const token = await prisma.passwordResetToken.create({
      data: {
        userId,
        tokenHash: hashOneTimeCode(code, "password-reset"),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    await prisma.$executeRawUnsafe(`
      CREATE FUNCTION "${schema}".codex_6c_reject_password_update()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'codex 6c forced rollback'; END; $$;
      CREATE TRIGGER codex_6c_reject_password_update
      BEFORE UPDATE OF "password" ON "${schema}"."User"
      FOR EACH ROW EXECUTE FUNCTION "${schema}".codex_6c_reject_password_update();
    `);
    await expect(
      resetPassword(
        json("/api/auth/reset-password", {
          identifier: `codex6c_${suffix}@example.test`,
          otp: code,
          newPassword: "Codex-another-password-2!",
        })
      )
    ).rejects.toThrow(/codex 6c forced rollback/);
    expect(await prisma.passwordResetToken.count({ where: { id: token.id } })).toBe(1);
    await prisma.$executeRawUnsafe(`DROP TRIGGER codex_6c_reject_password_update ON "${schema}"."User"`);
    await prisma.$executeRawUnsafe(`DROP FUNCTION "${schema}".codex_6c_reject_password_update()`);
  });
});
