import type { AuthenticatedUser } from '@elevate/authentication';
import { can } from '@elevate/authorization';
import { getDb } from '@elevate/database';
import { Button, Card, Field, Select } from '@elevate/shared-ui';
import { listBatches, todayIst } from '../../server';
import { MODULE_PATHS } from '../../server/paths';
import { actorFor, load } from '../../ui/shell';

const MONTH = new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });

/** "Download attendance (spreadsheet)": one batch you may see, one of the last 12 months, as CSV. */
export async function RegisterDownload({ user }: { user: AuthenticatedUser }) {
  if (!can(user, 'academic:batches:read')) return null;
  const r = await load(() => listBatches(getDb(), actorFor(user)));
  if (!r.ok || r.data.length === 0) return null;
  const [y, m] = todayIst().split('-').map(Number) as [number, number];
  const months = Array.from({ length: 12 }, (_, i) => new Date(Date.UTC(y, m - 1 - i, 1)));
  return (
    <Card title="Download attendance (spreadsheet)" description="One batch, one month: a row per student, a column per delivered class with each mark, then totals and attendance %. Not recorded stays blank. Opens in Excel or Google Sheets.">
      <form method="get" action={MODULE_PATHS.api('attendance-register')} className="el-form-grid">
        <Field id="register-batch" label="Batch">
          <Select id="register-batch" name="batchId" required>
            {r.data.map((b) => (
              <option key={b.id} value={b.id}>
                {b.code} — {b.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="register-month" label="Month">
          <Select id="register-month" name="month">
            {months.map((d) => (
              <option key={d.toISOString()} value={d.toISOString().slice(0, 7)}>
                {MONTH.format(d)}
              </option>
            ))}
          </Select>
        </Field>
        <div className="el-form-actions">
          <Button type="submit">Download attendance (spreadsheet)</Button>
        </div>
      </form>
    </Card>
  );
}
