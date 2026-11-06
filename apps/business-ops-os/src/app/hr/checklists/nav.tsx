import { Subnav } from '@elevate/shared-ui';

/** Area tabs shared by the staff checklists and the asset register (F4-09). */
export const HrRecordsNav = ({ current }: { current: string }) => (
  <Subnav
    label="Joining, leaving and assets"
    current={current}
    items={[
      ['/ops/hr/checklists', 'Joining and leaving'],
      ['/ops/hr/assets', 'Staff assets'],
    ]}
  />
);
