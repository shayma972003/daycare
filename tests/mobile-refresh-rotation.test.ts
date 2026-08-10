import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";

interface RefreshRow {
  id: string;
  tokenHash: string;
  familyId: string;
  userId: string | null;
  guardianAccountId: string | null;
  expiresAt: Date;
  revokedAt: Date | null;
  rotatedAt: Date | null;
  userAgent: string | null;
  ipAddress: string | null;
  createdAt: Date;
}

const store = vi.hoisted(() => {
  let rows: RefreshRow[] = [];
  let failCreate = false;

  const cloneRows = () => rows.map((row) => ({ ...row }));

  const client = {
    refreshToken: {
      async findUnique({ where }: { where: { tokenHash: string } }) {
        const row = rows.find((candidate) => candidate.tokenHash === where.tokenHash);
        return row ? { ...row } : null;
      },
      async updateMany({
        where,
        data,
      }: {
        where: {
          id?: string;
          familyId?: string;
          tokenHash?: string;
          rotatedAt?: null;
          revokedAt?: null;
        };
        data: { rotatedAt?: Date; revokedAt?: Date };
      }) {
        let count = 0;
        for (const row of rows) {
          if (where.id !== undefined && row.id !== where.id) continue;
          if (where.familyId !== undefined && row.familyId !== where.familyId) continue;
          if (where.tokenHash !== undefined && row.tokenHash !== where.tokenHash) continue;
          if ("rotatedAt" in where && row.rotatedAt !== null) continue;
          if ("revokedAt" in where && row.revokedAt !== null) continue;
          Object.assign(row, data);
          count++;
        }
        return { count };
      },
      async create({ data }: { data: Omit<RefreshRow, "id" | "createdAt" | "rotatedAt" | "revokedAt"> }) {
        if (failCreate) throw new Error("simulated replacement insert failure");
        const row: RefreshRow = {
          ...data,
          id: `replacement-${rows.length}`,
          createdAt: new Date(),
          rotatedAt: null,
          revokedAt: null,
        };
        rows.push(row);
        return { ...row };
      },
    },
    user: {
      async findUnique({ where }: { where: { id: string } }) {
        if (where.id !== "user-1") return null;
        return {
          id: "user-1",
          schoolId: "school-1",
          disabledAt: null,
          roleRef: { permissions: ["attendance.manage"] },
          school: { subscription_status: "active" },
        };
      },
    },
    guardianAccount: { async findUnique() { return null; } },
    async $transaction<T>(operation: (tx: unknown) => Promise<T>): Promise<T> {
      const snapshot = cloneRows();
      try {
        return await operation(client);
      } catch (error) {
        rows = snapshot;
        throw error;
      }
    },
  };

  return {
    client,
    reset(initialRows: RefreshRow[]) {
      rows = initialRows.map((row) => ({ ...row }));
      failCreate = false;
    },
    rows: () => cloneRows(),
    failNextCreate() {
      failCreate = true;
    },
  };
});

vi.mock("@/lib/prisma", () => ({ prisma: store.client }));
vi.mock("@/lib/env", () => ({ env: { NEXTAUTH_SECRET: "test-secret-that-is-at-least-32-characters" } }));

import { rotateRefreshToken } from "@/lib/mobile-auth";

const TOKEN = "refresh-token-with-enough-entropy-for-tests";
const FAMILY = "family-1234567890abcdef";
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

function tokenRow(overrides: Partial<RefreshRow> = {}): RefreshRow {
  return {
    id: "token-1",
    tokenHash: hash(TOKEN),
    familyId: FAMILY,
    userId: "user-1",
    guardianAccountId: null,
    expiresAt: new Date(Date.now() + 60_000),
    revokedAt: null,
    rotatedAt: null,
    userAgent: null,
    ipAddress: null,
    createdAt: new Date(),
    ...overrides,
  };
}

beforeEach(() => {
  store.reset([tokenRow()]);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

describe("atomic mobile refresh-token rotation", () => {
  it("rotates an active token and creates one active replacement in the same family", async () => {
    const result = await rotateRefreshToken(TOKEN, { userAgent: "test", ipAddress: "127.0.0.1" });

    expect(result.ok).toBe(true);
    const rows = store.rows();
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.id === "token-1")?.rotatedAt).toBeInstanceOf(Date);
    expect(rows.find((row) => row.id !== "token-1")).toMatchObject({
      familyId: FAMILY,
      revokedAt: null,
      rotatedAt: null,
      userAgent: "test",
      ipAddress: "127.0.0.1",
    });
  });

  it("rejects an expired token without rotating it", async () => {
    store.reset([tokenRow({ expiresAt: new Date(Date.now() - 1) })]);

    await expect(rotateRefreshToken(TOKEN)).resolves.toEqual({ ok: false, reason: "expired" });
    expect(store.rows()).toEqual([expect.objectContaining({ rotatedAt: null, revokedAt: null })]);
  });

  it("rejects a revoked token without creating a replacement", async () => {
    store.reset([tokenRow({ revokedAt: new Date() })]);

    await expect(rotateRefreshToken(TOKEN)).resolves.toEqual({ ok: false, reason: "revoked" });
    expect(store.rows()).toHaveLength(1);
  });

  it("treats a rotated token as replay", async () => {
    store.reset([tokenRow({ rotatedAt: new Date() })]);

    await expect(rotateRefreshToken(TOKEN)).resolves.toEqual({ ok: false, reason: "reused" });
  });

  it("allows only one of two concurrent refreshes to rotate the token", async () => {
    const results = await Promise.all([rotateRefreshToken(TOKEN), rotateRefreshToken(TOKEN)]);

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok && result.reason === "reused")).toHaveLength(1);
  });

  it("rolls back rotation if replacement creation fails", async () => {
    store.failNextCreate();

    await expect(rotateRefreshToken(TOKEN)).rejects.toThrow("simulated replacement insert failure");
    expect(store.rows()).toEqual([expect.objectContaining({ id: "token-1", rotatedAt: null })]);
  });

  it("revokes every active token in the family when replay is detected", async () => {
    store.reset([
      tokenRow({ rotatedAt: new Date() }),
      tokenRow({ id: "child-1", tokenHash: hash("child-token"), rotatedAt: null }),
      tokenRow({ id: "child-2", tokenHash: hash("other-child-token"), rotatedAt: null }),
      tokenRow({ id: "other-family", tokenHash: hash("unrelated"), familyId: "other-family" }),
    ]);

    await rotateRefreshToken(TOKEN);

    const rows = store.rows();
    expect(rows.filter((row) => row.familyId === FAMILY).every((row) => row.revokedAt)).toBe(true);
    expect(rows.find((row) => row.familyId === "other-family")?.revokedAt).toBeNull();
  });
});
