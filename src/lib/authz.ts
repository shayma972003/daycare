/**
 * Explicit permission checks for routes that need more than the table gives.
 *
 * The default path is declarative: `src/lib/route-permissions.ts` maps each
 * endpoint to a permission and `requireSession()` enforces it, so a route needs
 * no authorisation code of its own. This module is for the cases the table
 * cannot express — a permission that depends on the *contents* of the request
 * rather than its URL, such as "may edit this child only if she is in your
 * class".
 *
 * Prefer the table. A check written here is invisible to anyone reading the
 * table and easy to forget when the route is copied.
 */

import { requireSession, ForbiddenError, type AuthSession } from "@/lib/session";

export { sessionErrorResponse } from "@/lib/session";

/**
 * Asserts an extra permission on top of whatever the route table already
 * required.
 *
 *     const session = await requireSession();
 *     assertCan(session, "students.delete");
 */
export function assertCan(session: AuthSession, permission: string): void {
  if (!session.can(permission)) {
    throw new ForbiddenError(permission);
  }
}

/**
 * Wraps a handler so the try/catch is not the caller's problem.
 *
 * Forgetting that catch turns a permission denial into a 500, which reads as a
 * bug rather than a refusal.
 */
export function withPermission<Args extends unknown[]>(
  permission: string | null,
  handler: (
    request: Request,
    session: AuthSession,
    ...args: Args
  ) => Promise<Response>
) {
  return async (request: Request, ...args: Args): Promise<Response> => {
    let session: AuthSession;
    try {
      session = await requireSession();
      if (permission) assertCan(session, permission);
    } catch (error) {
      const { sessionErrorResponse } = await import("@/lib/session");
      const response = sessionErrorResponse(error);
      if (response) return response;
      throw error;
    }
    return handler(request, session, ...args);
  };
}
