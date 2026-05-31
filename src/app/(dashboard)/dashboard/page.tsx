"use client";

import { useEffect, useState, useCallback } from "react";
import axios from "axios";
import { Topbar } from "@/components/layout/Topbar";
import { ActivityGrid, type Activity } from "@/components/activities/ActivityGrid";
import { ActivityFormModal } from "@/components/activities/ActivityFormModal";
import { t } from "@/lib/utils";

export default function HomePage() {
  const [currentActivities, setCurrentActivities] = useState<Activity[]>([]);
  const [pastActivities, setPastActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [selectedActivity, setSelectedActivity] = useState<Activity | null>(null);

  const fetchActivities = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [currentRes, pastRes] = await Promise.all([
        axios.get<Activity[]>("/api/activities?dateFilter=current"),
        axios.get<Activity[]>("/api/activities?dateFilter=past"),
      ]);
      setCurrentActivities(currentRes.data);
      setPastActivities(pastRes.data);
    } catch {
      setError(t("common.error"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchActivities();
  }, [fetchActivities]);

  const openAddModal = () => {
    setSelectedActivity(null);
    setModalOpen(true);
  };

  const openEditModal = (activity: Activity) => {
    setSelectedActivity(activity);
    setModalOpen(true);
  };

  const handleModalClose = () => {
    setModalOpen(false);
    setSelectedActivity(null);
  };

  const handleSaved = () => {
    fetchActivities();
  };

  return (
    <div dir="rtl" className="min-h-screen bg-[#f4f6fb]">
      <Topbar title={t("home.title")} />

      <div className="p-6 space-y-8">
        {error && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600">
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="flex flex-col items-center gap-3 text-gray-400">
              <div className="w-8 h-8 border-2 border-gray-200 border-t-[#22c55e] rounded-full animate-spin" />
              <span className="text-sm">{t("common.loading")}</span>
            </div>
          </div>
        ) : (
          <>
            <section>
              <h2 className="text-base font-bold text-[#1a2340] mb-4">
                {t("home.currentActivities")}
              </h2>
              <ActivityGrid
                activities={currentActivities}
                onAdd={openAddModal}
                onSelect={openEditModal}
              />
            </section>

            <section>
              <h2 className="text-base font-bold text-[#1a2340] mb-4">
                {t("home.pastActivities")}
              </h2>
              {pastActivities.length === 0 ? (
                <p className="text-sm text-gray-400 py-6 text-center">
                  {t("common.noData")}
                </p>
              ) : (
                <ActivityGrid
                  activities={pastActivities}
                  onAdd={openAddModal}
                  onSelect={openEditModal}
                />
              )}
            </section>
          </>
        )}
      </div>

      <ActivityFormModal
        open={modalOpen}
        onClose={handleModalClose}
        activity={selectedActivity}
        onSaved={handleSaved}
      />
    </div>
  );
}
