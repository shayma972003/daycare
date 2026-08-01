import { z } from "zod";

/**
 * Central environment validation.
 *
 * Secrets have no fallbacks — a missing or weak secret must fail loudly at boot
 * rather than silently degrade to a guessable default. Feature-flag vars
 * (email, WhatsApp) are optional: the app runs without them, the feature no-ops.
 */

const secret = (name: string) =>
  z
    .string({ error: `${name} is required` })
    .min(32, `${name} must be at least 32 characters (openssl rand -base64 32)`);

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  // ─── Required ──────────────────────────────────────────────────────────────
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  NEXTAUTH_SECRET: secret("NEXTAUTH_SECRET"),
  NEXTAUTH_URL: z.string().url("NEXTAUTH_URL must be a valid URL"),
  ADMIN_JWT_SECRET: secret("ADMIN_JWT_SECRET"),
  CRON_SECRET: secret("CRON_SECRET"),
  NEXT_PUBLIC_APP_URL: z.string().url("NEXT_PUBLIC_APP_URL must be a valid URL"),

  // ─── Email (Resend) ────────────────────────────────────────────────────────
  RESEND_API_KEY: z.string().optional(),
  FROM_EMAIL: z.string().email().optional(),

  // ─── WhatsApp (Twilio) — disabled by default, kept for a future release ────
  ENABLE_WHATSAPP: z
    .string()
    .optional()
    .transform((v) => v === "true"),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_WHATSAPP_FROM: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

/**
 * `next build` collects pages without real secrets in some setups. Validation is
 * skipped only for that phase — never at runtime.
 */
const isBuildPhase = process.env.NEXT_PHASE === "phase-production-build";

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  • ${i.path.join(".")}: ${i.message}`)
      .join("\n");

    if (isBuildPhase) {
      console.warn(`⚠️  Environment validation skipped during build:\n${issues}`);
      return process.env as unknown as Env;
    }

    throw new Error(
      `\n❌ Invalid environment configuration:\n${issues}\n\n` +
        `Copy .env.example to .env and fill in the missing values.\n`
    );
  }

  return parsed.data;
}

export const env = loadEnv();

/** Email delivery is configured and usable. */
export const emailEnabled = Boolean(env.RESEND_API_KEY && env.FROM_EMAIL);

/** WhatsApp delivery is explicitly enabled *and* fully configured. */
export const whatsappEnabled = Boolean(
  env.ENABLE_WHATSAPP &&
    env.TWILIO_ACCOUNT_SID &&
    env.TWILIO_AUTH_TOKEN &&
    env.TWILIO_WHATSAPP_FROM
);
