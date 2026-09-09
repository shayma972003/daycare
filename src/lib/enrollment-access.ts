export const ENROLLMENT_MANAGE_PERMISSION = "students.manage" as const;

type PublicEnrollmentMethod = "GET" | "POST";

const PUBLIC_ENROLLMENT_ROUTES: ReadonlyArray<{
  matches: (pathname: string) => boolean;
  methods: readonly PublicEnrollmentMethod[];
}> = [
  {
    matches: (pathname) => /^\/api\/enrollment\/verify-token\/[^/]+$/.test(pathname),
    methods: ["GET"],
  },
  {
    matches: (pathname) => pathname === "/api/enrollment/submit",
    methods: ["POST"],
  },
  {
    matches: (pathname) => pathname === "/api/enrollment/upload",
    methods: ["POST"],
  },
];

/**
 * The only enrollment endpoints a parent may reach without a dashboard session.
 *
 * Matching is exact (apart from the token segment) and method-aware. A new
 * administrative endpoint under `/api/enrollment` is therefore protected by
 * default instead of inheriting a broad public prefix.
 */
export function isPublicEnrollmentRoute(pathname: string, method: string): boolean {
  const cleanPath = pathname.split("?")[0].replace(/\/+$/, "") || "/";
  const verb = method.toUpperCase();

  return PUBLIC_ENROLLMENT_ROUTES.some(
    (route) => route.matches(cleanPath) && route.methods.includes(verb as PublicEnrollmentMethod)
  );
}
