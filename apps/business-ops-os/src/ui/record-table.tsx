/**
 * Bordered data table for every Business Ops list: full cell borders, zebra rows,
 * right-aligned numbers, an empty-state row under the real headers, and optional
 * whole-row click-through. Below 720px each row stacks into a labelled card (shared
 * `.el-table-compact`, labels from `data-label`); the link cell is the card title.
 * Only lists longer than one page get their own scroll well with a sticky header.
 * Columns use the shared-ui `Column<T>` type, so DataTable columns move over unchanged.
 */
import type { CSSProperties, ReactNode } from 'react';
import type { Column } from '@elevate/shared-ui';
import { RowLinks } from './row-links';

export interface RecordTableProps<T> {
  columns: readonly Column<T>[];
  rows: readonly T[];
  rowKey: (row: T) => string;
  /** Visible caption above the table, e.g. "112 students". */
  caption?: ReactNode;
  /** Shown in a full-width row when `rows` is empty. */
  empty?: ReactNode;
  /** Makes the whole row open this URL (usually the list URL with `open=<id>`). */
  rowHref?: (row: T) => string;
  /** Column whose cell holds the row link (default: the first). Keep that cell free of other links/buttons. */
  linkColumn?: string;
}

const cell = <T,>(c: Column<T>, row: T): ReactNode =>
  c.render ? c.render(row) : String((row as Record<string, unknown>)[c.key] ?? '');

export function RecordTable<T>({
  columns,
  rows,
  rowKey,
  caption,
  empty = 'No records match.',
  rowHref,
  linkColumn = columns[0]?.key,
}: RecordTableProps<T>) {
  const table = (
    <table
      className="el-table el-table-compact ops-table"
      style={{ '--ops-cols': columns.length } as CSSProperties}
    >
      {caption ? <caption>{caption}</caption> : null}
      <thead>
        <tr>
          {columns.map((c) => (
            <th key={c.key} scope="col" className={c.numeric ? 'el-num' : undefined}>
              {c.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <tr>
            <td colSpan={columns.length} className="ops-table-empty">
              {empty}
            </td>
          </tr>
        ) : (
          rows.map((row) => {
            const key = rowKey(row);
            const href = rowHref?.(row);
            return (
              <tr key={key} className={href ? 'ops-row-link' : undefined}>
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={c.numeric ? 'el-num' : undefined}
                    data-label={typeof c.header === 'string' ? c.header : undefined}
                  >
                    {href && c.key === linkColumn ? (
                      <a href={href} data-row-link="" data-drawer-return={key}>
                        {cell(c, row)}
                      </a>
                    ) : (
                      // One element per value, so a phone card's grid stays label | value.
                      <div>{cell(c, row)}</div>
                    )}
                  </td>
                ))}
              </tr>
            );
          })
        )}
      </tbody>
    </table>
  );
  // Lists page at 25 rows; only longer (unpaged) lists scroll inside their own well.
  const wrap = rows.length > 25 ? 'el-table-wrap ops-table-well' : 'el-table-wrap';
  return rowHref ? (
    <RowLinks className={wrap}>{table}</RowLinks>
  ) : (
    <div className={wrap}>{table}</div>
  );
}
