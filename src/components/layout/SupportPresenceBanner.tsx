"use client";

import axios from "axios";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

interface Presence {
  active: boolean;
  expiresAt: string | null;
  isSupportViewer: boolean;
}

function timeLabel(value: string | null) {
  if (!value) return "";
  return new Intl.DateTimeFormat("ar-SA", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Riyadh" }).format(new Date(value));
}

export function SupportPresenceBanner({ initial }: { initial?: Presence | null }) {
  const pathname = usePathname();
  const router = useRouter();
  const [presence, setPresence] = useState<Presence | null>(initial ?? null);
  const [ending, setEnding] = useState(false);

  useEffect(() => {
    let active = true;
    const refresh = () => {
      axios.get<Presence>("/api/support-presence")
        .then((response) => { if (active) setPresence(response.data); })
        .catch(() => { if (active && presence?.isSupportViewer) setPresence(null); });
    };
    refresh();
    const timer = window.setInterval(refresh, 10_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [presence?.isSupportViewer]);

  useEffect(() => {
    if (!presence?.active || !presence.isSupportViewer) return;
    axios.post("/api/support-presence", { pathname }).catch(() => {});
  }, [pathname, presence?.active, presence?.isSupportViewer]);

  async function endSupportView() {
    setEnding(true);
    try {
      await axios.delete("/api/support-presence");
    } finally {
      router.push("/admin/support");
      router.refresh();
    }
  }

  if (!presence?.active) return null;
  return (
    <div role="status" className="sticky top-0 z-40 flex flex-wrap items-center justify-between gap-3 border-b border-amber-400/40 bg-amber-300 px-4 py-3 text-sm font-semibold text-amber-950 shadow-md">
      <div>
        {presence.isSupportViewer
          ? "أنت داخل حساب المنشأة بصفة دعم فني — قراءة فقط"
          : "الدعم الفني مطّلع الآن على الحساب في جلسة قراءة فقط"}
        {presence.expiresAt && <span className="ms-2 text-xs font-normal">حتى {timeLabel(presence.expiresAt)}</span>}
      </div>
      {presence.isSupportViewer && (
        <button type="button" disabled={ending} onClick={() => void endSupportView()} className="rounded-lg border border-amber-900/20 bg-white/50 px-3 py-1.5 text-xs hover:bg-white/80 disabled:opacity-50">
          {ending ? "جاري الخروج..." : "إنهاء المعاينة"}
        </button>
      )}
    </div>
  );
}
