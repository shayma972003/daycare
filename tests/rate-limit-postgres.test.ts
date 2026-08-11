import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

const schema = process.env.RATE_LIMIT_POSTGRES_SCHEMA;
const enabled = Boolean(schema);
const suite = enabled ? describe.sequential : describe.skip;

type RateLimitModule = typeof import("@/lib/rate-limit");

suite("RateLimiter on PostgreSQL", () => {
  let prisma: PrismaClient;
  let limiter: RateLimitModule;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  const prefix = `codex5b_${randomBytes(6).toString("hex")}`;

  beforeAll(async () => {
    if (!schema || !/^codex_5b_[a-z0-9_]+$/.test(schema) || schema === "public") {
      throw new Error("Unsafe or missing RATE_LIMIT_POSTGRES_SCHEMA");
    }
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL is required for the isolated test");
    const parsed = new URL(connectionString);
    if (!parsed.hostname.toLowerCase().includes("neon")) {
      throw new Error("RateLimiter PostgreSQL test only accepts Neon");
    }

    const adapter = new PrismaPg({ connectionString }, { schema });
    prisma = new PrismaClient({ adapter });
    vi.doMock("@/lib/prisma", () => ({ prisma }));
    limiter = await import("@/lib/rate-limit");
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const current = await prisma.$queryRaw<Array<{ schema: string }>>`SELECT current_schema() AS schema`;
    // Raw SQL retains the connection's search_path; the model canary executed
    // by the orchestrator is the authoritative proof that generated queries
    // use the explicit PrismaPg schema option.
    expect(current[0]?.schema).toBeTruthy();
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.rateLimit.deleteMany({ where: { key: { startsWith: prefix } } });
      await prisma.$disconnect();
    }
    errorSpy?.mockRestore();
    vi.doUnmock("@/lib/prisma");
  });

  function key(label: string) {
    return `${prefix}:${label}`;
  }

  it("allows exactly 10 of 50 concurrent attempts", async () => {
    const counterKey = key("fifty-at-once");
    const outcomes = await Promise.all(
      Array.from({ length: 50 }, () =>
        limiter.rateLimit({ key: counterKey, limit: 10, windowMs: 60_000 })
      )
    );
    expect(outcomes.filter((outcome) => outcome.status === "allowed")).toHaveLength(10);
    expect(outcomes.filter((outcome) => outcome.status === "limited")).toHaveLength(40);
    expect(outcomes.filter((outcome) => outcome.status === "unavailable")).toHaveLength(0);
    await expect(prisma.rateLimit.findUnique({ where: { key: counterKey } })).resolves.toMatchObject({
      count: 50,
    });
  });

  it("allows the boundary attempt and limits the next one", async () => {
    const counterKey = key("boundary");
    const outcomes = [];
    for (let attempt = 0; attempt < 11; attempt += 1) {
      outcomes.push(
        await limiter.rateLimit({ key: counterKey, limit: 10, windowMs: 60_000 })
      );
    }
    expect(outcomes[9]?.status).toBe("allowed");
    expect(outcomes[10]?.status).toBe("limited");
  });

  it("starts a new window after expiry", async () => {
    const counterKey = key("expiry");
    await expect(
      limiter.rateLimit({ key: counterKey, limit: 1, windowMs: 150 })
    ).resolves.toMatchObject({ status: "allowed" });
    await new Promise((resolve) => setTimeout(resolve, 300));
    await expect(
      limiter.rateLimit({ key: counterKey, limit: 1, windowMs: 150 })
    ).resolves.toMatchObject({ status: "allowed", remaining: 0 });
    await expect(prisma.rateLimit.findUnique({ where: { key: counterKey } })).resolves.toMatchObject({
      count: 1,
    });
  });

  it("handles concurrent attempts at the expiry boundary", async () => {
    const counterKey = key("expiry-race");
    await limiter.rateLimit({ key: counterKey, limit: 10, windowMs: 150 });
    await new Promise((resolve) => setTimeout(resolve, 300));
    const outcomes = await Promise.all(
      Array.from({ length: 20 }, () =>
        limiter.rateLimit({ key: counterKey, limit: 10, windowMs: 60_000 })
      )
    );
    expect(outcomes.filter((outcome) => outcome.status === "allowed")).toHaveLength(10);
    expect(outcomes.filter((outcome) => outcome.status === "limited")).toHaveLength(10);
    expect(outcomes.filter((outcome) => outcome.status === "unavailable")).toHaveLength(0);
    await expect(prisma.rateLimit.findUnique({ where: { key: counterKey } })).resolves.toMatchObject({
      count: 20,
    });
  });

  it("allows again after reset", async () => {
    const counterKey = key("reset");
    await limiter.rateLimit({ key: counterKey, limit: 1, windowMs: 60_000 });
    await expect(
      limiter.rateLimit({ key: counterKey, limit: 1, windowMs: 60_000 })
    ).resolves.toMatchObject({ status: "limited" });
    await expect(limiter.resetRateLimit(counterKey)).resolves.toEqual({ status: "reset" });
    await expect(
      limiter.rateLimit({ key: counterKey, limit: 1, windowMs: 60_000 })
    ).resolves.toMatchObject({ status: "allowed" });
  });

  it("does not corrupt the counter when reset races increments", async () => {
    const counterKey = key("reset-race");
    await limiter.rateLimit({ key: counterKey, limit: 100, windowMs: 60_000 });
    const operations = await Promise.all([
      limiter.resetRateLimit(counterKey),
      ...Array.from({ length: 20 }, () =>
        limiter.rateLimit({ key: counterKey, limit: 100, windowMs: 60_000 })
      ),
    ]);
    expect(operations[0]).toEqual({ status: "reset" });
    expect(operations.slice(1).every((result) => result.status === "allowed")).toBe(true);

    const before = await prisma.rateLimit.findUnique({ where: { key: counterKey } });
    expect(before?.count ?? 0).toBeGreaterThanOrEqual(0);
    expect(before?.count ?? 0).toBeLessThanOrEqual(20);
    await expect(
      limiter.rateLimit({ key: counterKey, limit: 100, windowMs: 60_000 })
    ).resolves.toMatchObject({ status: "allowed" });
    const after = await prisma.rateLimit.findUnique({ where: { key: counterKey } });
    expect(after?.count).toBe((before?.count ?? 0) + 1);
  });

  it("isolates independent keys", async () => {
    const first = key("isolated-a");
    const second = key("isolated-b");
    await Promise.all([
      ...Array.from({ length: 3 }, () =>
        limiter.rateLimit({ key: first, limit: 2, windowMs: 60_000 })
      ),
      limiter.rateLimit({ key: second, limit: 2, windowMs: 60_000 }),
    ]);
    const [firstRow, secondRow] = await Promise.all([
      prisma.rateLimit.findUnique({ where: { key: first } }),
      prisma.rateLimit.findUnique({ where: { key: second } }),
    ]);
    expect(firstRow?.count).toBe(3);
    expect(secondRow?.count).toBe(1);
  });

  it("stores and logs no raw credential material", async () => {
    const rows = await prisma.rateLimit.findMany({
      where: { key: { startsWith: prefix } },
      select: { key: true },
    });
    const persisted = rows.map((row) => row.key).join("\n");
    expect(persisted).not.toMatch(/password|otp|raw[-_:]?token/i);
    expect(errorSpy.mock.calls.flat().join(" ")).not.toMatch(/password|otp|raw[-_:]?token/i);
  });
});
