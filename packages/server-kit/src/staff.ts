import { eq } from 'drizzle-orm';
import { staffMembers, type Database } from '@elevate/database';
import type { StaffMemberId, UserId } from '@elevate/shared-types';

/** The staff record linked to a user (null when the user is not staff). */
export async function staffIdForUser(db: Database, userId: UserId): Promise<StaffMemberId | null> {
  const [row] = await db
    .select({ id: staffMembers.id })
    .from(staffMembers)
    .where(eq(staffMembers.userId, userId))
    .limit(1);
  return row?.id ?? null;
}
