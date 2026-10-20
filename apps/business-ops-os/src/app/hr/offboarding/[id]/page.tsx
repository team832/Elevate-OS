import { detailPage } from '../../recruitment/_components/lifecycle-ui';
import { CaseDetail } from '../../onboarding/_components/case-detail';

export const dynamic = 'force-dynamic';

export default detailPage(
  'ops:lifecycle:read',
  'offboarding',
  '/ops/hr/offboarding',
  { href: '/ops/hr/offboarding', label: 'Back to offboarding' },
  CaseDetail,
);
