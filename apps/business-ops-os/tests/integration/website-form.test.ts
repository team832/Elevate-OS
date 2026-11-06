/**
 * F4-15 website enquiry form: a public post (no session) that always gets the same 303 thank-you,
 * whether it saved a lead, an enquiry on the lead with that phone, or nothing (honeypot, limit,
 * form off, invalid fields, a failed save). Consent version and time on the enquiry; the source is
 * always WEBSITE_FORM; created by the no-login system user. All contacts are made up.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import { prerender } from 'react-dom/static';
import { and, count, eq, sql } from 'drizzle-orm';
import { LoginThrottle, type ThrottleBucket } from '@elevate/authentication';
import { callRoute, setupTestDatabase } from '@elevate/testing';
import {
  loginAttempts,
  opsAdmissions,
  opsDuplicateFlags,
  opsEnquiries,
  opsLeadSources,
  opsLeads,
  opsSettings,
  userRoles,
  users,
} from '@elevate/database';
import EnquirePage from '../../src/app/enquire/page';
import { POST } from '../../src/app/api/v1/website-enquiries/route';
import {
  normaliseEmail,
  normalisePhone,
  SETTING_DEFINITIONS,
  validateSettingChange,
} from '../../src/domain';
import { createLead } from '../../src/server/leads';
import { updateSetting } from '../../src/server/settings';
import {
  WEBSITE_FORM_SOURCE,
  WEBSITE_FORM_THANKS,
  WEBSITE_FORM_USER_EMAIL,
} from '../../src/server/website-form';
import { seedWebsiteForm } from '../../seed/website-form';
import { e164, phone, setupReference, staffUser, uniqueEmail, type StaffUser } from './fixtures';

/** Work the route hands to Next's after(): it runs only once the reply has been sent (flush). */
const later = vi.hoisted(() => [] as (() => Promise<unknown>)[]);
vi.mock('next/server', async (real) => ({
  ...(await real<typeof import('next/server')>()),
  after: (task: () => Promise<unknown>) => void later.push(task),
}));
const flush = async () => {
  for (const task of later.splice(0)) await task();
};

const ctx = setupTestDatabase();
let manager: StaffUser;
let systemUserId: string;
let address = 0;

beforeAll(async () => {
  await setupReference(ctx.db);
  await seedWebsiteForm(ctx.db);
  await seedWebsiteForm(ctx.db); // idempotent
  manager = await staffUser(ctx.db, ['operations_manager']);
  const [system] = await ctx.db
    .select({ id: users.id, status: users.status, passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.email, WEBSITE_FORM_USER_EMAIL));
  expect(system).toMatchObject({ status: 'disabled', passwordHash: null });
  systemUserId = system!.id;
  expect(await ctx.db.select().from(userRoles).where(eq(userRoles.userId, system!.id))).toEqual([]);
  await formOn(true);
  await consent('approved');
});

const formOn = (enabled: boolean) =>
  updateSetting(ctx.db, manager, { key: 'leads.website_form.enabled', value: { enabled } });
/** The owner's approval of the consent wording (a stored decision, as elevate-record-decision writes it). */
const consent = (decisionState: 'approved' | 'proposed') =>
  ctx.db
    .insert(opsSettings)
    .values({
      key: 'leads.website_form.consent',
      value: SETTING_DEFINITIONS['leads.website_form.consent'].defaultValue,
      decisionState,
      source: 'Test: made-up owner decision',
      updatedBy: manager.id,
    })
    .onConflictDoUpdate({ target: opsSettings.key, set: { decisionState } });

/** A form post from a fresh made-up address (documentation range 203.0.113.0/24) unless given. */
/** A header given as null is left out. */
function post(fields: Record<string, string>, headers: Record<string, string | null> = {}) {
  const body = new URLSearchParams(fields).toString();
  const all = {
    'content-type': 'application/x-www-form-urlencoded',
    'content-length': String(Buffer.byteLength(body)),
    'x-forwarded-for': `203.0.113.${(address = (address % 250) + 1)}`,
    origin: 'http://localhost:3000',
    ...headers,
  };
  return callRoute(
    POST,
    new Request('http://localhost:3000/ops/api/v1/website-enquiries', {
      method: 'POST',
      body,
      headers: Object.entries(all).filter((h): h is [string, string] => h[1] !== null),
    }),
  );
}
const reply = async (fields: Record<string, string>, headers?: Record<string, string | null>) => {
  const r = await post(fields, headers);
  await flush();
  return { status: r.status, location: r.headers.get('location') };
};
const THANKS = { status: 303, location: WEBSITE_FORM_THANKS };

const form = (overrides: Record<string, string> = {}) => ({
  name: 'Sample Website Student',
  phone: phone(),
  email: uniqueEmail('web'),
  programme: 'CLAT',
  city: 'Sikar',
  message: 'Please call after 5 pm.',
  consent: 'on',
  ...overrides,
});
const leadsWith = async (raw: string) =>
  ctx.db
    .select()
    .from(opsLeads)
    .where(eq(opsLeads.studentPhone, e164(raw)));
const enquiriesOf = (leadId: string) =>
  ctx.db
    .select()
    .from(opsEnquiries)
    .where(eq(opsEnquiries.leadId, leadId as never));
const total = async () => (await ctx.db.select({ n: count() }).from(opsEnquiries))[0]!.n;

describe('website enquiry form: the same reply, whatever happened', () => {
  it('a new phone becomes a lead: source fixed, system user, consent stored', async () => {
    const f = form({ sourceCode: 'INSTAGRAM_ORGANIC' });
    expect(await reply(f)).toEqual(THANKS);
    const [lead] = await leadsWith(f.phone);
    expect(lead).toMatchObject({ studentName: f.name, city: 'Sikar', createdBy: systemUserId });
    expect(lead!.ownerStaffId).toBeNull();
    const [enquiry] = await enquiriesOf(lead!.id);
    expect(enquiry).toMatchObject({
      sourceCode: WEBSITE_FORM_SOURCE,
      consentTextVersion: 'website-v1',
      createdBy: systemUserId,
      notes: f.message,
      channel: 'localhost:3000',
    });
    expect(enquiry!.consentAt).toBeInstanceOf(Date);
  });

  it('a known phone (typed differently) adds an enquiry to that lead and changes nothing else', async () => {
    const raw = phone();
    const { lead } = await createLead(ctx.db, manager, {
      studentName: 'Sample Known Student',
      studentPhone: raw,
      sourceCode: 'UNKNOWN',
      interestMode: 'undecided',
    });
    const f = form({ phone: `+91 ${raw.slice(1, 6)} ${raw.slice(6)}`, name: 'Sample Other Name' });
    expect(await reply(f)).toEqual(THANKS);
    expect(await leadsWith(raw)).toHaveLength(1);
    const [after] = await leadsWith(raw);
    expect(after).toMatchObject({ studentName: 'Sample Known Student', studentEmail: null });
    const added = (await enquiriesOf(lead.id)).find((e) => e.sourceCode === WEBSITE_FORM_SOURCE);
    expect(added).toMatchObject({ consentTextVersion: 'website-v1', createdBy: systemUserId });
    expect(added!.notes).toContain('Name given: Sample Other Name');
  });

  it('an email another lead already has: a new lead, flagged for a person to check', async () => {
    const email = uniqueEmail('shared');
    await createLead(ctx.db, manager, {
      studentName: 'Sample Email Student',
      studentEmail: email,
      sourceCode: 'UNKNOWN',
      interestMode: 'undecided',
    });
    const f = form({ email });
    expect(await reply(f)).toEqual(THANKS);
    const [lead] = await leadsWith(f.phone);
    const flags = await ctx.db
      .select()
      .from(opsDuplicateFlags)
      .where(eq(opsDuplicateFlags.leadId, lead!.id));
    expect(flags.length).toBeGreaterThan(0);
  });

  it.each([
    ['the honeypot is filled', { website: 'https://spam.example' }],
    ['consent is not ticked', { consent: '' }],
    ['the phone is not a phone', { phone: '12345' }],
    ['the name is empty', { name: ' ' }],
    ['the programme is unknown', { programme: 'NO_SUCH' }],
  ])('nothing is saved when %s', async (_, overrides) => {
    const before = await total();
    expect(await reply(form(overrides))).toEqual(THANKS);
    expect(await total()).toBe(before);
  });

  it('a failed save is logged and answered alike', async () => {
    await ctx.db
      .update(opsLeadSources)
      .set({ status: 'retired' })
      .where(eq(opsLeadSources.code, WEBSITE_FORM_SOURCE));
    const before = await total();
    expect(await reply(form())).toEqual(THANKS);
    expect(await total()).toBe(before);
    await ctx.db
      .update(opsLeadSources)
      .set({ status: 'active' })
      .where(eq(opsLeadSources.code, WEBSITE_FORM_SOURCE));
  });

  it('the form switched off saves nothing and the page says enquiries are not open', async () => {
    await formOn(false);
    const before = await total();
    expect(await reply(form())).toEqual(THANKS);
    expect(await total()).toBe(before);
    expect(await page({ sent: '1' })).toContain('Online enquiries are not open yet');
    await formOn(true);
  });

  it('one address may send 5 posts in 15 minutes; the limit keys are HMACs, never the address', async () => {
    const ip = { 'x-forwarded-for': '198.51.100.7' };
    for (let i = 0; i < 5; i++) expect(await reply(form({ website: 'x' }), ip)).toEqual(THANKS);
    const f = form();
    expect(await reply(f, ip)).toEqual(THANKS);
    expect(await leadsWith(f.phone)).toHaveLength(0);
    const keys = await ctx.db.select({ key: loginAttempts.keyHash }).from(loginAttempts);
    expect(keys.every((k) => /^[0-9a-f]{64}$/.test(k.key) && !k.key.includes('198'))).toBe(true);
  });

  // Origins are compared whole (scheme, host, port): no wildcard, no "ends with".
  const SITE = 'https://elevate.example';
  it.each([
    ['', 'http://localhost:3000', true],
    ['', SITE, false],
    [SITE, SITE, true],
    [SITE, 'http://localhost:3000', true],
    [SITE, 'https://elevate.example.evil.example', false],
    [SITE, 'https://evil.example', false],
    [SITE, 'http://elevate.example', false],
    [SITE, 'https://elevate.example:8443', false],
    [SITE, 'null', false],
    [SITE, null, false],
  ])(
    'allowed websites "%s": a post with Origin %s is taken: %s',
    async (origins, origin, taken) => {
      await updateSetting(ctx.db, manager, {
        key: 'leads.website_form.allowed_origins',
        value: { origins },
      });
      const f = form();
      expect(await reply(f, { origin })).toEqual(taken ? THANKS : { status: 403, location: null });
      expect(await leadsWith(f.phone)).toHaveLength(taken ? 1 : 0);
    },
  );

  it.each([
    ['', true],
    ['https://www.example.in', true],
    ['https://www.example.in, http://localhost:3002', true],
    ['https://www.example.in/enquire', false],
    ['ftp://example.in', false],
    ['www.example.in', false],
  ])('the allowed websites setting "%s" is accepted: %s', (origins, ok) => {
    expect(validateSettingChange('leads.website_form.allowed_origins', { origins }).ok).toBe(ok);
  });

  it('a session is never needed and never used: the system user owns the trail', async () => {
    const f = form();
    expect(await reply(f, { cookie: 'elevate_session=not-a-session' })).toEqual(THANKS);
    const [lead] = await leadsWith(f.phone);
    expect(
      await ctx.db
        .select()
        .from(opsEnquiries)
        .where(
          and(eq(opsEnquiries.leadId, lead!.id), eq(opsEnquiries.createdBy, systemUserId as never)),
        ),
    ).toHaveLength(1);
  });
});

describe('REV-W4: nothing about a contact leaks, nothing beyond a note is written', () => {
  const known = async () => {
    const raw = phone();
    const { lead } = await createLead(ctx.db, manager, {
      studentName: 'Sample Known Lead',
      studentPhone: raw,
      sourceCode: 'UNKNOWN',
      interestMode: 'undecided',
    });
    return { raw, leadId: lead.id };
  };

  it.each(['a new phone', 'a known phone'])(
    'I1: with %s the 303 is sent before any save work starts (same time for every outcome)',
    async (which) => {
      const raw = which === 'a new phone' ? phone() : (await known()).raw;
      const before = await total();
      const r = await post(form({ phone: raw }));
      expect({ status: r.status, location: r.headers.get('location') }).toEqual(THANKS);
      expect(later).toHaveLength(1);
      expect(await total()).toBe(before);
      await flush();
      expect(await total()).toBe(before + 1);
    },
  );

  it('I2: an enquiry on a known lead never opens an admission case (counsellors do that)', async () => {
    const { raw, leadId } = await known();
    const cases = () =>
      ctx.db
        .select()
        .from(opsAdmissions)
        .where(eq(opsAdmissions.leadId, leadId as never));
    const before = await cases();
    expect(await reply(form({ phone: raw, programme: 'CLAT', message: 'Delete my data' }))).toEqual(
      THANKS,
    );
    expect(await cases()).toEqual(before);
    const added = (await enquiriesOf(leadId)).find((e) => e.sourceCode === WEBSITE_FORM_SOURCE);
    expect(added!.programmeId).not.toBeNull();
  });

  it('I3: over the ceiling for all addresses together, posts are dropped silently', async () => {
    // The same counter row as the form's own ceiling, locked at once (maxFailures 1).
    const everyone = new LoginThrottle('website-form-all' as ThrottleBucket, 1);
    await everyone.recordFailure(ctx.db, 'all');
    const f = form();
    expect(await reply(f)).toEqual(THANKS);
    expect(await leadsWith(f.phone)).toHaveLength(0);
    await everyone.reset(ctx.db, 'all');
    expect(await reply(f)).toEqual(THANKS);
    expect(await leadsWith(f.phone)).toHaveLength(1);
  });

  it.each([
    [
      'switched on',
      () =>
        ctx.db
          .update(users)
          .set({ status: 'active' })
          .where(eq(users.id, systemUserId as never)),
      () =>
        ctx.db
          .update(users)
          .set({ status: 'disabled' })
          .where(eq(users.id, systemUserId as never)),
    ],
    [
      'given a role',
      () =>
        ctx.db
          .insert(userRoles)
          .values({ userId: systemUserId as never, role: 'marketing_manager' }),
      () => ctx.db.delete(userRoles).where(eq(userRoles.userId, systemUserId as never)),
    ],
  ])('M7: nothing is written while the system user is %s', async (_, change, undo) => {
    await change();
    const f = form();
    expect(await reply(f)).toEqual(THANKS);
    expect(await leadsWith(f.phone)).toHaveLength(0);
    await undo();
  });

  it('M7: switched on but the consent wording only Proposed → closed, nothing saved', async () => {
    await consent('proposed');
    const f = form();
    expect(await reply(f)).toEqual(THANKS);
    expect(await leadsWith(f.phone)).toHaveLength(0);
    expect(await page({})).toContain('Online enquiries are not open yet');
    await consent('approved');
  });

  it('crafted fields cannot set owner, sample, stage, date or a duplicate acknowledgement', async () => {
    const raw = phone();
    expect(
      await reply({
        name: 'Sample Crafted',
        phone: raw,
        consent: 'on',
        ownerStaffId: manager.staffId,
        isSample: 'true',
        stageKey: 'converted',
        currentStage: 'class_12',
        acknowledgeDuplicates: 'x',
        receivedAt: '2020-01-01T00:00:00Z',
      }),
    ).toEqual(THANKS);
    const [lead] = await leadsWith(raw);
    expect(lead).toMatchObject({ ownerStaffId: null, isSample: false, currentStage: null });
    expect(lead!.firstReceivedAt.getFullYear()).toBeGreaterThan(2020);
  });
});

/**
 * FR-D: what the browser lets through, the server keeps. The browser's own checks are read from
 * the rendered page (required, maxLength, pattern with the v flag as browsers compile it, and the
 * HTML standard's email rule for type="email"), then compared with the server's rules.
 */
const HTML_EMAIL =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
const unescape = (s: string) =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
function browserCheck(html: string, name: string) {
  const tag = html.match(new RegExp(`<input[^>]*name="${name}"[^>]*>`))![0];
  const attr = (a: string) => tag.match(new RegExp(`\\s${a}="([^"]*)"`))?.[1];
  const pattern = attr('pattern') && new RegExp(`^(?:${unescape(attr('pattern')!)})$`, 'v');
  const email = attr('type') === 'email';
  return (typed: string) => {
    const v = email ? typed.replace(/^[\t\n\f\r ]+|[\t\n\f\r ]+$/g, '') : typed;
    if (v === '') return !tag.includes('required=""');
    if (v.length > Number(attr('maxLength') ?? Infinity)) return false;
    if (email && !HTML_EMAIL.test(v)) return false;
    return !pattern || pattern.test(v);
  };
}

describe('FR-D: the page stops what the server would refuse', () => {
  it.each([
    '98765 43210',
    '098765-43210',
    '+91 98765 43210',
    '91 98765 43210',
    '091 9876543210',
    '0091 98765 43210',
    '+91 (0) 98765 43210',
    '(+91) 98765.43210',
    '+44 20 7946 0958',
    '0044 20 7946 0958',
    '01412 345678',
    '98765 4321',
    '0987654321',
    '+91 98765 4321',
    '+91 08765 43210',
    '+1 234',
    '+0 1234 5678',
    '0091 0987654321',
    '00 12',
    '98765 43210 ext 2',
    '98765+43210',
    '+ 919876543210',
    '919876543210',
    '9191919191',
  ])('phone "%s": the page takes it exactly when the server does', async (typed) => {
    expect(browserCheck(await page({}), 'phone')(typed)).toBe(normalisePhone(typed).ok);
  });

  it('phone: 5,000 made-up strings, the page and the server agree on every one', async () => {
    const check = browserCheck(await page({}), 'phone');
    const chars = '0123456789011999+ -().';
    let seed = 7;
    const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const disagree: string[] = [];
    for (let i = 0; i < 5000; i++) {
      const s = Array.from(
        { length: 6 + Math.floor(next() * 14) },
        () => chars[Math.floor(next() * chars.length)],
      ).join('');
      if (check(s) !== normalisePhone(s).ok) disagree.push(s);
    }
    expect(disagree).toEqual([]);
  });

  it.each([
    'rahul@example.in',
    'rahul.sharma+web@mail.example.co.in',
    'rahul@gmail',
    'rahul@',
    '@example.in',
    'ra hul@example.in',
    'rahul@@example.in',
    `${'r'.repeat(250)}@x.in`,
  ])('email "%s": the page takes it only when the server keeps it', async (typed) => {
    const page_ = browserCheck(await page({}), 'email')(typed);
    expect(page_ && !normaliseEmail(typed).ok).toBe(false);
    expect(page_).toBe(normaliseEmail(typed).ok && HTML_EMAIL.test(typed));
  });

  it.each(['   ', ' '])('name %j: blank after trimming, the page refuses it', async (typed) => {
    expect(browserCheck(await page({}), 'name')(typed)).toBe(false);
  });

  it('an email the server cannot use is left out; the enquiry is kept and says so', async () => {
    const f = form({ email: 'rahul@gmail' });
    expect(await reply(f)).toEqual(THANKS);
    const [lead] = await leadsWith(f.phone);
    expect(lead).toMatchObject({ studentEmail: null });
    const [enquiry] = await enquiriesOf(lead!.id);
    expect(enquiry!.notes).toContain('The email given was not valid, so it was left out.');
    expect(enquiry!.notes).not.toContain('rahul@gmail');
  });

  it('a message the browser counts as 2,000 characters (line breaks posted as CRLF) is kept', async () => {
    const f = form({ message: `${'a'.repeat(99)}\r\n`.repeat(20) });
    expect(await reply(f)).toEqual(THANKS);
    expect(await leadsWith(f.phone)).toHaveLength(1);
  });

  it('a failed save logs the reason and the error class only, never what the person typed', async () => {
    const f = form({ name: 'Sample Log Probe', email: uniqueEmail('logprobe') });
    await ctx.db.execute(
      sql`alter table ops.leads add constraint test_log_probe check (student_name <> 'Sample Log Probe')`,
    );
    const lines: string[] = [];
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      lines.push(String(chunk));
      return true;
    });
    try {
      expect(await reply(f)).toEqual(THANKS);
    } finally {
      spy.mockRestore();
      await ctx.db.execute(sql`alter table ops.leads drop constraint test_log_probe`);
    }
    const line = lines.find((l) => l.includes('website enquiry'))!;
    expect(JSON.parse(line)).toMatchObject({ reason: 'failed' });
    for (const typed of [f.name, f.email, f.phone, e164(f.phone), f.message])
      expect(lines.join('')).not.toContain(typed);
  });
});

const page = async (sp: Record<string, string>) =>
  new Response(
    (await prerender((await EnquirePage({ searchParams: Promise.resolve(sp) })) as ReactElement))
      .prelude,
  ).text();

describe('the hosted page /ops/enquire', () => {
  it('is a plain HTML form with labelled fields, a hidden honeypot and the consent box', async () => {
    const out = await page({});
    expect(out).toContain('<form action="/ops/api/v1/website-enquiries" method="post">');
    expect(out).toMatch(/<div hidden=""><label>Leave this empty<input [^>]*name="website"/);
    expect(out).toMatch(/<input type="checkbox" required="" name="consent"/);
    for (const label of ['Student’s name', 'Phone number', 'Email (optional)', 'Course'])
      expect(out).toContain(`>${label}</label>`);
    expect(out).toContain('CLAT UG preparation');
  });

  it('after a post it thanks the person without saying what was found', async () => {
    const out = await page({ sent: '1' });
    expect(out).toContain('Thank you for your enquiry');
    expect(out).not.toMatch(/already|existing|found/i);
  });
});
