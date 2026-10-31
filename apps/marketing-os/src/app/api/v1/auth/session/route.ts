import { defineRoute } from '@elevate/server-kit';

/** GET /marketing/api/v1/auth/session: 200 while signed in, 401 once not (ui/session-guard.tsx). */
export const GET = defineRoute({ permission: 'authenticated' }, async () => ({ signedIn: true }));
