/** The admission journey as this area shows it (Active is counted on the Students pages). */
import { JourneyRail } from '@elevate/shared-ui';

export const JOURNEY = {
  demo: 'Demo',
  application: 'Application',
  signed: 'Signed',
  confirmed: 'Confirmed',
} as const;

/**
 * One record on the journey, from the server's own status: stages before `at` are done, `at` is
 * current, later ones upcoming (`at` past the end = all done). `from` drops earlier stages
 * (a direct admission has no demo).
 */
export const RecordJourney = ({ at, from = 0 }: { at: number; from?: number }) => (
  <JourneyRail
    label="Admission journey"
    stages={Object.entries(JOURNEY)
      .map(([key, label], i) => ({
        key,
        label,
        state: i < at ? ('done' as const) : i === at ? ('current' as const) : ('upcoming' as const),
      }))
      .slice(from)}
  />
);
