/**
 * CSV export (TASK 13). Values that start with = + - @ (or a tab / carriage return) are prefixed with an apostrophe so a
 * spreadsheet never runs them as a formula ("CSV injection"); quotes, commas and line breaks are escaped.
 */
export const csvCell = (v: unknown): string => {
  let s = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export const toCsv = (header: string[], rows: unknown[][]): string => [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n");

/** Triggers a download of `text` as a UTF-8 CSV (with a BOM so Excel reads Arabic correctly). */
export const downloadCsv = (fileName: string, text: string) => {
  const url = URL.createObjectURL(new Blob(["\uFEFF", text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
};
