import { prisma } from "@/lib/prisma";
import { getAttendancePageData } from "@/lib/attendance-data";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ school_id: string }> }
) {
  const { school_id } = await params;

  const school = await prisma.school.findUnique({
    where: { id: school_id },
    select: { id: true, name: true, logoUrl: true },
  });
  if (!school) {
    return Response.json({ error: "School not found" }, { status: 404 });
  }

  const data = await getAttendancePageData(school_id);
  return Response.json({ school, ...data });
}
