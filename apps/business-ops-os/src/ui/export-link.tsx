import { ButtonLink } from '@elevate/shared-ui';
import type { ExportList } from '../server/list-exports';
import { listHref } from './list-controls';

/**
 * "Download (spreadsheet)": every row matching the page's filters, not only this page, as CSV
 * (server/list-exports.ts). `base` is the host workspace; each mounts `exports/[list]` from work.ts.
 */
export function ExportLink({
  list,
  params,
  base = '/ops',
  label = 'Download (spreadsheet)',
}: {
  list: ExportList;
  params: Record<string, string | number | null | undefined>;
  base?: string;
  label?: string;
}) {
  const q = Object.fromEntries(
    Object.entries(params).map(([k, v]) => [
      k,
      v === null || v === undefined ? undefined : String(v),
    ]),
  );
  return (
    <div className="el-page-actions">
      <ButtonLink href={listHref(`${base}/api/v1/exports/${list}`, q)} download>
        {label}
      </ButtonLink>
    </div>
  );
}
