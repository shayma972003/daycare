import { requireSession, sessionErrorResponse } from "@/lib/session";

/**
 * Who the caller is and what they may do.
 *
 * The permission list is not in the JWT on purpose. `requireSession()` re-reads
 * it from the database on every request, so a role edited at 09:00 takes effect
 * at 09:00 — putting the list in a self-contained token would leave it stale
 * until the token expired, and the product already refuses a session whose
 * permissions have drifted.
 *
 * Read by the sidebar and the command palette, which must not offer a screen the
 * server will refuse. That is presentation only: every route still enforces its
 * own requirement from `route-permissions.ts`. Hiding a link is a courtesy, not
 * a control.
 */
export async function GET() {
  let session;
  try {
    session = await requireSession();
  } catch (error) {
    return (
      sessionErrorResponse(error) ??
      Response.json({ error: "Unauthorized" }, { status: 401 })
    );
  }

  return Response.json({
    id: session.user.id,
    name: session.user.name,
    role: session.user.role,
    schoolName: session.user.schoolName,
    permissions: session.permissions,
  });
}
