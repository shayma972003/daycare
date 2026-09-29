import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireSession: vi.fn(),
  schoolFindUnique: vi.fn(),
  recipientFindMany: vi.fn(),
  recipientCount: vi.fn(),
}));

vi.mock("@/lib/session", () => ({
  requireSession: mocks.requireSession,
  sessionErrorResponse: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    school: { findUnique: mocks.schoolFindUnique },
    adminMessageRecipient: {
      findMany: mocks.recipientFindMany,
      count: mocks.recipientCount,
    },
  },
}));

vi.mock("@/lib/activity-logger", () => ({ logAction: vi.fn() }));

import { GET } from "@/app/api/notifications/admin-messages/route";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireSession.mockResolvedValue({
    user: { schoolId: "school-1", schoolName: "روضة الاختبار" },
  });
  mocks.schoolFindUnique.mockResolvedValue({
    name: "روضة الاختبار",
    renewal_date: null,
    subscription_plan: null,
    _count: { students: 0 },
  });
  mocks.recipientFindMany.mockResolvedValue([
    {
      id: "recipient-1",
      read_at: null,
      message: {
        id: "message-1",
        subject: "إشعار صيانة مجدولة",
        body: "سيكون هناك توقف مؤقت للصيانة.",
        sent_at: new Date("2026-09-20T00:00:00.000Z"),
      },
    },
  ]);
  mocks.recipientCount.mockResolvedValue(1);
});

describe("school admin-message notifications", () => {
  it("keeps manually sent messages whose template key is null", async () => {
    const response = await GET(new Request("http://localhost/api/notifications/admin-messages"));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.messages).toHaveLength(1);
    expect(payload.messages[0].subject).toBe("إشعار صيانة مجدولة");
    expect(mocks.recipientFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        school_id: "school-1",
        delivered_at: { not: null },
        OR: [
          { message: { template_key: null } },
          { message: { template_key: { not: "plan_limit" } } },
        ],
      },
    }));
  });
});
