"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import axios from "axios";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { PasswordRules } from "@/components/ui/PasswordRules";
import { passwordSchema } from "@/lib/password-policy";
import { useT } from "@/lib/i18n-provider";

/**
 * Built per render rather than once at module load: the messages are
 * translated, and a module-level schema would freeze them to whichever
 * language was active when this file was first imported.
 */
function buildRegisterSchema(t: (key: string) => string) {
  return z
    .object({
      schoolName: z.string().min(1, t("auth.schoolNameRequired")),
      email: z.string().email(t("auth.invalidEmail")),
      // Shared with the server route, so the two cannot drift apart.
      password: passwordSchema,
      confirmPassword: z.string().min(1, t("auth.confirmRequired")),
    })
    .refine((d) => d.password === d.confirmPassword, {
      message: t("auth.passwordsDiffer"),
      path: ["confirmPassword"],
    });
}

type RegisterFormValues = z.infer<ReturnType<typeof buildRegisterSchema>>;

export default function RegisterPage() {
  const t = useT();
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<RegisterFormValues>({ resolver: zodResolver(buildRegisterSchema(t)) });

  const passwordValue = watch("password");

  async function onSubmit(data: RegisterFormValues) {
    setServerError(null);
    try {
      await axios.post("/api/auth/register", data);
      router.push("/login?registered=1");
    } catch (err) {
      if (axios.isAxiosError(err)) {
        const msg = err.response?.data?.error;
        setServerError(typeof msg === "string" ? msg : t("auth.genericError"));
      } else {
        setServerError(t("auth.genericError"));
      }
    }
  }

  return (
    <div dir="rtl" className="min-h-screen bg-[#1a2340] flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo + title */}
        <div className="flex flex-col items-center mb-8 gap-3">
          <div className="w-16 h-16 bg-white/10 rounded-2xl border-2 border-white/20" />
          <h1 className="text-white text-xl font-bold tracking-wide">{t("auth.appName")}</h1>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl shadow-2xl p-8">
          <h2 className="text-lg font-bold text-[#1a2340] mb-6 text-center">{t("auth.registerTitle")}</h2>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
            {/* School name */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                {t("auth.schoolName")}
              </label>
              <input
                {...register("schoolName")}
                type="text"
                placeholder={t("auth.schoolNamePlaceholder")}
                className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#1a2340] focus:border-transparent text-sm transition-all"
              />
              {errors.schoolName && (
                <p className="mt-1 text-xs text-red-600">{errors.schoolName.message}</p>
              )}
            </div>

            {/* Email */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                {t("fields.email")}
              </label>
              <input
                {...register("email")}
                type="email"
                placeholder="admin@school.com"
                dir="ltr"
                className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#1a2340] focus:border-transparent text-sm transition-all"
              />
              {errors.email && (
                <p className="mt-1 text-xs text-red-600">{errors.email.message}</p>
              )}
            </div>

            {/* Password */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                {t("fields.password")}
              </label>
              <div className="relative">
                <input
                  {...register("password")}
                  type={showPassword ? "text" : "password"}
                  placeholder="••••••••"
                  dir="ltr"
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#1a2340] focus:border-transparent text-sm transition-all pr-12"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs font-medium transition-colors"
                >
                  {showPassword ? t("fields.hide") : t("fields.show")}
                </button>
              </div>
              {errors.password && (
                <p className="mt-1 text-xs text-red-600">{errors.password.message}</p>
              )}
              {/* Shown while typing rather than after a failed submit — see the
                  note in PasswordRules. */}
              <PasswordRules value={passwordValue ?? ""} />
            </div>

            {/* Confirm password */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                {t("auth.confirmPassword")}
              </label>
              <div className="relative">
                <input
                  {...register("confirmPassword")}
                  type={showConfirm ? "text" : "password"}
                  placeholder="••••••••"
                  dir="ltr"
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#1a2340] focus:border-transparent text-sm transition-all pr-12"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirm((v) => !v)}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs font-medium transition-colors"
                >
                  {showConfirm ? t("fields.hide") : t("fields.show")}
                </button>
              </div>
              {errors.confirmPassword && (
                <p className="mt-1 text-xs text-red-600">{errors.confirmPassword.message}</p>
              )}
            </div>

            {/* Server error */}
            {serverError && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700 text-center">
                {serverError}
              </div>
            )}

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full py-3 bg-[#22c55e] hover:bg-[#16a34a] text-white rounded-xl font-bold text-sm transition-all disabled:opacity-60 disabled:cursor-not-allowed shadow-md hover:shadow-lg mt-2"
            >
              {isSubmitting ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                  {t("auth.registering")}
                </span>
              ) : (
                t("auth.createAccount")
              )}
            </button>
          </form>

          <p className="mt-5 text-center text-sm text-gray-500">
            لديك حساب؟{" "}
            <Link href="/login" className="text-[#1a2340] font-bold hover:underline">
              {t("auth.signIn")}
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
