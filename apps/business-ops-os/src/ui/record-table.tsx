/**
 * Bordered data table for every Business Ops list: full cell borders, zebra rows,
 * right-aligned numbers, an empty-state row under the real headers, and optional
 * whole-row click-through. Below 720px each row stacks into a labelled card (shared
 * `.el-table-compact`, labels from `data-label`); the link cell is the card title.
 * Only lists longer than one page get their own scroll well with a sticky header.
 * Columns use the shared-ui `Column<T>` type, so DataTable columns move over unchanged.
 */
import { isValidElement, type ReactNode } from 'react';
import {
  ActionsHeader,
  SampleBadge,
  scrollRegion,
  tableWrapClass,
  type Column,
} from '@elevate/shared-ui';
import { RowLinks } from './row-links';

export interface RecordTableProps<T> {
  columns: readonly Column<T>[];
  rows: readonly T[];
  rowKey: (row: T) => string;
  /** Visible caption above the table, e.g. "112 students". */
  caption?: ReactNode;
  /** Shown in a full-width row when `rows` is empty. */
  empty?: ReactNode;
  /** Makes the whole row open this URL (usually the list URL with `open=<id>`); undefined leaves that row unlinked. */
  rowHref?: (row: T) => string | undefined;
  /** Column whose cell holds the row link (default: the first). Keep that cell free of other links/buttons. */
  linkColumn?: string;
  /** Which rows are fictional: they get the SAMPLE DATA badge in the link column (D-036). */
  sampleOf?: (row: T) => boolean;
  /** The column the rows are ordered by: announced by aria-sort, with its direction in the heading. */
  sortedBy?: { column: string; direction: 'ascending' | 'descending' };
  /** A short list that never pages (a month of days): the page scrolls, not the table. */
  pageScroll?: boolean;
}

const cell = <T,>(c: Column<T>, row: T): ReactNode => {
  if (c.render) return c.render(row);
  const value = (row as Record<string, unknown>)[c.key];
  return isValidElement(value) ? value : String(value ?? '');
};

export function RecordTable<T>({
  columns,
  rows,
  rowKey,
  caption,
  empty = 'No records match.',
  rowHref,
  linkColumn = columns[0]?.key,
  sampleOf,
  sortedBy,
  pageScroll,
}: RecordTableProps<T>) {
  const value = (c: Column<T>, row: T) =>
    c.key === linkColumn && sampleOf?.(row) ? (
      <>
        {cell(c, row)} <SampleBadge />
      </>
    ) : (
      cell(c, row)
    );
  const table = (
    <table className="el-table el-table-compact ops-table">
      {caption ? <caption>{caption}</caption> : null}
      <thead>
        <tr>
          {columns.map((c) => (
            <th
              key={c.key}
              scope="col"
              className={c.numeric ? 'el-num' : undefined}
              aria-sort={sortedBy?.column === c.key ? sortedBy.direction : undefined}
            >
              {c.header || <ActionsHeader />}
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
                        {value(c, row)}
                      </a>
                    ) : (
                      // One element per value, so a phone card's grid stays label | value.
                      <div>{value(c, row)}</div>
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
  const wrap = tableWrapClass(pageScroll ? 0 : rows.length);
  // Row links are tab stops already; without them the box itself takes one, so it can scroll.
  return rowHref ? (
    <RowLinks className={wrap}>{table}</RowLinks>
  ) : (
    <div className={wrap} {...scrollRegion(caption)}>
      {table}
    </div>
  );
}
