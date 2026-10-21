/** Business codes (D-009): `<PREFIX>-<zero-padded number>`; never reused. */
export const CODE_FORMATS = {
  lead: { prefix: 'LEAD', width: 6 },
  admission: { prefix: 'ADM', width: 6 },
  feeRecord: { prefix: 'FEE', width: 6 },
} as const;
export type CodeKind = keyof typeof CODE_FORMATS;

export function formatCode(kind: CodeKind, n: number): string {
  const { prefix, width } = CODE_FORMATS[kind];
  if (!Number.isInteger(n) || n < 1) throw new RangeError('Code numbers start at 1');
  return `${prefix}-${String(n).padStart(width, '0')}`;
}

/** Parse the number of a code of this kind; null for legacy or foreign codes. */
export function parseCodeNumber(kind: CodeKind, code: string): number | null {
  const { prefix, width } = CODE_FORMATS[kind];
  const m = new RegExp(`^${prefix}-(\\d{${width}})$`).exec(code);
  return m ? Number(m[1]) : null;
}
