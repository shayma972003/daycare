import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  previous: vi.fn(),
  event: vi.fn(),
  rooms: vi.fn(),
  guardians: vi.fn(),
  users: vi.fn(),
  createMessage: vi.fn(),
  updateMessage: vi.fn(),
  push: vi.fn(),
}));

vi.mock("@/lib/session", () => ({
  requireSession: vi.fn(async () => ({
    can: () => true,
    user: { id: "manager-1", schoolId: "school-1" },
  })),
  sessionErrorResponse: vi.fn(() => null),
}));
vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn(async () => ({})),
  rateLimitResponse: vi.fn(() => null),
}));
vi.mock("@/lib/student-access-scope", () => ({ scopedClassIds: vi.fn(() => null) }));
vi.mock("@/lib/calendar-event-lock", () => ({
  lockCalendarEventForUpdate: vi.fn(async () => true),
}));
vi.mock("@/lib/push", () => ({ enqueuePush: mocks.push }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: mocks.transaction,
    activityMessage: { findFirst: mocks.previous, update: mocks.updateMessage },
  },
}));

import { POST } from "@/app/api/calendar/[id]/send/route";

const version = "2026-10-05T10:00:00.000Z";
const tx = {
  activityMessage: { findFirst: mocks.previous, create: mocks.createMessage },
  calendarEvent: { findFirst: mocks.event },
  class: { findMany: mocks.rooms },
  guardianAccount: { findMany: mocks.guardians },
  user: { findMany: mocks.users },
};

function request() {
  return new Request("http://localhost/api/calendar/event-1/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      notifyGuardians: true,
      notifyStaff: true,
      message: "إعلان تجريبي",
      eventVersion: version,
      idempotencyKey: "calendar-send-test-key-123",
      confirmSchoolWide: true,
    }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.transaction.mockImplementation(async (callback: (client: typeof tx) => unknown) => callback(tx));
  mocks.previous.mockResolvedValue(null);
  mocks.event.mockResolvedValue({
    id: "event-1",
    title: "إعلان اليوم",
    description: "إعلان تجريبي",
    teacherId: null,
    updatedAt: new Date(version),
    classes: [],
  });
  mocks.rooms.mockResolvedValue([]);
  mocks.guardians.mockResolvedValue([{ id: "guardian-account-1" }]);
  mocks.users.mockResolvedValue([{ id: "staff-1" }]);
  mocks.createMessage.mockResolvedValue({
    id: "message-1",
    recipients: [
      { schoolId: "school-1", guardianAccountId: "guardian-account-1", userId: null },
      { schoolId: "school-1", guardianAccountId: null, userId: "staff-1" },
    ],
  });
  mocks.push.mockResolvedValue(1);
  mocks.updateMessage.mockResolvedValue({});
});

describe("calendar announcement delivery", () => {
  it("respects guardian and staff calendar preferences and queues both pushes", async () => {
    const response = await POST(request(), { params: Promise.resolve({ id: "event-1" }) });
    expect(response.status).toBe(201);
    expect(mocks.guardians).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ schoolId: "school-1", notifyCalendar: true }),
    }));
    expect(mocks.users).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ schoolId: "school-1", notifyCalendar: true }),
    }));
    expect(mocks.push).toHaveBeenCalledTimes(2);
    expect(mocks.push.mock.calls.map((call) => call[0])).toEqual([
      { schoolId: "school-1", guardianAccountId: "guardian-account-1" },
      { schoolId: "school-1", userId: "staff-1" },
    ]);
  });

  it("returns a clear empty-audience response when every eligible account opted out", async () => {
    mocks.guardians.mockResolvedValue([]);
    mocks.users.mockResolvedValue([]);
    const response = await POST(request(), { params: Promise.resolve({ id: "event-1" }) });
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: "No eligible in-app recipients" });
    expect(mocks.createMessage).not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();
  });
});
