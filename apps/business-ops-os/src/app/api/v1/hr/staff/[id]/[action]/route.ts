import { z } from 'zod';
import { defineRoute } from '@elevate/server-kit';
import {
  departmentChangeBody,
  endEmploymentBody,
  managerChangeBody,
  staffActionParams,
} from '../../../../../../../server/hr-schemas';
import {
  changeDepartment,
  changeManager,
  endEmployment,
} from '../../../../../../../server/hr-staff-actions';

export const dynamic = 'force-dynamic';

const ACTIONS = {
  department: [departmentChangeBody, changeDepartment],
  manager: [managerChangeBody, changeManager],
  'end-employment': [endEmploymentBody, endEmployment],
} as const;

/**
 * POST /ops/api/v1/hr/staff/[id]/{department|manager|end-employment} — Change the department or
 * manager (with history), or end employment (disables the login and ends its sessions).
 */
export const POST = defineRoute(
  { permission: 'ops:staff:manage', params: staffActionParams, body: z.looseObject({}) },
  async ({ user, db, params, body, requestId }) => {
    const [schema, run] = ACTIONS[params.action];
    // A ZodError here is a 400 like any body error (server-kit errors.ts).
    return (run as (...a: unknown[]) => Promise<unknown>)(
      db,
      user,
      params.id,
      schema.parse(body),
      requestId,
    );
  },
);
