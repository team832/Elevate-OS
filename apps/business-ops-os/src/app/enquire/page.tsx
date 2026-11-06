/**
 * `/ops/enquire`: the public website enquiry form (F4-15). No sign-in, a plain HTML form (works
 * without JavaScript), one column for phones. The reply is the same whatever happened to the post
 * (server/website-form.ts), so the thank-you page never says whether a contact was known.
 */
import type { Metadata } from 'next';
import {
  Alert,
  BrandLogo,
  Button,
  Field,
  INSTITUTE,
  instituteTelHref,
  Select,
  TextArea,
  TextInput,
} from '@elevate/shared-ui';
import { EMAIL_PATTERN, NAME_PATTERN, PHONE_PATTERN } from '../../domain/website-form';
import { HONEYPOT_FIELD, websiteFormView } from '../../server/website-form';
import { load } from '../../ui/frame';
import './enquire.css';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: { absolute: 'Ask about a course · Elevate Education' } };

const contact = (
  <>
    call <a href={instituteTelHref}>{INSTITUTE.phone}</a> or email{' '}
    <a href={`mailto:${INSTITUTE.email}`}>{INSTITUTE.email}</a>
  </>
);

export default async function EnquirePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sent = (await searchParams).sent === '1';
  const r = await load(websiteFormView, 1);
  return (
    <main className="el-login">
      <div className="el-login-brand">
        <BrandLogo size="lg" />
      </div>
      <section className="el-card el-login-card" aria-labelledby="enquire-title">
        {!r.ok ? (
          r.view
        ) : !r.data.enabled ? (
          <>
            <h1 id="enquire-title" className="el-login-title">
              Online enquiries are not open yet
            </h1>
            <p>To ask about a course, {contact}.</p>
          </>
        ) : sent ? (
          <>
            <h1 id="enquire-title" className="el-login-title">
              Thank you for your enquiry
            </h1>
            <Alert tone="success">
              The admissions team will contact you on the details you gave. If you do not hear from
              us, {contact}.
            </Alert>
            <a href="/ops/enquire">Send another enquiry</a>
          </>
        ) : (
          <>
            <div>
              <h1 id="enquire-title" className="el-login-title">
                Ask about a course
              </h1>
              <p className="el-login-hint">
                Leave your number and the Elevate Education admissions team will call you back.
                Fields marked optional can stay empty.
              </p>
            </div>
            <form method="post" action="/ops/api/v1/website-enquiries">
              <div hidden>
                <label>
                  Leave this empty
                  <input name={HONEYPOT_FIELD} tabIndex={-1} autoComplete="off" />
                </label>
              </div>
              <Field id="name" label="Student’s name">
                <TextInput
                  id="name"
                  name="name"
                  autoComplete="name"
                  maxLength={200}
                  pattern={NAME_PATTERN}
                  title="Write the student’s name."
                  required
                />
              </Field>
              <Field
                id="phone"
                label="Phone number"
                hint="We will call this number. Indian numbers need no +91."
              >
                <TextInput
                  id="phone"
                  name="phone"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  pattern={PHONE_PATTERN}
                  title="A 10-digit Indian number (0, 91 or +91 before it is fine), or another country’s number starting with +"
                  required
                  aria-describedby="phone-hint"
                />
              </Field>
              <Field id="email" label="Email (optional)">
                <TextInput
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  maxLength={254}
                  pattern={EMAIL_PATTERN}
                  title="A full email address, such as name@example.in"
                />
              </Field>
              <Field id="programme" label="Course">
                <Select id="programme" name="programme" defaultValue="">
                  <option value="">Not sure yet</option>
                  {r.data.programmes.map((p) => (
                    <option key={p.code} value={p.code}>
                      {p.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field id="city" label="City or town (optional)">
                <TextInput id="city" name="city" autoComplete="address-level2" maxLength={100} />
              </Field>
              <Field id="message" label="Message (optional)">
                <TextArea id="message" name="message" rows={3} maxLength={2000} />
              </Field>
              <label className="el-checkbox el-enquire-consent">
                <input type="checkbox" name="consent" required />
                <span>{r.data.consentText}</span>
              </label>
              <Button type="submit" block>
                Send enquiry
              </Button>
            </form>
          </>
        )}
      </section>
      <p className="el-login-facts">Prefer to talk? You can {contact}.</p>
    </main>
  );
}
