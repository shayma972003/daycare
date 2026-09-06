import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  lockActivitiesForClassTargetChange,
  lockActivitiesForTeacherTargetChange,
  lockActivityForUpdate,
  touchActivityTargetRevisions,
} from "@/lib/activity-lock";

const queryRaw = vi.fn();
const executeRaw = vi.fn();
const tx = { $queryRaw: queryRaw, $executeRaw: executeRaw } as never;

beforeEach(() => {
  vi.clearAllMocks();
  executeRaw.mockResolvedValue(2);
});

describe("activity target row locks", () => {
  it("locks one activity with parameterized id and tenant predicates", async () => {
    queryRaw.mockResolvedValue([{ id: "activity-1" }]);
    await expect(lockActivityForUpdate(tx, { id: "activity-1", schoolId: "school-a" })).resolves.toBe(true);

    const statement = queryRaw.mock.calls[0][0];
    expect(statement.strings.join("?")).toContain('WHERE "id" = ? AND "schoolId" = ?');
    expect(statement.strings.join(" ")).toContain("FOR UPDATE");
    expect(statement.values).toEqual(["activity-1", "school-a"]);
  });

  it("locks class-target activities in id order before advancing their revisions", async () => {
    queryRaw.mockResolvedValue([{ id: "activity-a" }, { id: "activity-b" }]);
    const ids = await lockActivitiesForClassTargetChange(tx, { classId: "class-1", schoolId: "school-a" });
    await touchActivityTargetRevisions(tx, { activityIds: ids, schoolId: "school-a" });

    const lockStatement = queryRaw.mock.calls[0][0];
    expect(lockStatement.strings.join(" ")).toContain("ORDER BY");
    expect(lockStatement.strings.join(" ")).toContain("FOR UPDATE OF activity");
    expect(lockStatement.values).toEqual(["class-1", "school-a"]);
    expect(executeRaw.mock.invocationCallOrder[0]).toBeGreaterThan(queryRaw.mock.invocationCallOrder[0]);
    const touchStatement = executeRaw.mock.calls[0][0];
    expect(touchStatement.strings.join(" ")).toContain("GREATEST");
    expect(touchStatement.values).toEqual(["school-a", "activity-a", "activity-b"]);
  });

  it("locks teacher-target activities in id order", async () => {
    queryRaw.mockResolvedValue([{ id: "activity-a" }]);
    await expect(lockActivitiesForTeacherTargetChange(tx, {
      teacherId: "teacher-1",
      schoolId: "school-a",
    })).resolves.toEqual(["activity-a"]);

    const statement = queryRaw.mock.calls[0][0];
    expect(statement.strings.join(" ")).toContain('WHERE "teacherId" =');
    expect(statement.strings.join(" ")).toContain("ORDER BY");
    expect(statement.strings.join(" ")).toContain("FOR UPDATE");
    expect(statement.values).toEqual(["teacher-1", "school-a"]);
  });
});
