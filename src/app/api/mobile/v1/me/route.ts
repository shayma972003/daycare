import { prisma } from "@/lib/prisma";
import { requireMobileAuth, mobileAuthResponse, guardianChildIds } from "@/lib/mobile-guard";
import { stampFileUrl } from "@/lib/file-token";

/**
 * Who am I, and what may I see.
 *
 * The app calls this on launch to decide which tab bar to render. It is also the
 * smallest endpoint that exercises the whole chain — bearer token, claims,
 * account-kind branching, and the guardian scoping rule — so it is the one to
 * hit first when something is wrong.
 */
export async function GET(request: Request) {
  let context;
  try {
    context = await requireMobileAuth(request);
  } catch (error) {
    const response = mobileAuthResponse(error);
    if (response) return response;
    throw error;
  }

  if (context.claims.kind === "staff") {
    const user = await prisma.user.findUnique({
      where: { id: context.claims.sub },
      select: {
        id: true,
        name: true,
        email: true,
        teacherId: true,
        school: { select: { name: true } },
        roleRef: { select: { nameAr: true } },
      },
    });
    if (!user) return Response.json({ error: "الحساب لم يعد موجوداً" }, { status: 401 });

    return Response.json({
      kind: "staff",
      id: user.id,
      name: user.name,
      email: user.email,
      teacherId: user.teacherId,
      schoolName: user.school?.name ?? "",
      roleName: user.roleRef?.nameAr ?? null,
      permissions: context.claims.permissions ?? [],
    });
  }

  // Guardians see their own children and nothing else. The id list comes from
  // `guardianChildIds`, which is the single place that rule is expressed — see
  // the note there for why it is not repeated per endpoint.
  const childIds = await guardianChildIds(context.claims.sub);

  const [account, children] = await Promise.all([
    prisma.guardianAccount.findUnique({
      where: { id: context.claims.sub },
      select: {
        id: true,
        email: true,
        phone: true,
        guardian: { select: { name: true } },
        school: { select: { name: true } },
      },
    }),
    prisma.student.findMany({
      where: { id: { in: childIds } },
      select: {
        id: true,
        name: true,
        avatarUrl: true,
        period: true,
        class: { select: { id: true, name: true } },
      },
      orderBy: { name: "asc" },
    }),
  ]);

  if (!account) return Response.json({ error: "الحساب لم يعد موجوداً" }, { status: 401 });

  return Response.json({
    kind: "guardian",
    id: account.id,
    name: account.guardian.name,
    email: account.email,
    phone: account.phone,
    schoolName: account.school?.name ?? "",
    // Stamped even though the app *can* send a bearer token: an image component
    // that attaches headers is the exception on both platforms, not the default,
    // and a grant works either way.
    children: children.map((child) => ({
      ...child,
      avatarUrl: stampFileUrl(child.avatarUrl),
    })),
  });
}
