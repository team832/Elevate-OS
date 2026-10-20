import { google } from '../../../../../../server/auth';

/** GET /api/v1/auth/google/callback — Google returns here; signs in or redirects to /login?error=. Public. */
export const GET = google.callback;
