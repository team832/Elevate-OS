/**
 * Website enquiry form (F4-15; the Krayin WebForm design, MIT, ideas only). Every post gets the
 * same thank-you reply at the same speed, so the form never tells anyone whether a contact is
 * already known: only the Origin check and reading the form happen before the reply; the rest runs
 * after it (Next's after()). A post is saved only when the form is on and its consent wording is
 * approved, the limits allow it (every address together, and this address), the hidden honeypot
 * field is empty and the fields are valid: the lead with the same phone gets a new enquiry (a note
 * only, never an admission case), else a new lead with the fixed source WEBSITE_FORM (shared by
 * rule when lead sharing is on). Both are written by the seeded no-login system user, with the
 * consent text version and time on the enquiry.
 */
import { and, desc, eq, isNull, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { clientIp, LoginThrottle } from '@elevate/authentication';
import { isAllowedRequestOrigin, type Logger } from '@elevate/configuration';
import {
  opsEnquiries,
  opsLeads,
  programmes,
  userRoles,
  users,
  type Database,
} from '@elevate/database';
import { withTransaction } from '@elevate/server-kit';
import {
  ConflictError,
  ForbiddenError,
  optText,
  phoneInputSchema,
  programmeCodeSchema,
} from '@elevate/shared-contracts';
import { modulePath, normaliseEmail, type ResolvedSettings } from '../domain';
import { originList } from '../domain/policies-leads';
import type { Actor } from './context';
import { addEnquiry, createLead } from './leads';
import { loadSettings } from './settings';

export const WEBSITE_FORM_SOURCE = 'WEBSITE_FORM';
export const WEBSITE_FORM_USER_EMAIL = 'website-form@elevateeducation.in';
export const WEBSITE_FORM_THANKS = `${modulePath('enquire')}?sent=1`;
/** People never see this field; form-filling robots fill it in. */
export const HONEYPOT_FIELD = 'website';
const MAX_BYTES = 16 * 1024;
const FORM_TYPE = /^(application\/x-www-form-urlencoded|multipart\/form-data)/;
const perAddress = new LoginThrottle('website-form');
const everyone = new LoginThrottle('website-form-all');
/** Logged at error level: the seeded no-login user is missing, switched on or holds roles. */
const BROKEN_USER = 'system user missing, switched on or holding roles';
const SHARED_CONTACT =
  'Sent through the website form while another lead has this phone or email: check whether it is the same person.';

const enquiryForm = z.object({
  name: z.string().trim().min(1).max(200),
  phone: phoneInputSchema,
  email: z.string().optional(),
  programme: programmeCodeSchema.optional(),
  city: optText(100),
  message: optText(2000),
  consent: z.literal('on'),
});
type EnquiryForm = z.output<typeof enquiryForm>;

/** Open = switched on and the consent wording approved by the owner (a Proposed text never opens it). */
const formOpen = (s: ResolvedSettings) =>
  s['leads.website_form.enabled'].value.enabled &&
  s['leads.website_form.consent'].decisionState === 'approved';

/** What the public page needs: whether the form is open, the consent words, active programmes. */
export async function websiteFormView(db: Database) {
  const settings = await loadSettings(db);
  return {
    enabled: formOpen(settings),
    consentText: settings['leads.website_form.consent'].value.text,
    programmes: await db
      .select({ code: programmes.code, name: programmes.name })
      .from(programmes)
      .where(eq(programmes.status, 'active'))
      .orderBy(programmes.name),
  };
}

/**
 * Take one post. A post from a website that is not allowed is refused at once (403, like every
 * other cross-site post): the route skips the generic check (crossSite), so the Origin must be
 * Elevate's own or exactly one listed in the setting, and a post without one is refused (browsers
 * always send it on a form post). Everything else is handed to `later` (the route passes Next's
 * after()) and only logged, without personal data.
 */
export async function receiveWebsiteEnquiry(
  db: Database,
  request: Request,
  log: Logger,
  later: (work: () => Promise<unknown>) => void,
) {
  const origin = request.headers.get('origin');
  if (
    origin === null ||
    !(
      isAllowedRequestOrigin(request) ||
      originList(
        (await loadSettings(db))['leads.website_form.allowed_origins'].value.origins,
      ).includes(origin)
    )
  )
    throw new ForbiddenError('This request came from another site and was refused.');
  const form = await readForm(request);
  const ip = clientIp(request);
  later(async () => {
    try {
      const reason = await take(db, form, ip, origin);
      if (reason !== 'saved')
        log[reason === BROKEN_USER ? 'error' : 'warn']('website enquiry not saved', { reason });
    } catch (error) {
      // The error's name only: a failed query's message carries the name, phone and email typed.
      log.error('website enquiry not saved', {
        reason: 'failed',
        errorName: error instanceof Error ? error.name : typeof error,
      });
    }
  });
}

/** The posted fields, or null when the post is not a small HTML form. */
async function readForm(request: Request) {
  if (!FORM_TYPE.test(request.headers.get('content-type') ?? '')) return null;
  // Node refuses a body longer than its Content-Length, so this caps what is read.
  if (!(Number(request.headers.get('content-length') ?? NaN) <= MAX_BYTES)) return null;
  return request.formData().catch(() => null);
}

/** Over the ceiling for every address together, or for this one. Each post counts. */
async function limited(db: Database, ip: string) {
  for (const [limit, key] of [
    [everyone, 'all'],
    [perAddress, ip],
  ] as const)
    if ((await limit.retryAfterMs(db, key)) > 0 || !(await limit.recordFailure(db, key)))
      return true;
  return false;
}

async function take(db: Database, form: FormData | null, ip: string, origin: string) {
  const settings = await loadSettings(db);
  if (!formOpen(settings)) return 'form closed';
  if (!form) return 'not a small form';
  if (await limited(db, ip)) return 'limit';
  if (form.get(HONEYPOT_FIELD)) return 'honeypot';
  // Browsers post line breaks as CRLF but count them as one character against maxLength.
  const filled = [...form].flatMap(([k, v]) =>
    typeof v === 'string' && v.trim() ? [[k, v.replace(/\r\n?/g, '\n')]] : [],
  );
  const parsed = enquiryForm.safeParse(Object.fromEntries(filled));
  if (!parsed.success) return 'invalid';
  const [system] = await db
    .select({ id: users.id, status: users.status })
    .from(users)
    .where(eq(users.email, WEBSITE_FORM_USER_EMAIL));
  if (
    system?.status !== 'disabled' ||
    (await db.$count(userRoles, eq(userRoles.userId, system.id)))
  )
    return BROKEN_USER;
  await save(db, { id: system.id, roles: ['marketing_manager'] }, parsed.data, settings, origin);
  return 'saved';
}

/** The newest real lead with this phone, a student phone first (never a sample: it gets cleared). */
async function leadWithPhone(db: Database, phone: string) {
  const [lead] = await db
    .select({ id: opsLeads.id })
    .from(opsLeads)
    .where(
      and(
        isNull(opsLeads.mergedIntoLeadId),
        eq(opsLeads.isSample, false),
        or(eq(opsLeads.studentPhone, phone), eq(opsLeads.guardianPhone, phone)),
      ),
    )
    .orderBy(
      sql`${opsLeads.studentPhone} is not distinct from ${phone} desc`,
      desc(opsLeads.firstReceivedAt),
    )
    .limit(1);
  return lead?.id;
}

/**
 * `actor`: the system user with an intake grant for the lead services' checks; the stored user
 * has no roles and cannot sign in (checked just before).
 */
async function save(
  db: Database,
  actor: Actor,
  f: EnquiryForm,
  settings: ResolvedSettings,
  origin: string,
) {
  const consent = settings['leads.website_form.consent'].value;
  // Optional: an email the server cannot use is left out with a note, never the whole enquiry.
  const email = f.email ? normaliseEmail(f.email) : null;
  const emailNote =
    email && !email.ok ? 'The email given was not valid, so it was left out.' : null;
  const enquiry = {
    sourceCode: WEBSITE_FORM_SOURCE,
    programmeCode: f.programme ?? null,
    interestMode: 'undecided' as const,
    channel: new URL(origin).host,
  };
  const attempt = (acknowledge: string | null) =>
    withTransaction(db, async (tx) => {
      const leadId = await leadWithPhone(tx, f.phone);
      const target = leadId
        ? eq(
            opsEnquiries.id,
            (
              await addEnquiry(
                tx,
                actor,
                leadId,
                {
                  ...enquiry,
                  notes: [
                    f.message,
                    `Name given: ${f.name}`,
                    f.city && `City: ${f.city}`,
                    email?.ok && `Email given: ${email.email}`,
                    emailNote,
                  ]
                    .filter(Boolean)
                    .join('\n'),
                },
                undefined,
                { openCase: false },
              )
            ).enquiry!.id,
          )
        : eq(
            opsEnquiries.leadId,
            (
              await createLead(tx, actor, {
                ...enquiry,
                studentName: f.name,
                studentPhone: f.phone,
                studentEmail: email?.ok ? email.email : null,
                city: f.city,
                notes: [f.message, emailNote].filter(Boolean).join('\n') || null,
                acknowledgeDuplicates: acknowledge ? { reason: acknowledge } : null,
              })
            ).lead.id,
          );
      await tx
        .update(opsEnquiries)
        .set({ consentTextVersion: consent.version, consentAt: new Date() })
        .where(target);
    });
  // A refusal: a parallel post saved this phone first, or another lead shares the email.
  await attempt(null).catch((error) => {
    if (!(error instanceof ConflictError)) throw error;
    return attempt(SHARED_CONTACT);
  });
}
