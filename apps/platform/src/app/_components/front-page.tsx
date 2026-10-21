import {
  BrandLogo,
  ButtonLink,
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

function ProgrammeList({
  id,
  title,
  items,
}: {
  id: string;
  title: string;
  items: typeof INSTITUTE.exams | typeof INSTITUTE.batches;
}) {
  return (
    <section className="fp-programmes" aria-labelledby={id}>
      <h2 id={id}>{title}</h2>
      <dl>
        {items.map((p) => (
          <div key={p.name}>
            <dt>{p.name}</dt>
            <dd>{p.about}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function FrontPage() {
  return (
    <div className="fp">
      <header className="fp-header">
        <BrandLogo size="md" />
        <ButtonLink href={PLATFORM_PATHS.login} variant="primary">
          Staff sign in
        </ButtonLink>
      </header>

      <main id="main" className="fp-main">
        <section className="fp-intro" aria-labelledby="fp-title">
          <h1 id="fp-title">Coaching for CLAT, IPMAT, CUET and CA&nbsp;Foundation</h1>
          <p className="fp-lead">
            {COMPANY_NAME} runs complete Class 11 and Class 12 Commerce batches, entrance coaching
            that students take alongside them, and a dropper batch for each exam.
          </p>
          <dl className="fp-facts">
            <div>
              <dt>Classes</dt>
              <dd>{INSTITUTE.modes}</dd>
            </div>
            <div>
              <dt>Admissions</dt>
              <dd>
                <a href={instituteTelHref}>{INSTITUTE.phone}</a>
                <br />
                <a href={`mailto:${INSTITUTE.email}`}>{INSTITUTE.email}</a>
              </dd>
            </div>
          </dl>
        </section>

        <div className="fp-catalogue">
          <ProgrammeList id="fp-exams" title="Entrance exams" items={INSTITUTE.exams} />
          <ProgrammeList id="fp-batches" title="Batches" items={INSTITUTE.batches} />
        </div>

        <section className="fp-faculty" aria-labelledby="fp-faculty-title">
          <h2 id="fp-faculty-title">Mentors</h2>
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
      </footer>
    </div>
  );
}
