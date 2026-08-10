import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireSession: vi.fn(),
  sessionErrorResponse: vi.fn(),
  findMany: vi.fn(),
  findFirst: vi.fn(),
  updateMany: vi.fn(),
  logAction: vi.fn(),
}));

vi.mock("@/lib/session", () => ({
  requireSession: mocks.requireSession,
  sessionErrorResponse: mocks.sessionErrorResponse,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    enrollmentSubmission: {
      findMany: mocks.findMany,
      findFirst: mocks.findFirst,
      updateMany: mocks.updateMany,
    },
  },
}));

vi.mock("@/lib/activity-logger", () => ({ logAction: mocks.logAction }));

import { GET as listSubmissions } from "@/app/api/enrollment/submissions/route";
import { POST as rejectSubmission } from "@/app/api/enrollment/reject/[submission_id]/route";

function session(allowed: boolean) {
  return {
    user: { id: "user-1", schoolId: "school-1", name: "Manager" },
    can: vi.fn((permission: string) => allowed && permission === "students.manage"),
  };
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.sessionErrorResponse.mockImplementation(() =>
    Response.json({ error: "Unauthorized" }, { status: 401 })
  );
});

describe("administrative enrollment handlers", () => {
  it("returns 401 before querying data when the caller is not signed in", async () => {
    mocks.requireSession.mockRejectedValue(new Error("no session"));

    const response = await listSubmissions();

    expect(response.status).toBe(401);
    expect(mocks.findMany).not.toHaveBeenCalled();
  });

  it("returns 403 before querying data when students.manage is missing", async () => {
    mocks.requireSession.mockResolvedValue(session(false));

    const response = await listSubmissions();

    expect(response.status).toBe(403);
    expect(mocks.findMany).not.toHaveBeenCalled();
  });

  it("lists only the permitted manager's school submissions", async () => {
    mocks.requireSession.mockResolvedValue(session(true));
    mocks.findMany.mockResolvedValue([{ id: "submission-1" }]);

    const response = await listSubmissions();

    expect(response.status).toBe(200);
    expect(mocks.findMany).toHaveBeenCalledWith({
      where: { school_id: "school-1", status: "pending_review" },
      orderBy: { submitted_at: "desc" },
    });
  });

  it("does not reveal or update a submission owned by another school", async () => {
    mocks.requireSession.mockResolvedValue(session(true));
    mocks.findFirst.mockResolvedValue(null);

    const response = await rejectSubmission(
      new Request("http://localhost/api/enrollment/reject/foreign", { method: "POST" }),
      { params: Promise.resolve({ submission_id: "foreign" }) }
    );

    expect(response.status).toBe(404);
    expect(mocks.findFirst).toHaveBeenCalledWith({
      where: { id: "foreign", school_id: "school-1" },
    });
    expect(mocks.updateMany).not.toHaveBeenCalled();
    expect(mocks.logAction).not.toHaveBeenCalled();
  });
});
