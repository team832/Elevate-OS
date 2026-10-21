'use client';

/** "Print / Save as PDF" — the browser's own print dialog (no PDF library). */
export function PrintButton() {
  return (
    <button type="button" className="el-button el-button-primary" onClick={() => window.print()}>
      Print / Save as PDF
    </button>
  );
}
