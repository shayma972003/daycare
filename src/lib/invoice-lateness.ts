import { prisma } from "@/lib/prisma";
import { astDateOnly, astParts } from "@/lib/datetime";
import { moneyNumber } from "@/lib/money";

export function invoiceMonthRange(at = new Date()) {
  const { year, month } = astParts(at);
  return {
    from: astDateOnly(new Date(Date.UTC(year, month, 1))),
    to: astDateOnly(new Date(Date.UTC(year, month + 1, 0))),
  };
}

export async function studentLatenessForInvoice(
  schoolId: string,
  studentId: string,
  at = new Date()
) {
  const period = invoiceMonthRange(at);
  const result = await prisma.attendance.aggregate({
    where: {
      schoolId,
      studentId,
      date: { gte: period.from, lte: period.to },
    },
    _sum: { lateMinutes: true, lateFee: true },
  });
  const lateMinutes = result._sum.lateMinutes ?? 0;
  return {
    ...period,
    lateMinutes,
    lateHours: lateMinutes / 60,
    lateFee: moneyNumber(result._sum.lateFee),
  };
}

export async function teacherLatenessForInvoice(
  schoolId: string,
  teacherId: string,
  at = new Date()
) {
  const period = invoiceMonthRange(at);
  const result = await prisma.teacherAttendance.aggregate({
    where: {
      schoolId,
      teacherId,
      compensated: false,
      date: { gte: period.from, lte: period.to },
    },
    _sum: { lateMinutes: true },
  });
  const lateMinutes = result._sum.lateMinutes ?? 0;
  return {
    ...period,
    lateMinutes,
    lateHours: lateMinutes / 60,
  };
}
