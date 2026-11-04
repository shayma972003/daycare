export function isImportRowEmpty(row: Record<string, unknown>): boolean {
  return Object.values(row).every(
    (value) => value === null || value === undefined || String(value).trim() === ""
  );
}

/**
 * Drops only completely empty spreadsheet rows and columns. Partially filled
 * rows are intentionally retained so optional child details can remain blank.
 */
export function prepareImportRows(
  rawRows: Record<string, unknown>[],
  originalHeaders: string[]
): { rows: Record<string, unknown>[]; headers: string[] } {
  const nonEmptyRows = rawRows.filter((row) => !isImportRowEmpty(row));
  const headers = originalHeaders.filter((header) =>
    nonEmptyRows.some((row) => {
      const value = row[header];
      return value !== null && value !== undefined && String(value).trim() !== "";
    })
  );

  return {
    headers,
    rows: nonEmptyRows.map((row) =>
      Object.fromEntries(headers.map((header) => {
        const value = row[header];
        return [header, value === null || value === undefined || String(value).trim() === "" ? null : value];
      }))
    ),
  };
}
