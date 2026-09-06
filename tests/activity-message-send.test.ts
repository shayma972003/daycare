import { beforeEach, describe, expect, it, vi } from "vitest";

const VERSION_1 = "2026-09-03T08:00:00.000Z";
const VERSION_2 = "2026-09-03T09:00:00.000Z";

type StoredSendResult = {
  id: string;
  requestHash: string;
  guardianRecipientCount: number;
  staffRecipientCount: number;
  pushQueuedCount: number;
  pushFailureCount: number;
  pushProcessedAt: Date | null;
};

const mocks = vi.hoisted(() => ({
  activityFindFirst: vi.fn(),
  activityUpdate: vi.fn(),
  inviteDeleteMany: vi.fn(),
  classFindMany: vi.fn(),
  guardianFindMany: vi.fn(),
  userFindMany: vi.fn(),
  messageCreate: vi.fn(),
  messageFindFirst: vi.fn(),
  messageUpdate: vi.fn(),
  transaction: vi.fn(),
  queryRaw: vi.fn(),
  enqueuePush: vi.fn(),
  logAction: vi.fn(),
  assertTeacherOwned: vi.fn(),
  assertClassOwned: vi.fn(),
}));

vi.mock("@/lib/session", () => ({
  requireSession: vi.fn(async () => ({
    user: { id: "actor", schoolId: "school-a", name: "Manager" },
    can: (permission: string) => permission === "schedule.manage",
  })),
  sessionErrorResponse: vi.fn(),
}));
vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn(async () => ({ status: "allowed" })),
  rateLimitResponse: vi.fn(() => null),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    activity: { findFirst: mocks.activityFindFirst, update: mocks.activityUpdate },
    activityInvite: { deleteMany: mocks.inviteDeleteMany },
    class: { findMany: mocks.classFindMany },
    guardianAccount: { findMany: mocks.guardianFindMany },
    user: { findMany: mocks.userFindMany },
    activityMessage: {
      create: mocks.messageCreate,
      findFirst: mocks.messageFindFirst,
      update: mocks.messageUpdate,
    },
    $transaction: mocks.transaction,
  },
}));
vi.mock("@/lib/push", () => ({ enqueuePush: mocks.enqueuePush }));
vi.mock("@/lib/activity-logger", () => ({ logAction: mocks.logAction }));
vi.mock("@/lib/academic-stage", () => ({
  resolveStageId: vi.fn(async () => null),
  foreignStageResponse: vi.fn(),
}));
vi.mock("@/lib/tenant-guard", () => ({
  assertTeacherOwned: mocks.assertTeacherOwned,
  assertClassOwned: mocks.assertClassOwned,
  crossTenantResponse: vi.fn(),
}));

import { POST } from "@/app/api/activities/[id]/send/route";
import { PUT } from "@/app/api/activities/[id]/route";

function request(body: object) {
  return new Request("http://localhost/api/activities/activity-1/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function sendBody(overrides: Record<string, unknown> = {}) {
  return {
    notifyGuardians: true,
    notifyStaff: true,
    message: "Line one\n<script>alert(1)</script>",
    activityVersion: VERSION_1,
    idempotencyKey: "request-id-123456789",
    ...overrides,
  };
}

function activity(version = VERSION_1) {
  return {
    id: "activity-1",
    name: "Museum visit",
    message: "Line one\n<script>alert(1)</script>",
    teacherId: "teacher-owner",
    updatedAt: new Date(version),
    activityInvites: [{
      class: {
        teacherId: "teacher-class",
        students: [
          {
            guardianId: "guardian-1",
            guardianLinks: [{ guardianId: "guardian-1" }, { guardianId: "guardian-2" }],
          },
          { guardianId: "guardian-1", guardianLinks: [{ guardianId: "guardian-2" }] },
        ],
      },
    }],
  };
}

function transactionClient() {
  return {
    $queryRaw: mocks.queryRaw,
    activityInvite: { deleteMany: mocks.inviteDeleteMany },
    activity: { findFirst: mocks.activityFindFirst, update: mocks.activityUpdate },
    class: { findMany: mocks.classFindMany },
    guardianAccount: { findMany: mocks.guardianFindMany },
    user: { findMany: mocks.userFindMany },
    activityMessage: { findFirst: mocks.messageFindFirst, create: mocks.messageCreate },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.messageFindFirst.mockResolvedValue(null);
  mocks.queryRaw.mockResolvedValue([{ id: "activity-1" }]);
  mocks.activityFindFirst.mockResolvedValue(activity());
  mocks.guardianFindMany.mockResolvedValue([
    { id: "guardian-account-1" },
    { id: "guardian-account-2" },
  ]);
  mocks.userFindMany.mockResolvedValue([{ id: "user-1" }, { id: "user-2" }]);
  mocks.messageCreate.mockImplementation(async (args) => ({
    id: "message-1",
    recipients: args.data.recipients.create.map((recipient: Record<string, unknown>) => ({
      schoolId: args.data.schoolId,
      guardianAccountId: recipient.guardianAccountId ?? null,
      userId: recipient.userId ?? null,
    })),
  }));
  mocks.messageUpdate.mockResolvedValue({ id: "message-1" });
  mocks.enqueuePush.mockResolvedValue(1);
  mocks.logAction.mockResolvedValue(undefined);
  mocks.assertTeacherOwned.mockImplementation(async (id: string | null) => id);
  mocks.assertClassOwned.mockImplementation(async (id: string) => id);
  mocks.transaction.mockImplementation(async (callback: (tx: unknown) => unknown) => callback(transactionClient()));
});

describe("activity in-app message send", () => {
  it("stores primary and additional guardian recipients once and only queues push signals", async () => {
    const response = await POST(request(sendBody()), { params: Promise.resolve({ id: "activity-1" }) });

    expect(response.status).toBe(201);
    const create = mocks.messageCreate.mock.calls[0][0].data;
    expect(create.schoolId).toBe("school-a");
    expect(create.body).toBe("Line one\n<script>alert(1)</script>");
    expect(create.requestHash).toMatch(/^[a-f0-9]{64}$/);
    expect(create.targetRevision).toEqual(new Date(VERSION_1));
    expect(create.guardianRecipientCount).toBe(2);
    expect(create.staffRecipientCount).toBe(2);
    expect(create.recipients.create).toEqual([
      { guardianAccountId: "guardian-account-1" },
      { guardianAccountId: "guardian-account-2" },
      { userId: "user-1" },
      { userId: "user-2" },
    ]);
    expect(mocks.guardianFindMany.mock.calls[0][0].where).toMatchObject({
      schoolId: "school-a",
      guardianId: { in: ["guardian-1", "guardian-2"] },
      disabledAt: null,
      acceptedAt: { not: null },
      guardian: { is: { schoolId: "school-a", deletedAt: null, anonymizedAt: null } },
    });
    expect(mocks.userFindMany.mock.calls[0][0].where.schoolId).toBe("school-a");
    expect(mocks.enqueuePush).toHaveBeenCalledTimes(4);
    expect(mocks.enqueuePush.mock.calls.map((call) => call[0])).toEqual([
      { schoolId: "school-a", guardianAccountId: "guardian-account-1" },
      { schoolId: "school-a", guardianAccountId: "guardian-account-2" },
      { schoolId: "school-a", userId: "user-1" },
      { schoolId: "school-a", userId: "user-2" },
    ]);
    expect(mocks.enqueuePush.mock.calls[0][1].body).not.toContain("<script>");
    expect(mocks.messageUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "message-1" },
      data: expect.objectContaining({ pushQueuedCount: 4, pushFailureCount: 0 }),
    }));
  });

  it("keeps the durable message successful when a push enqueue fails", async () => {
    mocks.enqueuePush.mockRejectedValueOnce(new Error("provider unavailable"));
    const response = await POST(request(sendBody({ notifyStaff: false })), {
      params: Promise.resolve({ id: "activity-1" }),
    });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ success: true, pushFailures: 1 });
  });

  it("rejects unsaved content, a stale persisted target revision, and unconfirmed school-wide send", async () => {
    let response = await POST(request(sendBody({ message: "changed but not saved" })), {
      params: Promise.resolve({ id: "activity-1" }),
    });
    expect(response.status).toBe(409);
    expect(mocks.messageCreate).not.toHaveBeenCalled();

    response = await POST(request(sendBody({ activityVersion: VERSION_2 })), {
      params: Promise.resolve({ id: "activity-1" }),
    });
    expect(response.status).toBe(409);

    mocks.activityFindFirst.mockResolvedValue({
      ...activity(),
      name: "School day",
      message: "Stored",
      teacherId: null,
      activityInvites: [],
    });
    response = await POST(request(sendBody({
      message: "Stored",
      notifyStaff: false,
      idempotencyKey: "another-request-123456",
    })), { params: Promise.resolve({ id: "activity-1" }) });
    expect(response.status).toBe(422);
    expect(mocks.classFindMany).not.toHaveBeenCalled();
  });

  it("returns the stored recipient and push counts on an exact retry without recomputing audience", async () => {
    mocks.messageFindFirst.mockResolvedValue({
      id: "message-existing",
      requestHash: "placeholder",
      guardianRecipientCount: 3,
      staffRecipientCount: 2,
      pushQueuedCount: 4,
      pushFailureCount: 1,
      pushProcessedAt: new Date(),
    });

    // Obtain the real hash produced for this exact intent from a first create,
    // rather than inventing a different fingerprint in the mock.
    mocks.messageFindFirst.mockResolvedValueOnce(null);
    await POST(request(sendBody()), { params: Promise.resolve({ id: "activity-1" }) });
    const realHash = mocks.messageCreate.mock.calls[0][0].data.requestHash;
    vi.clearAllMocks();
    mocks.messageFindFirst.mockResolvedValue({
      id: "message-existing",
      requestHash: realHash,
      guardianRecipientCount: 3,
      staffRecipientCount: 2,
      pushQueuedCount: 4,
      pushFailureCount: 1,
      pushProcessedAt: new Date(),
    });

    const response = await POST(request(sendBody()), { params: Promise.resolve({ id: "activity-1" }) });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      duplicate: true,
      messageId: "message-existing",
      notified: 5,
      guardianRecipients: 3,
      staffRecipients: 2,
      pushQueued: 4,
      pushFailures: 1,
      pushPending: false,
    });
    expect(mocks.activityFindFirst).not.toHaveBeenCalled();
    expect(mocks.guardianFindMany).not.toHaveBeenCalled();
    expect(mocks.userFindMany).not.toHaveBeenCalled();
    expect(mocks.enqueuePush).not.toHaveBeenCalled();
  });

  it("rejects reusing an idempotency key for different content or target revision", async () => {
    await POST(request(sendBody()), { params: Promise.resolve({ id: "activity-1" }) });
    const originalHash = mocks.messageCreate.mock.calls[0][0].data.requestHash;
    const audienceReads = mocks.activityFindFirst.mock.calls.length;
    mocks.messageFindFirst.mockResolvedValue({
      id: "message-existing",
      requestHash: originalHash,
      guardianRecipientCount: 2,
      staffRecipientCount: 2,
      pushQueuedCount: 4,
      pushFailureCount: 0,
      pushProcessedAt: new Date(),
    });

    const changedContent = await POST(request(sendBody({ message: "Different saved text" })), {
      params: Promise.resolve({ id: "activity-1" }),
    });
    const changedRevision = await POST(request(sendBody({ activityVersion: VERSION_2 })), {
      params: Promise.resolve({ id: "activity-1" }),
    });
    expect(changedContent.status).toBe(409);
    expect(changedRevision.status).toBe(409);
    expect(mocks.activityFindFirst).toHaveBeenCalledTimes(audienceReads);
    expect(mocks.messageCreate).toHaveBeenCalledTimes(1);
  });

  it("rejects the same key after a real target update through the activity PUT route", async () => {
    await POST(request(sendBody()), { params: Promise.resolve({ id: "activity-1" }) });
    const firstHash = mocks.messageCreate.mock.calls[0][0].data.requestHash;

    mocks.activityFindFirst.mockResolvedValueOnce({
      id: "activity-1",
      schoolId: "school-a",
      startDate: new Date("2026-09-10T00:00:00.000Z"),
      endDate: new Date("2026-09-10T00:00:00.000Z"),
      allDay: true,
      updatedAt: new Date(VERSION_1),
    });
    mocks.activityUpdate.mockResolvedValueOnce({ id: "activity-1", name: "Museum visit", updatedAt: new Date(VERSION_2) });
    const updateResponse = await PUT(new Request("http://localhost/api/activities/activity-1", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ teacherId: "teacher-new", classIds: ["class-new"] }),
    }), { params: Promise.resolve({ id: "activity-1" }) });
    expect(updateResponse.status).toBe(200);
    expect(mocks.assertTeacherOwned).toHaveBeenCalledWith("teacher-new", "school-a");
    expect(mocks.assertClassOwned).toHaveBeenCalledWith("class-new", "school-a");
    expect(mocks.activityUpdate.mock.calls[0][0].data).toMatchObject({
      teacherId: "teacher-new",
      activityInvites: { create: [{ classId: "class-new" }] },
    });

    mocks.messageFindFirst.mockResolvedValue({
      id: "message-existing",
      requestHash: firstHash,
      guardianRecipientCount: 2,
      staffRecipientCount: 2,
      pushQueuedCount: 4,
      pushFailureCount: 0,
      pushProcessedAt: new Date(),
    });
    const retry = await POST(request(sendBody({ activityVersion: VERSION_2 })), {
      params: Promise.resolve({ id: "activity-1" }),
    });
    expect(retry.status).toBe(409);
    expect(mocks.enqueuePush).toHaveBeenCalledTimes(4);
  });

  it("returns the winner's stored snapshot after a concurrent unique-key race", async () => {
    // Capture the actual intent hash with a successful isolated request.
    await POST(request(sendBody({ idempotencyKey: "capture-request-123456" })), {
      params: Promise.resolve({ id: "activity-1" }),
    });
    const realHash = mocks.messageCreate.mock.calls[0][0].data.requestHash;

    vi.clearAllMocks();
    mocks.messageFindFirst.mockReset();
    mocks.activityFindFirst.mockResolvedValue(activity());
    mocks.guardianFindMany.mockResolvedValue([{ id: "guardian-account-1" }, { id: "guardian-account-2" }]);
    mocks.userFindMany.mockResolvedValue([{ id: "user-1" }, { id: "user-2" }]);
    mocks.messageFindFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: "message-winner",
      requestHash: realHash,
      guardianRecipientCount: 2,
      staffRecipientCount: 2,
      pushQueuedCount: 0,
      pushFailureCount: 0,
      pushProcessedAt: null,
    });
    mocks.messageCreate.mockRejectedValue({ code: "P2002" });
    const response = await POST(request(sendBody()), { params: Promise.resolve({ id: "activity-1" }) });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      duplicate: true,
      messageId: "message-winner",
      notified: 4,
      pushPending: true,
    });
    expect(mocks.enqueuePush).not.toHaveBeenCalled();
  });

  it("locks first, uses only the transaction client, commits the snapshot, then starts push", async () => {
    const order: string[] = [];
    let inTransaction = false;
    mocks.queryRaw.mockImplementation(async () => {
      expect(inTransaction).toBe(true);
      order.push("lock");
      return [{ id: "activity-1" }];
    });
    mocks.messageFindFirst.mockImplementation(async () => {
      expect(inTransaction).toBe(true);
      order.push("idempotency");
      return null;
    });
    mocks.activityFindFirst.mockImplementation(async () => {
      expect(inTransaction).toBe(true);
      order.push("activity");
      return activity();
    });
    mocks.guardianFindMany.mockImplementation(async () => {
      expect(inTransaction).toBe(true);
      order.push("guardians");
      return [{ id: "guardian-account-1" }];
    });
    mocks.userFindMany.mockImplementation(async () => {
      expect(inTransaction).toBe(true);
      order.push("staff");
      return [{ id: "user-1" }];
    });
    mocks.messageCreate.mockImplementation(async (args) => {
      expect(inTransaction).toBe(true);
      order.push("message+recipients");
      return {
        id: "message-locked",
        recipients: args.data.recipients.create.map((recipient: Record<string, unknown>) => ({
          schoolId: args.data.schoolId,
          guardianAccountId: recipient.guardianAccountId ?? null,
          userId: recipient.userId ?? null,
        })),
      };
    });
    mocks.transaction.mockImplementation(async (callback: (tx: unknown) => unknown) => {
      inTransaction = true;
      try {
        const result = await callback(transactionClient());
        order.push("commit");
        return result;
      } finally {
        inTransaction = false;
      }
    });
    mocks.enqueuePush.mockImplementation(async () => {
      expect(inTransaction).toBe(false);
      order.push("push");
      return 1;
    });

    const response = await POST(request(sendBody()), { params: Promise.resolve({ id: "activity-1" }) });
    expect(response.status).toBe(201);
    expect(order.slice(0, 7)).toEqual([
      "lock", "idempotency", "activity", "guardians", "staff", "message+recipients", "commit",
    ]);
    expect(order.indexOf("push")).toBeGreaterThan(order.indexOf("commit"));
    const lockQuery = mocks.queryRaw.mock.calls[0][0];
    expect(lockQuery.strings.join("?")).toContain('WHERE "id" = ? AND "schoolId" = ?');
    expect(lockQuery.values).toEqual(["activity-1", "school-a"]);
  });

  it("returns 409 when the update wins before an old-version send", async () => {
    let currentVersion = VERSION_1;
    mocks.activityFindFirst.mockImplementation(async (args) => {
      if (args?.select?.startDate) {
        return {
          id: "activity-1",
          schoolId: "school-a",
          startDate: new Date("2026-09-10T00:00:00.000Z"),
          endDate: new Date("2026-09-10T00:00:00.000Z"),
          allDay: true,
          updatedAt: new Date(currentVersion),
        };
      }
      return activity(currentVersion);
    });
    mocks.activityUpdate.mockImplementation(async (args) => {
      currentVersion = args.data.updatedAt.toISOString();
      return { id: "activity-1", name: "Updated activity", updatedAt: args.data.updatedAt };
    });

    const updated = await PUT(new Request("http://localhost/api/activities/activity-1", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "New message", classIds: ["class-new"] }),
    }), { params: Promise.resolve({ id: "activity-1" }) });
    expect(updated.status).toBe(200);

    const sent = await POST(request(sendBody()), { params: Promise.resolve({ id: "activity-1" }) });
    expect(sent.status).toBe(409);
    expect(mocks.messageCreate).not.toHaveBeenCalled();
    expect(mocks.enqueuePush).not.toHaveBeenCalled();
  });

  it("persists the old snapshot when send wins, then lets the update proceed", async () => {
    const sent = await POST(request(sendBody()), { params: Promise.resolve({ id: "activity-1" }) });
    expect(sent.status).toBe(201);
    const stored = mocks.messageCreate.mock.calls[0][0].data;
    expect(stored.targetRevision).toEqual(new Date(VERSION_1));
    expect(stored.recipients.create).toHaveLength(4);

    mocks.activityFindFirst.mockResolvedValueOnce({
      id: "activity-1",
      schoolId: "school-a",
      startDate: new Date("2026-09-10T00:00:00.000Z"),
      endDate: new Date("2026-09-10T00:00:00.000Z"),
      allDay: true,
      updatedAt: new Date(VERSION_1),
    });
    const updated = await PUT(new Request("http://localhost/api/activities/activity-1", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ teacherId: "teacher-new", classIds: ["class-new"] }),
    }), { params: Promise.resolve({ id: "activity-1" }) });
    expect(updated.status).toBe(200);
    expect(mocks.queryRaw.mock.invocationCallOrder[0]).toBeLessThan(mocks.messageCreate.mock.invocationCallOrder[0]);
    expect(mocks.queryRaw.mock.invocationCallOrder[1]).toBeLessThan(mocks.activityUpdate.mock.invocationCallOrder[0]);
  });

  it("serializes two matching concurrent requests into one message and one push batch", async () => {
    let tail = Promise.resolve();
    let stored: StoredSendResult | null = null;
    mocks.transaction.mockImplementation(async (callback: (tx: unknown) => unknown) => {
      const previous = tail;
      let release!: () => void;
      tail = new Promise<void>((resolve) => { release = resolve; });
      await previous;
      try {
        return await callback(transactionClient());
      } finally {
        release();
      }
    });
    mocks.messageFindFirst.mockImplementation(async () => stored);
    mocks.messageCreate.mockImplementation(async (args) => {
      stored = {
        id: "message-winner",
        requestHash: args.data.requestHash,
        guardianRecipientCount: args.data.guardianRecipientCount,
        staffRecipientCount: args.data.staffRecipientCount,
        pushQueuedCount: 0,
        pushFailureCount: 0,
        pushProcessedAt: null,
      };
      return {
        id: stored.id,
        recipients: args.data.recipients.create.map((recipient: Record<string, unknown>) => ({
          schoolId: args.data.schoolId,
          guardianAccountId: recipient.guardianAccountId ?? null,
          userId: recipient.userId ?? null,
        })),
      };
    });

    const responses = await Promise.all([
      POST(request(sendBody()), { params: Promise.resolve({ id: "activity-1" }) }),
      POST(request(sendBody()), { params: Promise.resolve({ id: "activity-1" }) }),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 201]);
    expect(mocks.messageCreate).toHaveBeenCalledTimes(1);
    expect(mocks.enqueuePush).toHaveBeenCalledTimes(4);
    expect(mocks.activityFindFirst).toHaveBeenCalledTimes(1);
  });

  it("returns the original snapshot after class membership changes", async () => {
    let stored: StoredSendResult | null = null;
    mocks.messageFindFirst.mockImplementation(async () => stored);
    mocks.messageCreate.mockImplementation(async (args) => {
      stored = {
        id: "message-original",
        requestHash: args.data.requestHash,
        guardianRecipientCount: args.data.guardianRecipientCount,
        staffRecipientCount: args.data.staffRecipientCount,
        pushQueuedCount: 4,
        pushFailureCount: 0,
        pushProcessedAt: new Date(),
      };
      return {
        id: stored.id,
        recipients: args.data.recipients.create.map((recipient: Record<string, unknown>) => ({
          schoolId: args.data.schoolId,
          guardianAccountId: recipient.guardianAccountId ?? null,
          userId: recipient.userId ?? null,
        })),
      };
    });
    const first = await POST(request(sendBody()), { params: Promise.resolve({ id: "activity-1" }) });
    expect(first.status).toBe(201);
    const audienceReads = mocks.guardianFindMany.mock.calls.length + mocks.userFindMany.mock.calls.length;
    const pushCalls = mocks.enqueuePush.mock.calls.length;

    mocks.activityFindFirst.mockResolvedValue(activity(VERSION_2));
    mocks.guardianFindMany.mockResolvedValue([{ id: "new-guardian" }]);
    const retry = await POST(request(sendBody()), { params: Promise.resolve({ id: "activity-1" }) });
    expect(retry.status).toBe(200);
    expect(await retry.json()).toMatchObject({
      duplicate: true,
      messageId: "message-original",
      guardianRecipients: 2,
      staffRecipients: 2,
    });
    expect(mocks.guardianFindMany.mock.calls.length + mocks.userFindMany.mock.calls.length).toBe(audienceReads);
    expect(mocks.enqueuePush).toHaveBeenCalledTimes(pushCalls);
  });

  it("rolls back a failed nested recipient snapshot and never starts push", async () => {
    let committed = false;
    mocks.messageCreate.mockRejectedValue(new Error("recipient insert failed"));
    mocks.transaction.mockImplementation(async (callback: (tx: unknown) => unknown) => {
      const result = await callback(transactionClient());
      committed = true;
      return result;
    });

    await expect(POST(request(sendBody()), { params: Promise.resolve({ id: "activity-1" }) }))
      .rejects.toThrow("recipient insert failed");
    expect(committed).toBe(false);
    expect(mocks.messageUpdate).not.toHaveBeenCalled();
    expect(mocks.enqueuePush).not.toHaveBeenCalled();
  });

  it("returns tenant-safe 404 when the activity row cannot be locked", async () => {
    mocks.queryRaw.mockResolvedValue([]);
    const response = await POST(request(sendBody()), { params: Promise.resolve({ id: "activity-other-school" }) });
    expect(response.status).toBe(404);
    expect(mocks.activityFindFirst).not.toHaveBeenCalled();
    expect(mocks.messageFindFirst).not.toHaveBeenCalled();
    expect(mocks.messageCreate).not.toHaveBeenCalled();
    expect(mocks.enqueuePush).not.toHaveBeenCalled();
  });
});
