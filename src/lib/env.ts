import { z } from "zod";

/**
 * Central environment validation.
 *
 * Two tiers, deliberately:
 *
 *  - Required — the app cannot serve a single request without them, so a missing
 *    value fails loudly at boot. Critically, secrets have *no fallbacks*: a
 *    guessable default is worse than a crash, because it looks like it works.
 *
 *  - Optional — gate one feature each. Missing values degrade that feature to a
 *    no-op and log a warning; they never take the whole app down.
 */

const MIN_SECRET_LENGTH = 32;

const requiredSecret = (name: string) =>
  z.string({ error: `${name} is required — the app will not start without it` }).min(1);

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  // ─── Required ──────────────────────────────────────────────────────────────
  DATABASE_URL: z.string({ error: "DATABASE_URL is required" }).min(1),
  NEXTAUTH_SECRET: requiredSecret("NEXTAUTH_SECRET"),
  NEXTAUTH_URL: z.string({ error: "NEXTAUTH_URL is required" }).url(),
  ADMIN_JWT_SECRET: requiredSecret("ADMIN_JWT_SECRET"),

  // ─── Optional — each gates exactly one feature ─────────────────────────────
  /** Scheduled jobs reject every request while unset (fail-closed). */
  CRON_SECRET: z.string().optional(),

  /** Email delivery: OTP, password reset, reminders. Both must be set. */
  RESEND_API_KEY: z.string().optional(),
  FROM_EMAIL: z.string().email().optional(),

  /** Public links in outbound messages. Falls back to NEXTAUTH_URL. */
  NEXT_PUBLIC_APP_URL: z.string().url().optional(),

  // ─── WhatsApp (Twilio) — off unless explicitly enabled ─────────────────────
  ENABLE_WHATSAPP: z
    .string()
    .optional()
    .transform((v) => v === "true"),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_WHATSAPP_FROM: z.string().optional(),
});

type ParsedEnv = z.infer<typeof envSchema>;
export type Env = ParsedEnv & { APP_URL: string };

/** `next build` may collect pages without runtime secrets — skip only that phase. */
const isBuildPhase = process.env.NEXT_PHASE === "phase-production-build";

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  • ${i.path.join(".")}: ${i.message}`)
      .join("\n");

    if (isBuildPhase) {
      console.warn(`⚠️  Environment validation skipped during build:\n${issues}`);
      return { ...(process.env as unknown as ParsedEnv), APP_URL: "" };
    }

    throw new Error(
      `\n❌ Invalid environment configuration:\n${issues}\n\n` +
        `Copy .env.example to .env and fill in the missing values.\n`
    );
  }

  const value = parsed.data;

  // Warn rather than crash: an existing deployment may hold a shorter secret,
  // and taking the site down is a worse outcome than flagging it for rotation.
  for (const name of ["NEXTAUTH_SECRET", "ADMIN_JWT_SECRET"] as const) {
    if (value[name].length < MIN_SECRET_LENGTH) {
      console.warn(
        `⚠️  ${name} is only ${value[name].length} characters. Rotate it to at least ` +
          `${MIN_SECRET_LENGTH}: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`
      );
    }
  }

  if (!value.RESEND_API_KEY || !value.FROM_EMAIL) {
    console.warn(
      "⚠️  RESEND_API_KEY / FROM_EMAIL not set — email is the only notification " +
        "channel, so OTP, password reset and reminders will not be delivered."
    );
  }

  if (!value.CRON_SECRET) {
    console.warn("⚠️  CRON_SECRET not set — scheduled jobs will reject every request.");
  }

  return { ...value, APP_URL: value.NEXT_PUBLIC_APP_URL ?? value.NEXTAUTH_URL };
}

export const env = loadEnv();

/** Email delivery is configured and usable. */
export const emailEnabled = Boolean(env.RESEND_API_KEY && env.FROM_EMAIL);

/** WhatsApp is explicitly enabled *and* fully configured. */
export const whatsappEnabled = Boolean(
  env.ENABLE_WHATSAPP &&
    env.TWILIO_ACCOUNT_SID &&
    env.TWILIO_AUTH_TOKEN &&
    env.TWILIO_WHATSAPP_FROM
);
