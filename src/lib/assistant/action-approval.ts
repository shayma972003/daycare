import "server-only";

import { createHmac, randomUUID, timingSafeEqual } from "crypto";
import { z } from "zod";
import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";

const APPROVAL_TTL_MS = 5 * 60_000;
const APPROVAL_PREFIX = "assistant-approval:";

const envelopeSchema = z.object({
  version: z.literal(1),
  nonce: z.string().uuid(),
  schoolId: z.string().min(1),
  userId: z.string().min(1),
  tool: z.string().min(1).max(100),
  args: z.record(z.string(), z.unknown()),
  issuedAt: z.number().int().positive(),
  expiresAt: z.number().int().positive(),
}).strict();

export type AssistantApprovalEnvelope = z.infer<typeof envelopeSchema>;

function signature(payload: string): string {
  return createHmac("sha256", env.NEXTAUTH_SECRET).update(payload).digest("base64url");
}

function tokenFor(envelope: AssistantApprovalEnvelope): string {
  const payload = Buffer.from(JSON.stringify(envelope), "utf8").toString("base64url");
  return `${payload}.${signature(payload)}`;
}

function parseToken(token: string): AssistantApprovalEnvelope | null {
  const separator = token.lastIndexOf(".");
  if (separator < 1) return null;
  const payload = token.slice(0, separator);
  const received = Buffer.from(token.slice(separator + 1));
  const expected = Buffer.from(signature(payload));
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) return null;

  try {
    return envelopeSchema.parse(JSON.parse(Buffer.from(payload, "base64url").toString("utf8")));
  } catch {
    return null;
  }
}

/**
 * Creates a short-lived, server-verifiable proposal. The nonce is persisted in
 * the existing shared ephemeral store so confirmation is single-use even when
 * requests land on different serverless instances.
 */
export async function issueAssistantApproval(input: {
  schoolId: string;
  userId: string;
  tool: string;
  args: Record<string, unknown>;
}): Promise<{ token: string; expiresAt: Date }> {
  const now = Date.now();
  const envelope: AssistantApprovalEnvelope = {
    version: 1,
    nonce: randomUUID(),
    schoolId: input.schoolId,
    userId: input.userId,
    tool: input.tool,
    args: input.args,
    issuedAt: now,
    expiresAt: now + APPROVAL_TTL_MS,
  };
  await prisma.rateLimit.create({
    data: {
      key: `${APPROVAL_PREFIX}${envelope.nonce}`,
      count: 0,
      expiresAt: new Date(envelope.expiresAt),
    },
  });
  return { token: tokenFor(envelope), expiresAt: new Date(envelope.expiresAt) };
}

/** Verifies actor, tenant, expiry and signature, then atomically burns the nonce. */
export async function consumeAssistantApproval(input: {
  token: string;
  schoolId: string;
  userId: string;
}): Promise<AssistantApprovalEnvelope | null> {
  const envelope = parseToken(input.token);
  const now = new Date();
  if (
    !envelope ||
    envelope.schoolId !== input.schoolId ||
    envelope.userId !== input.userId ||
    envelope.expiresAt <= now.getTime()
  ) {
    return null;
  }

  const consumed = await prisma.rateLimit.deleteMany({
    where: {
      key: `${APPROVAL_PREFIX}${envelope.nonce}`,
      expiresAt: { gte: now },
    },
  });
  return consumed.count === 1 ? envelope : null;
}

