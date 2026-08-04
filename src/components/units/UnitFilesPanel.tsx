"use client";

/**
 * Attachments on a teaching unit (task 2.23).
 *
 * Inline on the unit card rather than behind a detail page. The list is normally
 * two or three worksheets, and a page that exists only to show three links is a
 * navigation step charged for nothing.
 *
 * Files load when the panel is opened, not with the unit list — the list renders
 * a dozen cards and none of them needs this until asked.
 */

import { useEffect, useState } from "react";
import axios from "axios";
import { describeApiError } from "@/lib/api-error";
import { formatBytes } from "@/lib/storage-format";
import { useT } from "@/lib/i18n-provider";

interface UnitFile {
  id: string;
  name: string;
  url: string;
  mimeType: string;
  sizeBytes: number;
}

export function UnitFilesPanel({ unitId, onCountChange }: {
  unitId: string;
  onCountChange?: (count: number) => void;
}) {
  const t = useT();
  const [files, setFiles] = useState<UnitFile[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function report(next: UnitFile[]) {
    setFiles(next);
    onCountChange?.(next.length);
  }

  // The panel mounts already open, so this runs once. The state is set from the
  // promise chain rather than the effect body — the lint rule this codebase
  // enforces (`react-hooks/set-state-in-effect`) is right that the latter is a
  // render loop waiting to happen.
  useEffect(() => {
    let cancelled = false;
    axios
      .get<{ files: UnitFile[] }>(`/api/units/${unitId}`)
      .then((response) => {
        if (cancelled) return;
        setFiles(response.data.files ?? []);
        onCountChange?.((response.data.files ?? []).length);
      })
      .catch((err) => {
        if (!cancelled) setError(describeApiError(err, t("units.loadFilesFailed")));
      });
    return () => {
      cancelled = true;
    };
    // `onCountChange` is a parent callback; re-running on its identity would
    // refetch on every parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unitId]);

  async function upload(file: File) {
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const response = await axios.post<UnitFile>(`/api/units/${unitId}/files`, form);
      report([...(files ?? []), response.data]);
    } catch (err) {
      setError(describeApiError(err, t("units.uploadFileFailed")));
    } finally {
      setBusy(false);
    }
  }

  async function remove(fileId: string) {
    setBusy(true);
    setError(null);
    try {
      await axios.delete(`/api/units/${unitId}/files/${fileId}`);
      report((files ?? []).filter((file) => file.id !== fileId));
    } catch (err) {
      setError(describeApiError(err, t("units.deleteFileFailed")));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 pt-3 border-t border-gray-50">
      {error && <p className="text-xs text-red-600 mb-2">{error}</p>}

      {files === null ? (
        <p className="text-xs text-gray-400">{t("common.loading")}</p>
      ) : files.length === 0 ? (
        <p className="text-xs text-gray-400">{t("units.noFiles")}</p>
      ) : (
        <ul className="space-y-1.5 mb-2">
          {files.map((file) => (
            <li key={file.id} className="flex items-center gap-2 text-xs">
              <a
                href={file.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 min-w-0 truncate text-[#2F96A6] hover:underline"
              >
                {file.name}
              </a>
              <span className="text-gray-400 shrink-0">{formatBytes(file.sizeBytes)}</span>
              <button
                type="button"
                onClick={() => remove(file.id)}
                disabled={busy}
                className="text-red-500 hover:text-red-700 disabled:opacity-50 shrink-0"
              >
                {t("common.delete")}
              </button>
            </li>
          ))}
        </ul>
      )}

      <label
        className={`inline-flex items-center gap-1.5 text-xs text-[#2F96A6] ${
          busy ? "opacity-60" : "cursor-pointer hover:underline"
        }`}
      >
        <input
          type="file"
          accept="application/pdf,image/jpeg,image/png,image/webp"
          className="hidden"
          disabled={busy}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void upload(file);
          }}
        />
        {busy ? t("common.working") : t("units.addFile")}
      </label>
    </div>
  );
}
