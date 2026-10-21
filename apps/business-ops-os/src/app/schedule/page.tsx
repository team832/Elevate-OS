import { permanentRedirect } from 'next/navigation';
import { toAppPath } from '@elevate/server-kit/next';

/** The old schedule moved to Counselling & meetings (brief §11). Demos live under Admissions. */
export default function SchedulePage() {
  permanentRedirect(toAppPath('/ops/meetings', '/ops'));
}
