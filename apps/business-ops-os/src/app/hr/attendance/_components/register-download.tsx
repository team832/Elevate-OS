/** HR attendance: "Download attendance (spreadsheet)", one month of the staff the Days filters cover. */
import { Button, Field, Select } from '@elevate/shared-ui';
import { fmtMonth } from '../../../../ui/format';
import { Segment } from '../../../../ui/sections';

type Params = Record<string, string | undefined>;
const FILTERS = ['q', 'who', 'department', 'branch'] as const;

export function RegisterDownload({ params, today }: { params: Params; today: string }) {
  const [y, m] = today.split('-').map(Number) as [number, number];
  const months = Array.from({ length: 12 }, (_, i) =>
    new Date(Date.UTC(y, m - 1 - i, 1)).toISOString().slice(0, 7),
  );
  return (
    <Segment
      title="Download attendance (spreadsheet)"
      description="One month for the staff these filters cover: a row per person, a column per day with the status shown here, then the totals. Unmarked days stay blank. Opens in Excel or Google Sheets."
    >
      <form method="get" action="/ops/api/v1/exports/attendance" className="el-form-grid">
        {FILTERS.map((k) =>
          params[k] ? <input key={k} type="hidden" name={k} value={params[k]} /> : null,
        )}
        <Field id="register-month" label="Month">
          <Select id="register-month" name="month">
            {months.map((v) => (
              <option key={v} value={v}>
                {fmtMonth(v)}
              </option>
            ))}
          </Select>
        </Field>
        <div className="el-form-actions">
          <Button type="submit">Download attendance (spreadsheet)</Button>
        </div>
      </form>
    </Segment>
  );
}
