/**
 * RFC 4180 CSV for downloads. Cells that a spreadsheet would run as a formula
 * (leading = + - @ tab or CR) get a leading apostrophe, because exported text
 * comes from staff and imported sources (OWASP CSV injection).
 */
export type CsvCell = string | number | boolean | null | undefined;

export function csvCell(value: CsvCell): string {
  if (value === null || value === undefined) return '';
  let text = String(value);
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(header: readonly string[], rows: readonly (readonly CsvCell[])[]): string {
  // The byte order mark tells Excel on Windows this is UTF-8; without it Hindi names and ₹ garble.
  return '﻿' + [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

/** A CSV download (attachment, never cached); the filename is reduced to letters, digits, `_ . -`. */
export function csvResponse(csv: string, filename: string): Response {
  return new Response(csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${filename.replace(/[^\w.-]/g, '_')}"`,
      'cache-control': 'no-store',
    },
  });
}
