import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { assertTeachersOwned, CrossTenantError } from "@/lib/tenant-guard";

describe("class teacher tenant validation", () => {
  it("deduplicates teachers without changing the manager's selected order", async () => {
    const findMany = vi.fn().mockResolvedValue([
      { id: "teacher-2" },
      { id: "teacher-1" },
    ]);

    const result = await assertTeachersOwned(
      ["teacher-1", "teacher-2", "teacher-1"],
      "school-a",
      { teacher: { findMany } } as never
    );

    expect(result).toEqual(["teacher-1", "teacher-2"]);
    expect(findMany).toHaveBeenCalledWith({
      where: {
        id: { in: ["teacher-1", "teacher-2"] },
        schoolId: "school-a",
        deletedAt: null,
      },
      select: { id: true },
    });
  });

  it("rejects the entire assignment when any teacher is outside the school", async () => {
    const findMany = vi.fn().mockResolvedValue([{ id: "teacher-1" }]);

    await expect(assertTeachersOwned(
      ["teacher-1", "teacher-other-school"],
      "school-a",
      { teacher: { findMany } } as never
    )).rejects.toBeInstanceOf(CrossTenantError);
  });
});
