"use client";

/**
 * What a new school sees instead of an empty dashboard.
 *
 * A checklist rather than a wizard, deliberately. A wizard owns the screen and
 * runs in one order, so a nursery that has its staff list but not its rooms yet
 * is stuck at a step it cannot answer, and the only way out is to abandon the
 * flow. A checklist lets each step be done whenever its information exists, and
 * still shows how much is left.
 *
 * Every step's state is derived from a real count, never from a "seen" flag. If
 * the school later archives its last class, the step reopens — which is honest.
 * It cannot fall out of step with the data because it *is* the data.
 *
 * Disappears on its own once complete. There is no dismiss button: something the
 * user must tidy away is one more thing to do on a screen whose whole purpose is
 * to reduce that.
 */

import Link from "next/link";
import { useT } from "@/lib/i18n-provider";

export interface SetupStep {
  key: string;
  done: boolean;
  href: string;
}

export function SetupChecklist({ steps }: { steps: SetupStep[] }) {
  const t = useT();
  const done = steps.filter((step) => step.done).length;

  if (done === steps.length) return null;

  return (
    <section className="bg-white rounded-2xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-6 space-y-4">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <h2 className="font-bold text-[#111111]">{t("setup.title")}</h2>
        <span className="text-xs text-gray-400">
          {t("setup.progress", { done: String(done), total: String(steps.length) })}
        </span>
      </div>

      <p className="text-xs text-gray-500">{t("setup.hint")}</p>

      {/* Progress is shown twice on purpose: the bar reads at a glance, the
          count answers "how much is left" exactly. */}
      <div
        className="h-1.5 bg-gray-100 rounded-full overflow-hidden"
        role="progressbar"
        aria-valuenow={done}
        aria-valuemin={0}
        aria-valuemax={steps.length}
      >
        <div
          className="h-full bg-teal rounded-full transition-all duration-500"
          style={{ width: `${(done / steps.length) * 100}%` }}
        />
      </div>

      <ul className="space-y-1">
        {steps.map((step) => (
          <li key={step.key}>
            <Link
              href={step.href}
              className={`flex items-center gap-3 py-2.5 px-3 -mx-3 rounded-xl transition-colors group ${
                step.done ? "opacity-50" : "hover:bg-gray-50"
              }`}
            >
              <span
                aria-hidden
                className={`w-5 h-5 rounded-full flex items-center justify-center text-[11px] shrink-0 ${
                  step.done
                    ? "bg-success-bg text-success-text"
                    : "border-2 border-gray-200 text-transparent"
                }`}
              >
                ✓
              </span>
              <span
                className={`text-sm flex-1 ${
                  step.done ? "text-gray-400 line-through" : "text-gray-800"
                }`}
              >
                {t(`setup.${step.key}`)}
              </span>
              {!step.done && (
                <span
                  aria-hidden
                  className="text-gray-300 group-hover:text-gray-500 transition-colors text-xs"
                >
                  ←
                </span>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
