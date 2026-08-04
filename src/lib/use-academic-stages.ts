"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { useLocale } from "@/lib/i18n-provider";

/**
 * The school's academic stages, for every picker that offers one (task 2.44).
 *
 * One hook rather than each screen fetching its own, because the point of the
 * change was that this list is defined in a single place. Before it, the same
 * concept lived in two enums with two sets of labels, and the interface called
 * it "المجموعة" on one screen and "المرحلة الدراسية" on another.
 */

export interface AcademicStage {
  id: string;
  nameAr: string;
  nameEn: string | null;
  sortOrder: number;
  isSystem: boolean;
  archivedAt: string | null;
  classCount?: number;
  studentCount?: number;
}

export function useAcademicStages(options: { includeArchived?: boolean } = {}) {
  const { includeArchived = false } = options;
  const [stages, setStages] = useState<AcademicStage[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    axios
      .get<AcademicStage[]>(
        `/api/academic-stages${includeArchived ? "?includeArchived=1" : ""}`
      )
      .then((response) => {
        if (cancelled) return;
        setStages(response.data);
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [includeArchived]);

  return { stages, loading, setStages };
}

/**
 * The name to show for a stage.
 *
 * Falls back to the Arabic name when no English one was entered, rather than
 * showing a blank: a school that never switches language should not have to fill
 * in a second name, and an empty option in a dropdown is unusable.
 */
export function useStageName(): (stage: StageName) => string {
  const { locale } = useLocale();
  return (stage) => (locale === "en" ? stage.nameEn || stage.nameAr : stage.nameAr);
}

/**
 * The minimum a caller needs to render a stage.
 *
 * Deliberately narrower than `AcademicStage`: most screens receive the stage
 * nested inside another row and have only its names, and demanding the full
 * shape would push every one of them to over-select.
 */
export interface StageName {
  nameAr: string;
  nameEn: string | null;
}
