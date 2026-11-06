/**
 * Reference rows for the website enquiry form (F4-15), not sample data: the lead source
 * WEBSITE_FORM and the system user that creates its leads (created_by is required). The user is
 * switched off, has no password and no roles, so nobody can sign in as it.
 */
import { opsLeadSources, users, type Database } from '@elevate/database';
import { defineSeed } from '@elevate/database/seed';
import { WEBSITE_FORM_SOURCE, WEBSITE_FORM_USER_EMAIL } from '../src/server/website-form';

export async function seedWebsiteForm(db: Database) {
  await db
    .insert(opsLeadSources)
    .values({ code: WEBSITE_FORM_SOURCE, label: 'Website form', sortOrder: 125 })
    .onConflictDoNothing({ target: opsLeadSources.code });
  await db
    .insert(users)
    .values({
      email: WEBSITE_FORM_USER_EMAIL,
      displayName: 'Website form (system)',
      passwordHash: null,
      status: 'disabled',
    })
    .onConflictDoNothing({ target: users.email });
}

export const websiteFormSeeds = [
  defineSeed({
    name: 'ops.website-form',
    module: 'ops',
    dependsOn: ['ops.lead-sources'],
    description:
      'The Website form lead source and its no-login system user "Website form (system)" (reference data, kept by db:clear-samples)',
    run: ({ db }) => seedWebsiteForm(db),
  }),
];
