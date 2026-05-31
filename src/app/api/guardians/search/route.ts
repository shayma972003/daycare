import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const searchSchema = z.object({
  query: z.string().min(1),
});

export async function POST(request: Request) {
  let session;
  try {
    session = await requireSession();
  } catch {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const schoolId = (session.user as { schoolId: string }).schoolId;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = searchSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 422 });
  }

  const { query } = parsed.data;

  const guardians = await prisma.guardian.findMany({
    where: {
      schoolId,
      OR: [
        { name: { contains: query, mode: "insensitive" } },
        { phone1: { contains: query, mode: "insensitive" } },
        { phone2: { contains: query, mode: "insensitive" } },
        { email: { contains: query, mode: "insensitive" } },
      ],
    },
    select: { id: true, name: true, phone1: true, phone2: true, email: true },
    take: 10,
  });

  return Response.json(guardians, { status: 200 });
}
