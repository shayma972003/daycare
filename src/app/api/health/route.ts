import { prisma } from "@/lib/prisma";

/**
 * Liveness and readiness probe.
 *
 * Public and unauthenticated by design — an uptime monitor cannot sign in — so
 * it reveals nothing beyond "the database answered". No counts, no version, no
 * tenant names: a health endpoint that leaks how many schools exist is a
 * business-intelligence endpoint for whoever is scanning.
 *
 * Neon suspends an idle compute, and the first query after that pays the wake-up
 * cost. `latencyMs` is here to make that visible rather than mysterious.
 */
export async function GET() {
  const startedAt = Date.now();

  try {
    await prisma.$queryRaw`SELECT 1`;
    return Response.json({
      status: "ok",
      latencyMs: Date.now() - startedAt,
    });
  } catch (error) {
    console.error("[health] database unreachable:", error);
    // 503, not 500: this is "not ready to serve", which is what a load balancer
    // and an uptime monitor both need to hear.
    return Response.json(
      { status: "degraded", latencyMs: Date.now() - startedAt },
      { status: 503 }
    );
  }
}
