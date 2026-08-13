import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => {
  const model = () => ({ findMany: vi.fn().mockResolvedValue([]), deleteMany: vi.fn().mockResolvedValue({ count: 0 }) });
  return { prisma: { refreshToken: model(), passwordResetToken: model(), schoolAdminInvitation: model(), twoFASession: model(), pushNotification: model(), notificationLog: model() } };
});

import { prisma } from "@/lib/prisma";
import { runBoundedRetention } from "@/lib/bounded-retention";

describe("bounded retention", () => {
  it("uses bounded batches and does not delete valid rows returned by no query", async () => {
    const result = await runBoundedRetention(new Date("2026-08-14T00:00:00Z"));
    expect(result.limit).toBe(100);
    expect(result.failures).toBe(0);
    expect(prisma.refreshToken.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 100 }));
    expect(prisma.refreshToken.deleteMany).not.toHaveBeenCalled();
  });

  it("isolates one failed cleanup job", async () => {
    vi.mocked(prisma.refreshToken.findMany).mockRejectedValueOnce(new Error("store down"));
    const result = await runBoundedRetention();
    expect(result.failures).toBe(1);
    expect(prisma.passwordResetToken.findMany).toHaveBeenCalled();
  });
});
