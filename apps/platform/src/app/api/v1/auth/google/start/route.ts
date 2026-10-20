import { google } from '../../../../../../server/auth';

/** GET /api/v1/auth/google/start?next=/path — redirects to Google. 404 when not configured. Public. */
export const GET = google.start;
