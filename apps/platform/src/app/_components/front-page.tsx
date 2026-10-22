import {
  BrandLogo,
  ButtonLink,
  Card,
  COMPANY_NAME,
  INSTITUTE,
  instituteTelHref,
} from '@elevate/shared-ui';
import { PLATFORM_PATHS } from '../../lib/shell';
import './front-page.css';

/** Mentors exactly as listed on elevateeducation.in (home page, checked 21 Oct 2026). */
const FACULTY = [
  ['Surbhi Gupta', 'IIM Ahmedabad'],
  ['Samanti Dhore', 'IIM Bangalore'],
  ['Tushar Bhakte', 'IIM & IIT Speaker'],
  ['Sushant Bindal', 'Ex-Google'],
  ['Satish Raghuvanshi', 'Ex-Deloitte'],
  ['CA Nikunj Bindal', ''],
] as const;

/** The institute's public facts (brand.tsx), shown in the footer band. */
const FACTS = [
  ['Classes', INSTITUTE.modes],
  [
    'Admissions',
    <>
      <a href={instituteTelHref}>{INSTITUTE.phone}</a>
      <br />
      <a href={`mailto:${INSTITUTE.email}`}>{INSTITUTE.email}</a>
    </>,
  ],
  ['Address', INSTITUTE.address],
  ['GSTIN', <span className="el-tabular">{INSTITUTE.gstin}</span>],
] as const;

function Programmes({
  id,
  title,
  items,
}: {
  id: string;
  title: string;
  items: typeof INSTITUTE.exams | typeof INSTITUTE.batches;
}) {
  return (
    <Card id={id} title={title}>
      <dl className="fp-dl">
        {items.map((p) => (
          <div key={p.name}>
            <dt>{p.name}</dt>
            <dd>{p.about}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

export function FrontPage() {
  return (
    <div className="fp">
      <header className="fp-masthead">
        <BrandLogo size="md" />
        <ButtonLink href={PLATFORM_PATHS.login} variant="primary">
          Staff sign in
        </ButtonLink>
        <div className="fp-intro el-page-header">
          <h1>Coaching for CLAT, IPMAT, CUET and CA&nbsp;Foundation</h1>
          <p className="fp-lead">
            {COMPANY_NAME} runs complete Class 11 and Class 12 Commerce batches, entrance coaching
            that students take alongside them, and a dropper batch for each exam.
          </p>
        </div>
      </header>

      <main id="main" className="fp-main">
        <div className="fp-catalogue">
          <Programmes id="fp-exams" title="Entrance exams" items={INSTITUTE.exams} />
          <Programmes id="fp-batches" title="Batches" items={INSTITUTE.batches} />
        </div>

        <section className="fp-mentors" aria-labelledby="fp-mentors-title">
          <h2 id="fp-mentors-title">Mentors</h2>
          <ul>
            {FACULTY.map(([name, note]) => (
              <li key={name}>
                <span className="fp-name">{name}</span>
                {note ? <span className="fp-note">{note}</span> : null}
              </li>
            ))}
          </ul>
        </section>
      </main>

      <footer className="fp-footer">
        <dl className="fp-facts">
          {FACTS.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        <div className="fp-footer-line">
          <p>
            © {COMPANY_NAME}. {INSTITUTE.legalName}.
          </p>
          <ul>
            <li>
              <a href={INSTITUTE.site}>elevateeducation.in</a>
            </li>
            <li>
              <a href={INSTITUTE.privacyPolicy}>Privacy policy</a>
            </li>
            <li>
              <a href={PLATFORM_PATHS.login}>Staff sign in</a>
            </li>
          </ul>
        </div>
      </footer>
    </div>
  );
}
