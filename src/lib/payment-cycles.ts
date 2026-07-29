import { prisma } from "@/lib/prisma";

export async function generatePaymentCycles(studentId: string) {
  const student = await prisma.student.findUnique({ where: { id: studentId } });
  if (!student?.enrollment_date || !student?.enrollmentEndDate) return;

  const settings = await prisma.settings.findUnique({ where: { schoolId: student.schoolId } });
  const monthlyAmount = student.registration_fee > 0 ? student.registration_fee : (settings?.monthlyStudentFee ?? 0);
  if (!monthlyAmount || monthlyAmount <= 0) return;

  const cycles: { due_date: Date; cycle_number: number; amount: number }[] = [];

  const start = new Date(student.enrollment_date);
  const end = new Date(student.enrollmentEndDate);

  let current = new Date(start);
  let cycleNumber = 1;

  while (current <= end) {
    cycles.push({
      due_date: new Date(current),
      cycle_number: cycleNumber,
      amount: monthlyAmount,
    });
    current = new Date(current);
    current.setMonth(current.getMonth() + 1);
    cycleNumber++;
  }

  await prisma.paymentCycle.deleteMany({ where: { student_id: studentId } });

  if (cycles.length > 0) {
    await prisma.paymentCycle.createMany({
      data: cycles.map((c) => ({
        school_id: student.schoolId,
        student_id: studentId,
        due_date: c.due_date,
        amount: c.amount,
        cycle_number: c.cycle_number,
        status: "بانتظار الدفع",
      })),
    });
  }
}
