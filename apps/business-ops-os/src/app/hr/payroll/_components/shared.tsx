import { StatusBadge, type Tone } from '@elevate/shared-ui';
import {
  PAYROLL_RULES,
  PAYROLL_RUN_LABELS,
  type PayrollRunStatus,
} from '../../../../domain/payroll';

export const BASE = '/ops/hr/payroll';
export const API = '/ops/api/v1/payroll';

const TONE: Record<PayrollRunStatus, Tone> = {
  draft: 'neutral',
  submitted: 'warning',
  approved: 'success',
};
export const RunBadge = ({ status }: { status: PayrollRunStatus }) => (
  <StatusBadge tone={TONE[status]}>{PAYROLL_RUN_LABELS[status]}</StatusBadge>
);

export const PayrollRules = ({ unpaidTypes }: { unpaidTypes: readonly string[] }) => (
  <details className="el-explain">
    <summary>How payroll is worked out</summary>
    <ul>
      <li>
        Leave types counted as loss of pay now:{' '}
        {unpaidTypes.length ? unpaidTypes.join(', ') : 'none'}. HR changes them in the setting
        “Leave types without a balance”.
      </li>
      {PAYROLL_RULES.map((t) => (
        <li key={t}>{t}</li>
      ))}
    </ul>
  </details>
);
