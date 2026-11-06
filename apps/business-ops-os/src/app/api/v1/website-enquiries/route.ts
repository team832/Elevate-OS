import { after } from 'next/server';
import { defineRoute } from '@elevate/server-kit';
import { seeOther } from '@elevate/shared-contracts';
import { receiveWebsiteEnquiry, WEBSITE_FORM_THANKS } from '../../../../server/website-form';

export const dynamic = 'force-dynamic';

/**
 * POST /ops/api/v1/website-enquiries — the public website enquiry form (F4-15), no sign-in. An
 * HTML form post, also from the websites in leads.website_form.allowed_origins (crossSite: the
 * Origin check is in receiveWebsiteEnquiry). The answer is always the same 303 to the thank-you
 * page, sent before any save work starts (after()), so its timing says nothing either.
 */
export const POST = defineRoute(
  { permission: 'public', crossSite: true, module: 'ops' },
  async ({ request, db, log }) => {
    await receiveWebsiteEnquiry(db, request, log, after);
    return seeOther(WEBSITE_FORM_THANKS);
  },
);
