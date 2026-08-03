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

/**
 * An unset variable and one set to "" mean the same thing here.
 * `.env` files and hosting dashboards both hand back empty strings, and without
 * this an empty FROM_EMAIL fails `.email()` and takes the whole app down.
 */
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (v === "" ? undefined : v), schema.optional());

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  // ─── Required ──────────────────────────────────────────────────────────────
  DATABASE_URL: z.string({ error: "DATABASE_URL is required" }).min(1),
  NEXTAUTH_SECRET: requiredSecret("NEXTAUTH_SECRET"),
  NEXTAUTH_URL: z.string({ error: "NEXTAUTH_URL is required" }).url(),
  ADMIN_JWT_SECRET: requiredSecret("ADMIN_JWT_SECRET"),

  // ─── Optional — each gates exactly one feature ─────────────────────────────
  /** Scheduled jobs reject every request while unset (fail-closed). */
  CRON_SECRET: optional(z.string()),

  /**
   * Email delivery: OTP, password reset, reminders.
   *
   * Two interchangeable backends — whichever is configured wins, Resend first.
   * SMTP needs no domain and no company registration, so a plain Gmail app
   * password is enough to start; swapping to Resend later is config-only.
   */
  FROM_EMAIL: optional(z.string().email()),
  RESEND_API_KEY: optional(z.string()),
  SMTP_HOST: optional(z.string()),
  SMTP_PORT: optional(z.coerce.number().int().positive()),
  SMTP_USER: optional(z.string()),
  SMTP_PASSWORD: optional(z.string()),

  /** Public links in outbound messages. Falls back to NEXTAUTH_URL. */
  NEXT_PUBLIC_APP_URL: optional(z.string().url()),

  // ─── Monitoring — every one optional, the app runs without them ───────────
  /**
   * Sentry. Public by design: a DSN is embedded in the browser bundle and is not
   * a credential — it can only be used to *send* events, not read them.
   */
  NEXT_PUBLIC_SENTRY_DSN: optional(z.string().url()),
  /** Source-map upload at build time. Absent means traces stay minified. */
  SENTRY_AUTH_TOKEN: optional(z.string()),
  SENTRY_ORG: optional(z.string()),
  SENTRY_PROJECT: optional(z.string()),
  /** Any endpoint accepting JSON — a Slack webhook, typically. */
  ERROR_WEBHOOK_URL: optional(z.string().url()),

  // ─── Cloudflare R2 — object storage for uploads ────────────────────────────
  /**
   * All four or none. Without them uploads fall back to base64-in-column, which
   * still works — so a missing key degrades one behaviour instead of taking the
   * app down. `storageEnabled` below is the single check every caller uses.
   */
  R2_ACCOUNT_ID: optional(z.string()),
  R2_ACCESS_KEY_ID: optional(z.string()),
  R2_SECRET_ACCESS_KEY: optional(z.string()),
  R2_BUCKET: optional(z.string()),

  // ─── WhatsApp (Twilio) — off unless explicitly enabled ─────────────────────
  ENABLE_WHATSAPP: z
    .string()
    .optional()
    .transform((v) => v === "true"),
  TWILIO_ACCOUNT_SID: optional(z.string()),
  TWILIO_AUTH_TOKEN: optional(z.string()),
  TWILIO_WHATSAPP_FROM: optional(z.string()),
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

  const hasResend = Boolean(value.RESEND_API_KEY);
  const hasSmtp = Boolean(value.SMTP_HOST && value.SMTP_USER && value.SMTP_PASSWORD);

  if (!value.FROM_EMAIL || (!hasResend && !hasSmtp)) {
    console.warn(
      "⚠️  No email backend configured — email is the only notification channel, " +
        "so OTP, password reset and reminders will not be delivered. Set FROM_EMAIL " +
        "plus either RESEND_API_KEY or SMTP_HOST/SMTP_USER/SMTP_PASSWORD."
    );
  }

  if (!value.CRON_SECRET) {
    console.warn("⚠️  CRON_SECRET not set — scheduled jobs will reject every request.");
  }

  return { ...value, APP_URL: value.NEXT_PUBLIC_APP_URL ?? value.NEXTAUTH_URL };
}

export const env = loadEnv();

/** Which backend `sendEmail` will use — the first one fully configured. */
export const emailProvider: "resend" | "smtp" | "none" = !env.FROM_EMAIL
  ? "none"
  : env.RESEND_API_KEY
    ? "resend"
    : env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASSWORD
      ? "smtp"
      : "none";

/** Email delivery is configured and usable. */
export const emailEnabled = emailProvider !== "none";

/**
 * Object storage is fully configured.
 *
 * All four or nothing: three-quarters of a credential set is not a working
 * bucket, and letting uploads *try* would give a runtime failure per upload
 * instead of one clear "not configured" at the seam.
 */
export const storageEnabled = Boolean(
  env.R2_ACCOUNT_ID && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY && env.R2_BUCKET
);

/** WhatsApp is explicitly enabled *and* fully configured. */
export const whatsappEnabled = Boolean(
  env.ENABLE_WHATSAPP &&
    env.TWILIO_ACCOUNT_SID &&
    env.TWILIO_AUTH_TOKEN &&
    env.TWILIO_WHATSAPP_FROM
);
