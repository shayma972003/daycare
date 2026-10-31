import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  log: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { systemJobRun: { create: mocks.create, update: mocks.update } },
}));
vi.mock("@/lib/safe-logger", () => ({ logSafeError: mocks.log }));

import { withSystemJobRun } from "@/lib/system-job-run";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.create.mockResolvedValue({ id: "run-1" });
  mocks.update.mockResolvedValue({ id: "run-1" });
});

describe("scheduled job health tracking", () => {
  it("records a successful run without storing its result payload", async () => {
    await expect(withSystemJobRun("push_queue", async () => ({ sent: 4 }))).resolves.toEqual({ sent: 4 });

    expect(mocks.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ jobKey: "push_queue", status: "RUNNING" }),
      select: { id: true },
    });
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: "run-1" },
      data: expect.objectContaining({ status: "SUCCEEDED" }),
    });
    expect(JSON.stringify(mocks.update.mock.calls)).not.toContain("sent");
  });

  it("records a generic failure code and rethrows the original error", async () => {
    const failure = new Error("provider response containing private details");

    await expect(withSystemJobRun("care_digest", async () => { throw failure; })).rejects.toBe(failure);

    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: "run-1" },
      data: expect.objectContaining({ status: "FAILED", errorCode: "JOB_FAILED" }),
    });
    expect(JSON.stringify(mocks.update.mock.calls)).not.toContain(failure.message);
  });

  it("does not stop the scheduled job if health tracking is unavailable", async () => {
    mocks.create.mockRejectedValue(new Error("table unavailable"));

    await expect(withSystemJobRun("purge_trash", async () => "done")).resolves.toBe("done");

    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.log).toHaveBeenCalled();
  });
});
