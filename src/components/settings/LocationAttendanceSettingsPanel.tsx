"use client";

import axios from "axios";
import { useEffect, useState } from "react";

import { useT } from "@/lib/i18n-provider";

type LocationSettings = {
  enabled: boolean;
  latitude: number | null;
  longitude: number | null;
  checkinRadiusMeters: number;
  checkoutRadiusMeters: number;
  maxAccuracyMeters: number;
};

const defaults: LocationSettings = {
  enabled: false,
  latitude: null,
  longitude: null,
  checkinRadiusMeters: 100,
  checkoutRadiusMeters: 150,
  maxAccuracyMeters: 100,
};

export function LocationAttendanceSettingsPanel() {
  const t = useT();
  const [value, setValue] = useState(defaults);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [locating, setLocating] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    axios.get<LocationSettings>("/api/settings/location-attendance")
      .then((response) => setValue(response.data))
      .catch(() => setFeedback({ ok: false, text: t("settings.locationAttendance.loadFailed") }))
      .finally(() => setLoading(false));
  }, [t]);

  function useCurrentLocation() {
    if (!navigator.geolocation) {
      setFeedback({ ok: false, text: t("settings.locationAttendance.locationUnavailable") });
      return;
    }
    setLocating(true);
    setFeedback(null);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setValue((current) => ({
          ...current,
          latitude: Number(position.coords.latitude.toFixed(7)),
          longitude: Number(position.coords.longitude.toFixed(7)),
        }));
        setLocating(false);
      },
      () => {
        setFeedback({ ok: false, text: t("settings.locationAttendance.locationFailed") });
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 30_000 }
    );
  }

  async function save() {
    setSaving(true);
    setFeedback(null);
    try {
      const response = await axios.put<LocationSettings>("/api/settings/location-attendance", value);
      setValue(response.data);
      setFeedback({ ok: true, text: t("settings.locationAttendance.saved") });
    } catch {
      setFeedback({ ok: false, text: t("settings.locationAttendance.saveFailed") });
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="text-sm text-gray-400">{t("common.loading")}</p>;

  return (
    <div className="space-y-5">
      <label className="flex items-center justify-between gap-4 rounded-xl border border-gray-200 bg-gray-50 p-4">
        <span>
          <span className="block text-sm font-bold text-gray-900">{t("settings.locationAttendance.enable")}</span>
          <span className="mt-1 block text-xs text-gray-500">{t("settings.locationAttendance.hint")}</span>
        </span>
        <input
          checked={value.enabled}
          className="h-5 w-5 accent-[#5B14D1]"
          onChange={(event) => setValue((current) => ({ ...current, enabled: event.target.checked }))}
          type="checkbox"
        />
      </label>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <NumberField label={t("settings.locationAttendance.latitude")} value={value.latitude} onChange={(latitude) => setValue((current) => ({ ...current, latitude }))} step="0.0000001" />
        <NumberField label={t("settings.locationAttendance.longitude")} value={value.longitude} onChange={(longitude) => setValue((current) => ({ ...current, longitude }))} step="0.0000001" />
        <NumberField label={t("settings.locationAttendance.checkinRadius")} value={value.checkinRadiusMeters} onChange={(checkinRadiusMeters) => setValue((current) => ({ ...current, checkinRadiusMeters: checkinRadiusMeters ?? 100 }))} />
        <NumberField label={t("settings.locationAttendance.checkoutRadius")} value={value.checkoutRadiusMeters} onChange={(checkoutRadiusMeters) => setValue((current) => ({ ...current, checkoutRadiusMeters: checkoutRadiusMeters ?? 150 }))} />
        <NumberField label={t("settings.locationAttendance.maxAccuracy")} value={value.maxAccuracyMeters} onChange={(maxAccuracyMeters) => setValue((current) => ({ ...current, maxAccuracyMeters: maxAccuracyMeters ?? 100 }))} />
      </div>

      <p className="text-xs leading-6 text-gray-500">{t("settings.locationAttendance.privacy")}</p>
      {feedback ? <p className={`text-sm ${feedback.ok ? "text-emerald-700" : "text-red-600"}`}>{feedback.text}</p> : null}
      <div className="flex flex-wrap gap-3">
        <button type="button" className="rounded-xl border border-[#5B14D1] px-4 py-2.5 text-sm font-bold text-[#5B14D1] disabled:opacity-50" disabled={locating} onClick={useCurrentLocation}>
          {locating ? t("settings.locationAttendance.locating") : t("settings.locationAttendance.useCurrentLocation")}
        </button>
        <button type="button" className="rounded-xl bg-[#5B14D1] px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50" disabled={saving} onClick={() => void save()}>
          {saving ? t("common.loading") : t("settings.locationAttendance.save")}
        </button>
      </div>
    </div>
  );
}

function NumberField({ label, onChange, step = "1", value }: {
  label: string;
  onChange: (value: number | null) => void;
  step?: string;
  value: number | null;
}) {
  return (
    <label className="space-y-1.5 text-sm font-medium text-gray-700">
      <span>{label}</span>
      <input
        className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 outline-none focus:border-[#5B14D1]"
        dir="ltr"
        inputMode="decimal"
        onChange={(event) => onChange(event.target.value === "" ? null : Number(event.target.value))}
        step={step}
        type="number"
        value={value ?? ""}
      />
    </label>
  );
}
