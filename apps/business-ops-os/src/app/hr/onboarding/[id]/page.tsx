import { detailPage } from '../../recruitment/_components/lifecycle-ui';
import { CaseDetail } from '../_components/case-detail';

export const dynamic = 'force-dynamic';

export default detailPage(
  'ops:lifecycle:read',
  'onboarding',
  '/ops/hr/onboarding',
  { href: '/ops/hr/onboarding', label: 'Back to onboarding' },
  CaseDetail,
);
