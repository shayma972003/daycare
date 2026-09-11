import { z } from "zod";
import { logAction } from "@/lib/activity-logger";
import { astDateOnly } from "@/lib/datetime";
import { prisma } from "@/lib/prisma";
import { requireSession, sessionErrorResponse } from "@/lib/session";

const schema = z.object({
  openingBalance: z.number().finite().min(-1_000_000_000).max(1_000_000_000),
  openingBalanceDate: z.iso.date().nullable(),
}).superRefine((value, ctx) => {
  if (value.openingBalance !== 0 && !value.openingBalanceDate) {
    ctx.addIssue({ code: "custom", path: ["openingBalanceDate"], message: "Opening balance date is required" });
  }
  if (value.openingBalanceDate && new Date(`${value.openingBalanceDate}T00:00:00Z`) > astDateOnly()) {
    ctx.addIssue({ code: "custom", path: ["openingBalanceDate"], message: "Opening balance date cannot be in the future" });
  }
});

export async function GET() {
  let session;
  try { session = await requireSession(); }
  catch (error) { return sessionErrorResponse(error) ?? Response.json({ error: "Unauthorized" }, { status: 401 }); }
  const profile = await prisma.financeProfile.findUnique({ where: { school_id: session.user.schoolId } });
  return Response.json(profile ?? { opening_balance: 0, opening_balance_date: null, updated_at: null });
}

export async function PUT(request: Request) {
  let session;
  try { session = await requireSession(); }
  catch (error) { return sessionErrorResponse(error) ?? Response.json({ error: "Unauthorized" }, { status: 401 }); }
  let body: unknown;
  try { body = await request.json(); }
  catch { return Response.json({ error: "Invalid JSON" }, { status: 400 }); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 422 });

  const openingDate = parsed.data.openingBalanceDate
    ? new Date(`${parsed.data.openingBalanceDate}T00:00:00Z`)
    : null;
  const profile = await prisma.financeProfile.upsert({
    where: { school_id: session.user.schoolId },
    create: {
      school_id: session.user.schoolId,
      opening_balance: parsed.data.openingBalance,
      opening_balance_date: openingDate,
    },
    update: {
      opening_balance: parsed.data.openingBalance,
      opening_balance_date: openingDate,
    },
  });
  await logAction({
    school_id: session.user.schoolId,
    action: "تحديث الرصيد الافتتاحي",
    entity_type: "finance_profile",
    entity_id: profile.id,
    performed_by: session.user.name ?? "المدير",
    request,
  });
  return Response.json(profile);
}
