"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import axios from "axios";

interface ExpiredStudent {
  id: string;
  full_name: string;
  enrollment_end_date: string;
}

interface SuspendedStudent {
  id: string;
  full_name: string;
}

function AlertModal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40" dir="rtl">
      <div className="bg-white rounded-2xl shadow-modal p-6 w-full max-w-md animate-scale-in">
        <h3 className="text-base font-bold text-gray-900 mb-4 text-right">{title}</h3>
        {children}
      </div>
    </div>
  );
}

export function AlertsProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [expiredAlert, setExpiredAlert] = useState<ExpiredStudent[]>([]);
  const [suspendedAlert, setSuspendedAlert] = useState<SuspendedStudent[]>([]);

  useEffect(() => {
    const alreadyChecked = sessionStorage.getItem("alerts_checked");
    if (alreadyChecked) return;

    axios
      .get<{ expiredStudents: ExpiredStudent[]; suspendedStudents: SuspendedStudent[] }>("/api/notifications/alerts")
      .then(({ data }) => {
        if (data.expiredStudents?.length > 0) setExpiredAlert(data.expiredStudents);
        if (data.suspendedStudents?.length > 0) setSuspendedAlert(data.suspendedStudents);
        sessionStorage.setItem("alerts_checked", "true");
      })
      .catch(() => {});
  }, []);

  return (
    <>
      {children}

      {expiredAlert.length > 0 && (
        <AlertModal title="انتهاء اشتراك الطلاب" onClose={() => setExpiredAlert([])}>
          <div className="space-y-2 max-h-60 overflow-y-auto">
            {expiredAlert.map((s) => (
              <div key={s.id} className="flex items-center justify-between py-2 border-b border-gray-100">
                <span className="text-sm text-gray-500">
                  {new Date(s.enrollment_end_date).toLocaleDateString("ar-SA")}
                </span>
                <span className="text-sm font-medium text-gray-900">
                  اشتراك الطالب {s.full_name} قد انتهى في تاريخ
                </span>
              </div>
            ))}
          </div>
          <div className="flex gap-3 mt-4 justify-end">
            <button
              onClick={() => setExpiredAlert([])}
              className="px-4 py-2 rounded-md border border-gray-200 text-sm text-gray-600 hover:bg-gray-50"
            >
              موافق
            </button>
            {expiredAlert.length === 1 && (
              <button
                onClick={() => {
                  router.push(`/students/${expiredAlert[0].id}`);
                  setExpiredAlert([]);
                }}
                className="px-4 py-2 rounded-md bg-coral text-white text-sm hover:bg-coral-dark"
              >
                عرض ملف الطالب
              </button>
            )}
          </div>
        </AlertModal>
      )}

      {suspendedAlert.length > 0 && (
        <AlertModal title="تنبيه — طلاب موقوفون" onClose={() => setSuspendedAlert([])}>
          <div className="space-y-1 max-h-60 overflow-y-auto">
            {suspendedAlert.map((s) => (
              <p key={s.id} className="text-sm text-gray-700 py-1 border-b border-gray-50">
                الطالب {s.full_name} قد تم تغيير حالته إلى موقف وذلك لتأخر الدفع
              </p>
            ))}
          </div>
          <div className="flex gap-3 mt-4 justify-end">
            <button
              onClick={() => setSuspendedAlert([])}
              className="px-4 py-2 rounded-md border border-gray-200 text-sm text-gray-600 hover:bg-gray-50"
            >
              موافق
            </button>
            {suspendedAlert.length === 1 && (
              <button
                onClick={() => {
                  router.push(`/students/${suspendedAlert[0].id}`);
                  setSuspendedAlert([]);
                }}
                className="px-4 py-2 rounded-md bg-coral text-white text-sm"
              >
                عرض ملف الطفل
              </button>
            )}
          </div>
        </AlertModal>
      )}
    </>
  );
}
