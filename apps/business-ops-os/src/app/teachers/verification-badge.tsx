import { StatusBadge } from '@elevate/shared-ui';

/** "Unverified" on owner-supplied records not yet confirmed; confirmed records show nothing. */
export const VerificationBadge = ({ status }: { status: string | undefined }) =>
  status === 'confirmed' ? null : <StatusBadge tone="warning">Unverified</StatusBadge>;
