import { beforeEach, describe, expect, it, vi } from "vitest";

const studentFindFirst = vi.hoisted(() => vi.fn());

vi.mock("@/lib/prisma", () => ({
  prisma: { student: { findFirst: studentFindFirst } },
}));

import {
  classIdWhere,
  mayAccessClass,
  mayAccessStudent,
  scopedClassIds,
  studentClassWhere,
} from "@/lib/student-access-scope";

const manager = {
  teacherId: null,
  teacherClassIds: null,
  permissions: ["*"],
};

const teacher = {
  teacherId: "teacher-1",
  teacherClassIds: ["class-1", "class-2"],
  permissions: ["students.view"],
};

describe("teacher student access scope", () => {
  beforeEach(() => studentFindFirst.mockReset());

  it("keeps owners and office accounts school-wide", () => {
    expect(scopedClassIds(manager)).toBeNull();
    expect(studentClassWhere(manager)).toEqual({});
    expect(classIdWhere(manager)).toEqual({});
  });

  it("uses the exact assigned class set for a linked classroom account", () => {
    expect(scopedClassIds(teacher)).toEqual(["class-1", "class-2"]);
    expect(studentClassWhere(teacher)).toEqual({ classId: { in: ["class-1", "class-2"] } });
    expect(classIdWhere(teacher)).toEqual({ id: { in: ["class-1", "class-2"] } });
    expect(mayAccessClass(teacher, "class-2")).toBe(true);
    expect(mayAccessClass(teacher, "class-3")).toBe(false);
  });

  it("fails closed when a linked account has no loaded assignments", () => {
    const missingScope = {
      teacherId: "teacher-1",
      teacherClassIds: null,
      permissions: ["students.view"],
    };
    expect(scopedClassIds(missingScope)).toEqual([]);
    expect(mayAccessClass(missingScope, "class-1")).toBe(false);
  });

  it("includes tenant and class scope in direct child guards", async () => {
    studentFindFirst.mockResolvedValue({ id: "student-1" });

    await expect(mayAccessStudent(teacher, "student-1", "school-1")).resolves.toBe(true);
    expect(studentFindFirst).toHaveBeenCalledWith({
      where: {
        id: "student-1",
        schoolId: "school-1",
        classId: { in: ["class-1", "class-2"] },
      },
      select: { id: true },
    });
  });
});
